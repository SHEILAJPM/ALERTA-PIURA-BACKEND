import cron from "node-cron";
import { logger } from "../utilidades/logger.js";
import { revisarSensores } from "../servicios/sensorCaido.js";

// Revisa cada 5 minutos si algún sensor dejó de reportar (o volvió). Corre
// también al iniciar: si el servidor estuvo apagado mientras el sensor se
// cayó, el equipo se entera apenas vuelve. No duplica avisos: cada caída
// queda abierta en la tabla caidas_sensor hasta que el sensor vuelve.
export function iniciarCronSensorCaido() {
  revisar();
  return cron.schedule("*/5 * * * *", revisar);
}

async function revisar() {
  try {
    const avisos = await revisarSensores();
    if (avisos > 0) logger.info(`[cron] ${avisos} aviso(s) de estado de sensor enviado(s) al equipo.`);
  } catch (err) {
    logger.error({ err }, "[cron] error revisando si los sensores siguen reportando");
  }
}
