import { pool } from "../../bd/pool.js";
import { obtenerPronosticoLluvia } from "./pronosticoLluvia.js";
import { recordarSeguridad } from "./telegram.js";
import { recordarSeguridadPush } from "./webpush.js";
import { transmitir } from "./websocket.js";
import { logger } from "../utilidades/logger.js";

// Aviso preventivo: si se pronostica lluvia fuerte sobre un sensor, se avisa
// por Telegram, push y WebSocket aunque el río todavía esté bajo. Los avisos
// de cambio de estado (avisos.js) llegan cuando el agua ya subió; este llega
// antes, mientras todavía hay tiempo de prepararse.

const ORDEN_INTENSIDAD = ["sin_lluvia", "ligera", "moderada", "fuerte"];

// Solo se avisa si el modelo está razonablemente seguro: con menos de 50 %
// de probabilidad serían demasiadas falsas alarmas, y la gente deja de hacer
// caso a los avisos.
export const PROBABILIDAD_MINIMA = 50;

// Un mismo episodio de lluvia aparece en el pronóstico durante varias horas
// seguidas: sin esta pausa, el cron horario mandaría el mismo aviso cada hora.
export const HORAS_ENTRE_AVISOS = 6;

// Intensidad mínima para avisar. "fuerte" por defecto; para una demo en un
// día sin lluvia se puede bajar con AVISO_LLUVIA_INTENSIDAD=ligera.
export function intensidadMinima() {
  const valor = process.env.AVISO_LLUVIA_INTENSIDAD;
  return ORDEN_INTENSIDAD.includes(valor) && valor !== "sin_lluvia" ? valor : "fuerte";
}

export function debeAvisarLluvia(lluvia, ultimoAvisoEn, { minima = "fuerte", ahora = new Date() } = {}) {
  if (!lluvia?.disponible) return false;
  if (ORDEN_INTENSIDAD.indexOf(lluvia.intensidad) < ORDEN_INTENSIDAD.indexOf(minima)) return false;
  if (lluvia.probabilidad_max < PROBABILIDAD_MINIMA) return false;
  if (ultimoAvisoEn && ahora - new Date(ultimoAvisoEn) < HORAS_ENTRE_AVISOS * 60 * 60 * 1000) return false;
  return true;
}

// "2026-11-15T16:00" (hora local de Lima, como la devuelve Open-Meteo) ->
// "16:00 del 15/11".
function formatearHora(horaIso) {
  if (!horaIso) return null;
  const [fecha, hora] = horaIso.split("T");
  const [, mes, dia] = fecha.split("-");
  return `${hora.slice(0, 5)} del ${dia}/${mes}`;
}

export function mensajeAvisoLluvia(sensorNombre, lluvia) {
  const cuando = formatearHora(lluvia.hora_maxima);
  return (
    `🌧️ Se pronostica lluvia ${lluvia.intensidad} cerca de ${sensorNombre}: ` +
    `hasta ${lluvia.maxima_mm_h} mm/h${cuando ? ` hacia las ${cuando}` : ""} ` +
    `(${lluvia.total_mm} mm en 24 h, probabilidad ${lluvia.probabilidad_max} %). ` +
    `El río puede crecer en las próximas horas: revisa la app y ten lista tu mochila de emergencia.`
  );
}

async function enviarAviso(sensor, lluvia) {
  const mensaje = mensajeAvisoLluvia(sensor.nombre, lluvia);

  // Se registra antes de enviar: si un canal falla a la mitad, el cron no
  // vuelve a mandarle el aviso en la próxima hora a quienes sí lo recibieron.
  await pool.query(
    `INSERT INTO avisos_lluvia
       (sensor_id, intensidad, maxima_mm_h, total_mm, probabilidad_max, hora_maxima, mensaje)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      sensor.id,
      lluvia.intensidad,
      lluvia.maxima_mm_h,
      lluvia.total_mm,
      lluvia.probabilidad_max,
      lluvia.hora_maxima,
      mensaje,
    ]
  );

  transmitir("aviso_lluvia", { sensor: sensor.codigo, mensaje, ...lluvia });

  // Mismo criterio que avisos.js: cada canal por su cuenta.
  const canales = [
    ["telegram", recordarSeguridad(mensaje)],
    ["push", recordarSeguridadPush(mensaje)],
  ];
  const resultados = await Promise.allSettled(canales.map(([, promesa]) => promesa));
  resultados.forEach((resultado, i) => {
    if (resultado.status === "rejected") {
      logger.error({ err: resultado.reason, canal: canales[i][0] }, "Falló un aviso de lluvia");
    }
  });
}

// Revisa el pronóstico de todos los sensores activos y avisa donde haga
// falta. Devuelve cuántos avisos se mandaron.
export async function revisarLluviaFuerte({ ahora = new Date() } = {}) {
  const { rows: sensores } = await pool.query(
    `SELECT s.id, s.codigo, s.nombre, ST_Y(s.ubicacion) AS lat, ST_X(s.ubicacion) AS lon,
            (SELECT max(a.enviado_en) FROM avisos_lluvia a WHERE a.sensor_id = s.id) AS ultimo_aviso
     FROM sensores s
     WHERE s.activo = true`
  );

  const minima = intensidadMinima();
  let enviados = 0;
  for (const sensor of sensores) {
    const lluvia = await obtenerPronosticoLluvia(Number(sensor.lat), Number(sensor.lon));
    if (!debeAvisarLluvia(lluvia, sensor.ultimo_aviso, { minima, ahora })) continue;
    await enviarAviso(sensor, lluvia);
    enviados++;
  }
  return enviados;
}
