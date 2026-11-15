import { pool } from "../../bd/pool.js";

// Regresión lineal simple sobre puntos {x: minutos, y: nivel_cm}, extrapolada
// hasta el umbral de alerta roja. No es un modelo entrenado, es la tendencia
// de la ventana reciente. Función pura (sin DB) para poder testearla directo.
export function calcularTendencia(puntos, umbralAlertaRoja) {
  if (puntos.length < 2) {
    return { disponible: false, motivo: "No hay suficientes lecturas recientes" };
  }

  const n = puntos.length;
  const sumX = puntos.reduce((acc, p) => acc + p.x, 0);
  const sumY = puntos.reduce((acc, p) => acc + p.y, 0);
  const sumXY = puntos.reduce((acc, p) => acc + p.x * p.y, 0);
  const sumX2 = puntos.reduce((acc, p) => acc + p.x * p.x, 0);

  const denominador = n * sumX2 - sumX * sumX;
  if (denominador === 0) {
    return { disponible: false, motivo: "Lecturas insuficientes para calcular tendencia" };
  }

  const pendienteCmPorMin = (n * sumXY - sumX * sumY) / denominador;
  const nivelActual = puntos[puntos.length - 1].y;

  if (pendienteCmPorMin <= 0.001) {
    return {
      disponible: false,
      motivo: "El nivel no muestra tendencia de subida",
      pendienteCmPorMin: Number(pendienteCmPorMin.toFixed(3)),
    };
  }

  const minutosParaAlerta = Math.max(0, (umbralAlertaRoja - nivelActual) / pendienteCmPorMin);

  return {
    disponible: true,
    minutosParaAlerta: Math.round(minutosParaAlerta),
    pendienteCmPorMin: Number(pendienteCmPorMin.toFixed(3)),
  };
}

// Junta lo que mide el sensor (¿el río está subiendo?) con lo que viene del
// cielo (¿se pronostica lluvia?). Función pura: recibe el resultado de
// calcularTendencia/estimarTiempoCrecida y el de pronosticoLluvia (o null si
// Open-Meteo no respondió).
//   alto  = el río sube Y viene lluvia moderada o fuerte
//   medio = solo una de las dos cosas
//   bajo  = ni sube ni viene lluvia importante
export function evaluarRiesgo(prediccion, lluvia) {
  const subiendo = Boolean(prediccion?.disponible);
  const lluviaImportante = ["moderada", "fuerte"].includes(lluvia?.intensidad);
  const textoLluvia = lluvia ? `lluvia ${lluvia.intensidad} (${lluvia.maxima_mm_h} mm/h)` : null;

  if (subiendo && lluviaImportante) {
    return {
      nivel: "alto",
      mensaje: `El río está subiendo y se pronostica ${textoLluvia} en las próximas horas: la crecida puede llegar antes de lo estimado.`,
    };
  }
  if (subiendo) {
    return {
      nivel: "medio",
      mensaje: lluvia
        ? "El río está subiendo, aunque no se pronostica lluvia importante."
        : "El río está subiendo (pronóstico de lluvia no disponible).",
    };
  }
  if (lluviaImportante) {
    return {
      nivel: "medio",
      mensaje: `El río está estable, pero se pronostica ${textoLluvia}: puede empezar a subir.`,
    };
  }
  return { nivel: "bajo", mensaje: "El río está estable y no se pronostica lluvia importante." };
}

export async function estimarTiempoCrecida(sensorCodigo, { minutos = 30 } = {}) {
  const { rows } = await pool.query(
    `SELECT l.nivel_cm, l.medido_en, s.nivel_alerta_roja_cm
     FROM lecturas l
     JOIN sensores s ON s.id = l.sensor_id
     WHERE s.codigo = $1 AND l.medido_en >= now() - ($2 || ' minutes')::interval
     ORDER BY l.medido_en ASC`,
    [sensorCodigo, minutos]
  );

  if (rows.length < 2) {
    return { disponible: false, motivo: "No hay suficientes lecturas recientes" };
  }

  const t0 = rows[0].medido_en.getTime();
  const puntos = rows.map((r) => ({
    x: (r.medido_en.getTime() - t0) / 60000,
    y: Number(r.nivel_cm),
  }));

  return calcularTendencia(puntos, Number(rows[0].nivel_alerta_roja_cm));
}
