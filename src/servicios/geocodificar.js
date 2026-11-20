import { logger } from "../utilidades/logger.js";

// Buscar una dirección escrita ("Av. Grau", "Santa Ana") y devolver sus
// coordenadas para el mapa de riesgo, con sugerencias mientras se escribe.
// Usa Photon (komoot), un buscador de OpenStreetMap hecho para autocompletar
// (Nominatim prohíbe ese uso). Pasa por el backend para identificarse con un
// User-Agent propio y guardar en caché lo ya buscado. No se guarda quién buscó qué.

const URL_PHOTON = "https://photon.komoot.io/api/";
const AGENTE = "PiuraAlerta/1.0 (+https://alerta-piura-frontend.onrender.com)";

// Piura, Castilla y Veintiséis de Octubre.
export const ZONA_PIURA = { oeste: -80.78, norte: -5.08, este: -80.52, sur: -5.3 };
const PLAZA_DE_ARMAS = { lat: -5.19714, lon: -80.62664 };

const TTL_CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE = 1000;
const cache = new Map();

export function normalizarConsulta(texto) {
  return String(texto ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

// "Avenida Grau · Talarita, Castilla": nombre (o calle y número) y barrio/distrito.
function nombreLegible(p) {
  const principal = p.name || [p.street, p.housenumber].filter(Boolean).join(" ");
  const zona = [p.locality, p.district || p.city].filter((x) => x && x !== principal);
  return [principal, ...new Set(zona)].filter(Boolean).join(", ");
}

// Respuesta GeoJSON de Photon -> lo justo para el mapa, sin repetidos.
export function resumirResultados(geojson) {
  const vistos = new Set();
  const lista = [];
  for (const f of geojson?.features ?? []) {
    const [lon, lat] = f?.geometry?.coordinates ?? [];
    const nombre = nombreLegible(f?.properties ?? {});
    if (!nombre || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (vistos.has(nombre)) continue;
    vistos.add(nombre);
    lista.push({ nombre, lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) });
  }
  return lista;
}

export async function geocodificar(texto, { fetchImpl = fetch } = {}) {
  const consulta = normalizarConsulta(texto);
  const clave = consulta.toLowerCase();
  const guardado = cache.get(clave);
  if (guardado && Date.now() - guardado.en < TTL_CACHE_MS) return guardado.resultados;

  const { oeste, norte, este, sur } = ZONA_PIURA;
  const params = new URLSearchParams({
    q: consulta,
    bbox: `${oeste},${sur},${este},${norte}`,
    lat: String(PLAZA_DE_ARMAS.lat),
    lon: String(PLAZA_DE_ARMAS.lon),
    limit: "6",
  });
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 6000);
  try {
    const respuesta = await fetchImpl(`${URL_PHOTON}?${params}`, {
      headers: { "User-Agent": AGENTE, Accept: "application/json" },
      signal: controlador.signal,
    });
    if (!respuesta.ok) {
      logger.warn({ status: respuesta.status }, "Photon respondió con error");
      return null;
    }
    const resultados = resumirResultados(await respuesta.json()).slice(0, 5);
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(clave, { en: Date.now(), resultados });
    return resultados;
  } catch (err) {
    logger.warn({ err }, "No se pudo consultar Photon");
    return null;
  } finally {
    clearTimeout(temporizador);
  }
}
