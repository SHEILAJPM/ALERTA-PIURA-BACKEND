import { pool } from "../../bd/pool.js";
import { avisarAdministradoresTelegram } from "./telegram.js";
import { enviarCorreoEstadoSensor } from "./email.js";
import { transmitirRestringido } from "./websocket.js";
import { logger } from "../utilidades/logger.js";

// Aviso al equipo cuando un sensor deja de reportar. Un sensor callado es
// peligroso: la app deja de saber cómo está el río y, si nadie se entera,
// puede pasar días así (pasó con RIO-PIURA-01 en noviembre de 2026).
//
// Va solo al equipo (rol administrador/defensa_civil por correo y panel,
// TELEGRAM_ADMIN_CHAT_IDS por Telegram), nunca a los ciudadanos.

// Mismo umbral que el puntaje de riesgo (puntajeRiesgo.js): pasado este
// tiempo la última lectura ya no describe el río de ahora.
export const MINUTOS_SIN_SENAL = 30;
const ROLES_EQUIPO = ["administrador", "defensa_civil", "operario"];

// Función pura: qué hacer con un sensor según su última lectura y si ya
// tiene una caída abierta. Un sensor que nunca reportó no cuenta como caído
// (recién registrado, todavía sin instalar).
export function decidirCambio({ ultimaLecturaEn, caidaAbierta, ahora = new Date() }) {
  if (!ultimaLecturaEn) return null;
  const minutos = (ahora.getTime() - new Date(ultimaLecturaEn).getTime()) / 60000;
  const sinSenal = minutos > MINUTOS_SIN_SENAL;
  if (sinSenal && !caidaAbierta) return "caida";
  if (!sinSenal && caidaAbierta) return "recuperado";
  return null;
}

export function formatearDuracion(ms) {
  const minutos = Math.max(1, Math.round(ms / 60000));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 48) return `${horas} h`;
  return `${Math.round(horas / 24)} días`;
}

function horaLima(fecha) {
  return new Date(fecha).toLocaleString("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function mensajesCaida(sensor, desde, ahora = new Date()) {
  const hace = formatearDuracion(ahora - new Date(desde));
  return {
    asunto: `Sensor ${sensor.codigo} sin señal`,
    titulo: `El sensor ${sensor.nombre} dejó de reportar`,
    texto:
      `Su última lectura fue el ${horaLima(desde)} (hace ${hace}). Mientras esté sin señal, ` +
      `la app no puede medir el río en ese punto. Revisa la alimentación, la conexión WiFi/USB ` +
      `y que nada tape el sensor.`,
    telegram:
      `⚠️ Sensor ${sensor.codigo} (${sensor.nombre}) sin señal desde el ${horaLima(desde)} ` +
      `(hace ${hace}). Revisa alimentación, WiFi/USB y el sensor.`,
  };
}

export function mensajesRecuperado(sensor, desde, hasta) {
  const duracion = formatearDuracion(new Date(hasta) - new Date(desde));
  return {
    asunto: `Sensor ${sensor.codigo} volvió a reportar`,
    titulo: `El sensor ${sensor.nombre} volvió a reportar`,
    texto: `Estuvo sin señal ${duracion}. Ya está enviando lecturas otra vez.`,
    telegram: `✅ Sensor ${sensor.codigo} (${sensor.nombre}) volvió a reportar tras ${duracion} sin señal.`,
  };
}

async function avisarEquipo(mensajes, evento) {
  transmitirRestringido("sensor_estado", evento, ROLES_EQUIPO);

  const { rows } = await pool.query(
    `SELECT correo FROM usuarios WHERE rol IN ('administrador', 'defensa_civil') AND activo = true`
  );
  const envios = [
    ["telegram", avisarAdministradoresTelegram(mensajes.telegram)],
    ...rows.map((u) => ["correo", enviarCorreoEstadoSensor(u.correo, mensajes)]),
  ];
  const resultados = await Promise.allSettled(envios.map(([, promesa]) => promesa));
  resultados.forEach((resultado, i) => {
    if (resultado.status === "rejected") {
      logger.error({ err: resultado.reason, canal: envios[i][0] }, "Falló un aviso de estado del sensor");
    }
  });
}

// Revisa todos los sensores activos. Devuelve cuántos cambios avisó.
export async function revisarSensores({ ahora = new Date() } = {}) {
  const { rows: sensores } = await pool.query(
    `SELECT s.id, s.codigo, s.nombre,
            (SELECT max(medido_en) FROM lecturas WHERE sensor_id = s.id) AS ultima_lectura_en,
            c.id AS caida_id, c.desde AS caida_desde
     FROM sensores s
     LEFT JOIN caidas_sensor c ON c.sensor_id = s.id AND c.hasta IS NULL
     WHERE s.activo = true`
  );

  let avisos = 0;
  for (const sensor of sensores) {
    const cambio = decidirCambio({
      ultimaLecturaEn: sensor.ultima_lectura_en,
      caidaAbierta: Boolean(sensor.caida_id),
      ahora,
    });

    if (cambio === "caida") {
      // ON CONFLICT: si dos procesos revisan a la vez, solo uno abre la caída
      // y solo ese avisa (índice único parcial idx_caidas_sensor_abierta).
      const { rowCount } = await pool.query(
        `INSERT INTO caidas_sensor (sensor_id, desde) VALUES ($1, $2)
         ON CONFLICT (sensor_id) WHERE hasta IS NULL DO NOTHING`,
        [sensor.id, sensor.ultima_lectura_en]
      );
      if (rowCount === 0) continue;
      await avisarEquipo(mensajesCaida(sensor, sensor.ultima_lectura_en, ahora), {
        sensor_codigo: sensor.codigo,
        en_linea: false,
        desde: sensor.ultima_lectura_en,
      });
      avisos++;
    } else if (cambio === "recuperado") {
      await pool.query(`UPDATE caidas_sensor SET hasta = $2 WHERE id = $1`, [
        sensor.caida_id,
        sensor.ultima_lectura_en,
      ]);
      await avisarEquipo(mensajesRecuperado(sensor, sensor.caida_desde, sensor.ultima_lectura_en), {
        sensor_codigo: sensor.codigo,
        en_linea: true,
      });
      avisos++;
    }
  }
  return avisos;
}
