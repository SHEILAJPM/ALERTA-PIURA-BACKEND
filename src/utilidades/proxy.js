// Detrás de un proxy (Render, Railway, un balanceador), la conexión TCP llega
// desde el proxy, no desde el usuario: sin esto, express-rate-limit y el tope
// de sockets por IP de websocket.js verían a TODOS los usuarios como una sola
// IP (un solo cupo de login compartido, 20 sockets en total para toda la
// ciudad). TRUST_PROXY = cuántos proxies hay delante (1 en Render). Vacío o 0
// = conexión directa, sin confiar en X-Forwarded-For: confiar en ese header
// sin un proxy delante dejaría a cualquiera falsear su IP y saltarse límites.
export function saltosProxy() {
  const saltos = Number.parseInt(process.env.TRUST_PROXY ?? "", 10);
  return Number.isInteger(saltos) && saltos > 0 ? saltos : 0;
}

// Misma regla que Express con `trust proxy = N` (req.ip), para las conexiones
// WebSocket, que llegan por el upgrade HTTP y no pasan por Express: de
// derecha a izquierda en X-Forwarded-For, saltando las N entradas que
// agregaron los proxies de confianza.
export function ipCliente(request, saltos = saltosProxy()) {
  const directa = request.socket?.remoteAddress ?? "desconocida";
  if (saltos === 0) return directa;

  const reenviadas = String(request.headers?.["x-forwarded-for"] ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
  const cadena = [directa, ...reenviadas.reverse()];
  return cadena[Math.min(saltos, cadena.length - 1)];
}
