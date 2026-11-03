// Consulta de DNI contra RENIEC vía Decolecta (decolecta.com, token gratis al
// registrarse). RENIEC no tiene API pública abierta: la oficial (PIDE) es solo
// para entidades del Estado con convenio, así que se usa este intermediario.
const DECOLECTA_URL = "https://api.decolecta.com/v1/reniec/dni";
const TIMEOUT_MS = 5000;

// Un mismo DNI se consulta dos veces en un registro normal (al autocompletar
// el nombre y al crear la cuenta): con este cache la segunda no gasta cuota
// del plan gratis. Acotado para no crecer sin límite en memoria.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 1000;
const cache = new Map();

// Decolecta devuelve todo en mayúsculas ("ROXANA KARINA"): se pasa a
// "Roxana Karina" para que quede igual que un nombre escrito a mano.
function capitalizar(texto) {
  return texto
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((palabra) => palabra[0].toUpperCase() + palabra.slice(1))
    .join(" ");
}

export function consultaDniDisponible() {
  return Boolean(process.env.DNI_API_TOKEN);
}

// Devuelve:
// - { encontrado: true, nombre } si el DNI existe,
// - { encontrado: false } si RENIEC no lo reconoce,
// - null si no se pudo consultar (sin token, sin cuota, timeout, caída).
// Nunca lanza: una caída del proveedor no debe bloquear el registro.
export async function consultarDni(dni) {
  const token = process.env.DNI_API_TOKEN;
  if (!token) return null;

  const enCache = cache.get(dni);
  if (enCache && enCache.expira > Date.now()) return enCache.resultado;

  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const respuesta = await fetch(`${DECOLECTA_URL}?numero=${encodeURIComponent(dni)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controlador.signal,
    });

    let resultado;
    if (respuesta.ok) {
      const data = await respuesta.json();
      const nombre = [data.first_name, data.first_last_name, data.second_last_name]
        .filter((parte) => typeof parte === "string" && parte.trim())
        .join(" ");
      resultado = nombre ? { encontrado: true, nombre: capitalizar(nombre) } : { encontrado: false };
    } else if ([400, 404, 422].includes(respuesta.status)) {
      resultado = { encontrado: false };
    } else {
      // 401/403 (token inválido), 429 (sin cuota), 5xx: problema nuestro o
      // del proveedor, no del DNI. No se cachea para reintentar la próxima.
      return null;
    }

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(dni, { resultado, expira: Date.now() + CACHE_TTL_MS });
    return resultado;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Solo para pruebas/reniec.test.js: el cache es de módulo y sobreviviría
// entre tests.
export function limpiarCacheDni() {
  cache.clear();
}
