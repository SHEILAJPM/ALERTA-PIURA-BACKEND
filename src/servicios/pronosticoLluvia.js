import { pool } from "../../bd/pool.js";

// Pronóstico de lluvia de las próximas horas sobre la ubicación de cada
// sensor, con Open-Meteo (open-meteo.com): gratis, sin API key y con datos
// de los modelos meteorológicos nacionales. En Piura la crecida del río casi
// siempre viene después de lluvias fuertes (Fenómeno El Niño, Niño Costero),
// así que saber que viene lluvia adelanta el aviso antes de que el sensor
// vea subir el agua.
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const HORAS = 24;
const TIMEOUT_MS = 5000;

// El pronóstico se actualiza cada hora: no tiene sentido pedirlo en cada
// GET /ultima (la app refresca cada pocos segundos). Además el plan gratis
// tiene límite diario de llamadas.
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 100;
const cache = new Map();

// Intensidad de lluvia según la Organización Meteorológica Mundial (mm/h):
// ligera < 2,5; moderada 2,5–7,6; fuerte > 7,6.
export function clasificarIntensidad(mmPorHora) {
  if (mmPorHora < 0.1) return "sin_lluvia";
  if (mmPorHora < 2.5) return "ligera";
  if (mmPorHora <= 7.6) return "moderada";
  return "fuerte";
}

// Función pura (sin red) para poder testearla directo: recibe el bloque
// "hourly" de Open-Meteo y lo resume. Devuelve null si el formato no es el
// esperado.
export function resumirPronostico(hourly) {
  if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.precipitation)) return null;

  const horas = hourly.time.slice(0, HORAS);
  if (horas.length === 0) return null;
  const lluvia = horas.map((_, i) => Number(hourly.precipitation[i]) || 0);
  const probabilidad = horas.map((_, i) => Number(hourly.precipitation_probability?.[i]) || 0);

  let iMax = 0;
  for (let i = 1; i < lluvia.length; i++) {
    if (lluvia[i] > lluvia[iMax]) iMax = i;
  }
  const total = lluvia.reduce((acc, mm) => acc + mm, 0);

  return {
    disponible: true,
    horas: horas.length,
    total_mm: Number(total.toFixed(1)),
    maxima_mm_h: Number(lluvia[iMax].toFixed(1)),
    hora_maxima: lluvia[iMax] > 0 ? horas[iMax] : null,
    probabilidad_max: Math.max(...probabilidad),
    intensidad: clasificarIntensidad(lluvia[iMax]),
  };
}

// Devuelve el resumen o null si no se pudo consultar (timeout, caída, formato
// raro). Nunca lanza: si Open-Meteo falla, el resto de la respuesta (nivel
// del río, predicción) tiene que seguir llegando.
export async function obtenerPronosticoLluvia(lat, lon) {
  // ~1 km de precisión: dos sensores vecinos comparten la misma consulta.
  const clave = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const enCache = cache.get(clave);
  if (enCache && enCache.expira > Date.now()) return enCache.resultado;

  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      hourly: "precipitation,precipitation_probability",
      forecast_hours: String(HORAS),
      timezone: "America/Lima",
    });
    const respuesta = await fetch(`${OPEN_METEO_URL}?${params}`, { signal: controlador.signal });
    if (!respuesta.ok) return null;

    const resultado = resumirPronostico((await respuesta.json()).hourly);
    if (!resultado) return null;

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(clave, { resultado, expira: Date.now() + CACHE_TTL_MS });
    return resultado;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Pronóstico sobre la ubicación guardada del sensor (columna PostGIS).
export async function pronosticoParaSensor(sensorCodigo) {
  const { rows } = await pool.query(
    `SELECT ST_Y(ubicacion) AS lat, ST_X(ubicacion) AS lon FROM sensores WHERE codigo = $1`,
    [sensorCodigo]
  );
  if (rows.length === 0) return null;
  return obtenerPronosticoLluvia(Number(rows[0].lat), Number(rows[0].lon));
}

// Solo para tests.
export function limpiarCacheLluvia() {
  cache.clear();
}
