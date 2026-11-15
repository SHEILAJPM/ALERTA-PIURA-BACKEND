import { pool } from "../../bd/pool.js";
import { estimarTiempoCrecida } from "./prediccion.js";
import { pronosticoParaSensor } from "./pronosticoLluvia.js";

// Puntaje de riesgo de 0 a 100 para una persona en un lugar concreto, que
// además explica de dónde sale cada punto y de qué dato viene. La idea es que
// cualquiera pueda entender por qué la app le dice "riesgo alto" y no tenga
// que creerle a ciegas.
//
// Reglas (simples a propósito, para poder explicarlas):
//   Río       0–40  % del límite de alerta roja × 30, +10 si está subiendo
//   Lluvia    0–25  ligera 5 · moderada 15 · fuerte 25, × probabilidad
//   Zona      0–25  zona de riesgo alto 25 · medio 15 · bajo 5 · fuera 0
//   Albergue    −5  si hay uno con espacio a menos de 2 km
// Total recortado a 0–100: < 35 bajo, < 65 medio, si no alto.

const PUNTOS_LLUVIA = { sin_lluvia: 0, ligera: 5, moderada: 15, fuerte: 25 };
const PUNTOS_ZONA = { alto: 25, medio: 15, bajo: 5 };
export const DISTANCIA_ALBERGUE_M = 2000;

export function nivelDePuntaje(puntaje) {
  if (puntaje < 35) return "bajo";
  if (puntaje < 65) return "medio";
  return "alto";
}

function factorRio({ nivelCm, umbralRojoCm, prediccion, sensorCodigo }) {
  if (nivelCm == null || !umbralRojoCm) {
    return {
      clave: "rio",
      puntos: 0,
      texto: "Sin lecturas recientes del sensor",
      fuente: `Sensor ${sensorCodigo}`,
    };
  }
  const fraccion = Math.min(1, Math.max(0, nivelCm / umbralRojoCm));
  const subiendo = Boolean(prediccion?.disponible);
  const puntos = Math.round(fraccion * 30) + (subiendo ? 10 : 0);
  const porcentaje = Math.round((nivelCm / umbralRojoCm) * 100);
  const texto = subiendo
    ? `El río sube ${prediccion.pendienteCmPorMin} cm/min y está al ${porcentaje} % del límite`
    : `El río está al ${porcentaje} % del límite y no está subiendo`;
  return { clave: "rio", puntos, texto, fuente: `Sensor ${sensorCodigo}` };
}

function factorLluvia(lluvia) {
  if (!lluvia) {
    return {
      clave: "lluvia",
      puntos: 0,
      texto: "Pronóstico de lluvia no disponible",
      fuente: "Pronóstico Open-Meteo",
    };
  }
  const base = PUNTOS_LLUVIA[lluvia.intensidad] ?? 0;
  const puntos = Math.round((base * (lluvia.probabilidad_max ?? 0)) / 100);
  const texto =
    lluvia.intensidad === "sin_lluvia"
      ? "No se pronostica lluvia en las próximas 24 h"
      : `Viene lluvia ${lluvia.intensidad}: hasta ${lluvia.maxima_mm_h} mm/h (probabilidad ${lluvia.probabilidad_max} %)`;
  return { clave: "lluvia", puntos, texto, fuente: "Pronóstico Open-Meteo" };
}

function factorZona(zona) {
  if (zona === undefined) return null; // sin ubicación: el factor no aplica
  if (!zona) {
    return {
      clave: "zona",
      puntos: 0,
      texto: "Tu ubicación no está en una zona de riesgo",
      fuente: "Mapa de zonas de riesgo",
    };
  }
  return {
    clave: "zona",
    puntos: PUNTOS_ZONA[zona.nivel_riesgo] ?? 0,
    texto: `Estás en una zona de riesgo ${zona.nivel_riesgo} (${zona.nombre})`,
    fuente: "Mapa de zonas de riesgo",
  };
}

function factorAlbergue(albergue) {
  if (!albergue || albergue.distancia_m > DISTANCIA_ALBERGUE_M) return null;
  const km = (albergue.distancia_m / 1000).toFixed(1);
  return {
    clave: "albergue",
    puntos: -5,
    texto: `Tienes un albergue con espacio a ${km} km (${albergue.nombre})`,
    fuente: "Albergues de Defensa Civil",
  };
}

// Función pura: recibe los datos ya consultados y arma el puntaje.
// `zona`: undefined = no se mandó ubicación; null = fuera de toda zona.
export function calcularPuntaje({ sensorCodigo, nivelCm, umbralRojoCm, prediccion, lluvia, zona, albergue }) {
  const factores = [
    factorRio({ nivelCm, umbralRojoCm, prediccion, sensorCodigo }),
    factorLluvia(lluvia),
    factorZona(zona),
    factorAlbergue(albergue),
  ].filter(Boolean);

  const suma = factores.reduce((acc, f) => acc + f.puntos, 0);
  const puntaje = Math.min(100, Math.max(0, suma));
  return { puntaje, nivel: nivelDePuntaje(puntaje), factores };
}

// Consulta todo lo que hace falta y devuelve el puntaje. lat/lon son
// opcionales: sin ellos se calcula solo con el río y la lluvia.
export async function puntajeParaUbicacion({ sensorCodigo, lat, lon }) {
  const { rows: lecturas } = await pool.query(
    `SELECT l.nivel_cm, s.nivel_alerta_roja_cm
     FROM sensores s
     LEFT JOIN LATERAL (
       SELECT nivel_cm FROM lecturas WHERE sensor_id = s.id ORDER BY medido_en DESC LIMIT 1
     ) l ON true
     WHERE s.codigo = $1`,
    [sensorCodigo]
  );
  if (lecturas.length === 0) return null; // sensor inexistente

  const conUbicacion = lat != null && lon != null;
  const [prediccion, lluvia, zonas, albergues] = await Promise.all([
    estimarTiempoCrecida(sensorCodigo),
    pronosticoParaSensor(sensorCodigo),
    conUbicacion
      ? pool.query(
          // Si el punto cae en varias zonas, cuenta la de mayor riesgo.
          `SELECT nombre, nivel_riesgo FROM zonas_riesgo
           WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
           ORDER BY CASE nivel_riesgo WHEN 'alto' THEN 0 WHEN 'medio' THEN 1 ELSE 2 END
           LIMIT 1`,
          [lon, lat]
        )
      : null,
    conUbicacion
      ? pool.query(
          `SELECT nombre,
                  ST_Distance(ubicacion::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distancia_m
           FROM albergues
           WHERE activo = true AND ocupacion_actual < capacidad
           ORDER BY ubicacion::geography <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
           LIMIT 1`,
          [lon, lat]
        )
      : null,
  ]);

  const nivel = lecturas[0].nivel_cm;
  return calcularPuntaje({
    sensorCodigo,
    nivelCm: nivel == null ? null : Number(nivel),
    umbralRojoCm: Number(lecturas[0].nivel_alerta_roja_cm),
    prediccion,
    lluvia,
    zona: conUbicacion ? (zonas.rows[0] ?? null) : undefined,
    albergue:
      conUbicacion && albergues.rows[0]
        ? { nombre: albergues.rows[0].nombre, distancia_m: Number(albergues.rows[0].distancia_m) }
        : null,
  });
}
