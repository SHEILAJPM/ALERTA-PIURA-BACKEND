import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { procesarLectura } from "./alertEngine.js";
import { transmitir } from "./websocket.js";
import { notificarCambioEstado } from "./telegram.js";
import { logger } from "../utilidades/logger.js";

// Ingesta real del ESP32: el firmware escribe una línea de texto por lectura
// (número plano "12.4" o JSON {"nivel_cm":12.4}) y acá se reusa el mismo
// punto de entrada que usa el simulador HTTP (procesarLectura), tal como
// estaba planeado en el comentario original de lecturas.routes.js.
export function iniciarIngestaSerial({ path, baudRate, sensorCodigo }) {
  if (!path) {
    logger.warn("SERIAL_PORT no configurado: la ingesta por puerto serie del ESP32 queda desactivada.");
    return null;
  }

  const puerto = new SerialPort({ path, baudRate }, (err) => {
    if (err) logger.error({ err, path }, "No se pudo abrir el puerto serie");
  });

  const parser = puerto.pipe(new ReadlineParser({ delimiter: "\n" }));
  parser.on("data", (linea) => manejarLinea(linea, sensorCodigo));

  puerto.on("error", (err) => logger.error({ err }, "Error de puerto serie"));
  puerto.on("open", () => logger.info(`Puerto serie ${path} abierto a ${baudRate} baudios.`));

  return puerto;
}

async function manejarLinea(linea, sensorCodigo) {
  const nivelCm = parsearNivel(linea);
  if (nivelCm === null) {
    logger.warn(`[serial] línea ignorada (formato inválido): ${linea.trim()}`);
    return;
  }

  try {
    const { lectura, evento } = await procesarLectura({ sensorCodigo, nivelCm });
    transmitir("lectura", lectura);
    if (evento) {
      transmitir("evento_alerta", evento);
      await notificarCambioEstado(evento);
    }
  } catch (err) {
    logger.error({ err }, "[serial] error procesando lectura");
  }
}

// Mismo rango que lecturaSchema (POST /api/lecturas): un sensor desconectado
// o con ruido manda negativos o picos absurdos, y no deben disparar alertas.
const NIVEL_MIN_CM = 0;
const NIVEL_MAX_CM = 2000;

export function parsearNivel(linea) {
  const texto = linea.trim();
  if (!texto) return null;

  const comoJson = intentarParsearJson(texto);
  const nivel = comoJson && typeof comoJson.nivel_cm === "number" ? comoJson.nivel_cm : Number(texto);

  if (!Number.isFinite(nivel) || nivel < NIVEL_MIN_CM || nivel > NIVEL_MAX_CM) return null;
  return nivel;
}

function intentarParsearJson(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}
