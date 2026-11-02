import { logger } from "../utilidades/logger.js";
import { capturarError } from "../utilidades/sentry.js";

// Errores "operacionales" (los que el propio código lanza a propósito, ej. 404
// sensor no encontrado, 400 de validación) traen `status` y su mensaje es
// seguro para el cliente. Cualquier otro error (SQL, bug, etc.) se loguea
// completo en el servidor pero al cliente solo le llega un mensaje genérico,
// para no filtrar detalles internos (consultas, rutas de archivo, etc.).
//
// 22P02 (invalid_text_representation) es el caso típico de un id que no es
// UUID en la URL (ej. /api/albergues/abc): es culpa del cliente, no del
// servidor, así que se responde 400 en vez de un 500 que además ensucia Sentry.
const TEXTO_INVALIDO_PG = "22P02";

export function manejadorErrores(err, req, res, _next) {
  if (err.code === TEXTO_INVALIDO_PG) {
    logger.warn({ path: req.path }, "Identificador con formato inválido");
    return res.status(400).json({ error: "Identificador con formato inválido" });
  }

  const esOperacional = typeof err.status === "number";

  if (esOperacional) {
    logger.warn({ err, path: req.path }, err.message);
  } else {
    logger.error({ err, path: req.path }, "Error inesperado");
    capturarError(err);
  }

  res.status(esOperacional ? err.status : 500).json({
    error: esOperacional ? err.message : "Error interno del servidor",
  });
}
