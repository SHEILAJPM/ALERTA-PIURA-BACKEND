import { transmitir } from "./websocket.js";

// Simulacro de alerta en vivo: Defensa Civil o un administrador lo inicia
// desde el panel y, en el mismo segundo, todos los que tienen la app abierta
// ven la alerta roja en pantalla completa, con sonido y vibración. Sirve para
// entrenar a la población (y para demostrar que el canal en tiempo real
// funciona) sin tocar lecturas, umbrales ni el historial de alertas reales.
//
// Vive en memoria a propósito: si el servidor se reinicia a mitad de un
// simulacro, lo correcto es que termine, no que reaparezca.
export const DURACION_POR_DEFECTO_MIN = 2;
export const MENSAJE_POR_DEFECTO =
  "Esto es un SIMULACRO. Ubica tu ruta de evacuación y dirígete al albergue más cercano.";

let estado = { activo: false };
let temporizador = null;

export function obtenerSimulacro() {
  // Si el temporizador se perdió (ej. tests con relojes falsos), el
  // vencimiento igual se respeta al consultar.
  if (estado.activo && Date.parse(estado.termina_en) <= Date.now()) {
    estado = { activo: false };
  }
  return estado;
}

export function iniciarSimulacro({ minutos = DURACION_POR_DEFECTO_MIN, mensaje, iniciadoPor }) {
  clearTimeout(temporizador);
  const ahora = Date.now();
  estado = {
    activo: true,
    id: ahora.toString(36),
    mensaje: mensaje?.trim() || MENSAJE_POR_DEFECTO,
    iniciado_por: iniciadoPor ?? null,
    iniciado_en: new Date(ahora).toISOString(),
    termina_en: new Date(ahora + minutos * 60_000).toISOString(),
  };
  transmitir("simulacro", estado);
  temporizador = setTimeout(() => detenerSimulacro(), minutos * 60_000);
  temporizador.unref?.();
  return estado;
}

export function detenerSimulacro() {
  clearTimeout(temporizador);
  temporizador = null;
  const estabaActivo = estado.activo;
  estado = { activo: false };
  if (estabaActivo) transmitir("simulacro", estado);
  return estado;
}
