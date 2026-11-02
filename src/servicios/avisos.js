import { notificarCambioEstado, recordarSeguridad } from "./telegram.js";
import { notificarCambioEstadoPush, recordarSeguridadPush } from "./webpush.js";
import { notificarCambioEstadoSMS } from "./sms.js";
import { logger } from "../utilidades/logger.js";

// Un solo punto para avisar un cambio de estado del río, lo use quien lo use
// (POST /api/lecturas o la ingesta del ESP32 en serialIngest.js). Antes cada
// lado tenía su propia lista: el puerto serie solo avisaba por Telegram.
//
// Cada canal corre por su cuenta (allSettled): si Telegram falla, push y SMS
// igual salen, y nunca se lanza el error hacia quien registró la lectura,
// que a esa altura ya está guardada.
export async function avisarCambioEstado(evento) {
  const avisos = [
    ["telegram", notificarCambioEstado(evento)],
    ["push", notificarCambioEstadoPush(evento)],
    ["sms", notificarCambioEstadoSMS(evento)],
  ];

  // Recordatorio de "estoy a salvo" (ver chequeos.routes.js): solo al
  // ENTRAR en alerta roja, no en cada lectura mientras dure -- un
  // recordatorio repetido cada pocos segundos sería spam, no ayuda.
  if (evento.estado_nuevo === "alerta_roja") {
    avisos.push(
      [
        "recordatorio telegram",
        recordarSeguridad(
          "🔴 Sigue la alerta roja. Si estás bien, márcalo en la app con el botón 'Estoy a salvo'. Si ves a alguien en peligro, usa el botón de SOS."
        ),
      ],
      [
        "recordatorio push",
        recordarSeguridadPush("Recuerda marcar 'Estoy a salvo' en la app mientras dure la alerta roja."),
      ]
    );
  }

  const resultados = await Promise.allSettled(avisos.map(([, promesa]) => promesa));
  resultados.forEach((resultado, i) => {
    if (resultado.status === "rejected") {
      logger.error({ err: resultado.reason, canal: avisos[i][0] }, "Falló un aviso de cambio de estado");
    }
  });
}
