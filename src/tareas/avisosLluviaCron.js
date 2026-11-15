import cron from "node-cron";
import { logger } from "../utilidades/logger.js";
import { revisarLluviaFuerte } from "../servicios/avisoLluvia.js";

// Revisa el pronóstico de lluvia al iniciar el servidor y luego cada hora (al
// minuto 5, cuando Open-Meteo ya publicó la corrida nueva). Mismo patrón que
// avisosVencimientoCron.js. Arrancar con una revisión no duplica avisos: el
// último envío por sensor queda en la tabla avisos_lluvia.
export function iniciarCronAvisosLluvia() {
  revisar();
  return cron.schedule("5 * * * *", revisar);
}

async function revisar() {
  try {
    const enviados = await revisarLluviaFuerte();
    if (enviados > 0) {
      logger.info(`[cron] ${enviados} aviso(s) preventivo(s) de lluvia enviado(s).`);
    }
  } catch (err) {
    logger.error({ err }, "[cron] error revisando el pronóstico de lluvia");
  }
}
