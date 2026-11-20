import { logger } from "../utilidades/logger.js";

// Buscar una dirección escrita ("Av. Grau 450", "Urb. Santa Ana") y devolver
// sus coordenadas, para el mapa de riesgo. Usa Nominatim (OpenStreetMap)
// desde el backend y no desde el navegador, para cumplir sus reglas de uso:
// un User-Agent que identifique la app, como máximo 1 consulta por segundo y
// guardar en caché las búsquedas repetidas. No se guarda quién buscó qué.

const URL_NOMINATIM = "https://nominatim.openstreetmap.org/search";
const AGENTE = "PiuraAlerta/1.0 (+https://alerta-piura-frontend.onrender.com)";

// Piura, Castilla y Veintiséis de Octubre (oeste, norte, este, sur).
export const ZONA_PIURA = { oeste: -80.78, norte: -5.08, este: -80.52, sur: -5.3 };

const TTL_CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE = 500;
const cache = new Map();
let cola = Promise.resolve();
let ultimaConsulta = 0;

export function normalizarConsulta(texto) {
  return String(texto ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

// Resultado de Nominatim -> lo justo para el mapa.
export function resumirResultados(filas) {
  if (!Array.isArray(filas)) return [];
  return filas
    .map((f) => ({
      nombre: String(f.display_name ?? "")
        .split(",")
        .slice(0, 3)
        .map((p) => p.trim())
        .join(", "),
      lat: Number(Number(f.lat).toFixed(5)),
      lon: Number(Number(f.lon).toFixed(5)),
    }))
    .filter((r) => r.nombre && Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

// Serializa las consultas para no pasar de 1 por segundo.
function turno() {
  const siguiente = cola.then(async () => {
    const espera = ultimaConsulta + 1100 - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultimaConsulta = Date.now();
  });
  cola = siguiente.catch(() => {});
  return siguiente;
}

export async function geocodificar(texto, { fetchImpl = fetch } = {}) {
  const consulta = normalizarConsulta(texto);
  const clave = consulta.toLowerCase();
  const guardado = cache.get(clave);
  if (guardado && Date.now() - guardado.en < TTL_CACHE_MS) return guardado.resultados;

  await turno();
  const { oeste, norte, este, sur } = ZONA_PIURA;
  const params = new URLSearchParams({
    q: consulta,
    format: "jsonv2",
    countrycodes: "pe",
    viewbox: `${oeste},${norte},${este},${sur}`,
    bounded: "1",
    limit: "5",
    "accept-language": "es",
  });
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 8000);
  try {
    const respuesta = await fetchImpl(`${URL_NOMINATIM}?${params}`, {
      headers: { "User-Agent": AGENTE, Accept: "application/json" },
      signal: controlador.signal,
    });
    if (!respuesta.ok) {
      logger.warn({ status: respuesta.status }, "Nominatim respondió con error");
      return null;
    }
    const resultados = resumirResultados(await respuesta.json());
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(clave, { en: Date.now(), resultados });
    return resultados;
  } catch (err) {
    logger.warn({ err }, "No se pudo consultar Nominatim");
    return null;
  } finally {
    clearTimeout(temporizador);
  }
}
