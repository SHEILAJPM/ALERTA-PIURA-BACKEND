import { Router } from "express";
import { requerirSesion, requerirRol } from "../intermediarios/auth.js";
import { validarBody } from "../intermediarios/validate.js";
import { limitadorEscrituraPublica } from "../intermediarios/rateLimit.js";
import { simulacroSchema } from "../validacion/schemas.js";
import { obtenerSimulacro, iniciarSimulacro, detenerSimulacro } from "../servicios/simulacro.js";
import { notificarSimulacroPush } from "../servicios/webpush.js";
import { registrarAccion } from "../servicios/auditoria.js";
import { logger } from "../utilidades/logger.js";

const router = Router();
const ROLES_SIMULACRO = ["defensa_civil", "administrador"];

// Público: quien abre la app a mitad de un simulacro también tiene que verlo
// (el WebSocket solo avisa los cambios, no el estado al conectarse).
router.get("/", (_req, res) => {
  res.json(obtenerSimulacro());
});

router.post(
  "/iniciar",
  requerirSesion,
  requerirRol(...ROLES_SIMULACRO),
  limitadorEscrituraPublica,
  validarBody(simulacroSchema),
  async (req, res, next) => {
    try {
      const { minutos, mensaje, con_push: conPush } = req.body;
      const simulacro = iniciarSimulacro({ minutos, mensaje, iniciadoPor: req.usuario.nombre });
      await registrarAccion({
        usuario: req.usuario,
        accion: "simulacro_iniciado",
        detalle: `${minutos ?? "2"} min${conPush ? ", con push" : ""}`,
      });
      // El push no frena la respuesta: el WebSocket ya avisó a los que tienen
      // la app abierta, que es lo inmediato.
      if (conPush) {
        notificarSimulacroPush(simulacro.mensaje).catch((err) =>
          logger.error({ err }, "Error enviando push del simulacro")
        );
      }
      res.status(201).json(simulacro);
    } catch (err) {
      next(err);
    }
  }
);

router.post("/detener", requerirSesion, requerirRol(...ROLES_SIMULACRO), async (req, res, next) => {
  try {
    const estado = detenerSimulacro();
    await registrarAccion({ usuario: req.usuario, accion: "simulacro_detenido", detalle: "" });
    res.json(estado);
  } catch (err) {
    next(err);
  }
});

export default router;
