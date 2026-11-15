import { Router } from "express";
import { pool } from "../../bd/pool.js";
import { validarBody } from "../intermediarios/validate.js";
import { difusionSchema } from "../validacion/schemas.js";
import { requerirSesion, requerirRol } from "../intermediarios/auth.js";
import { limitadorEscrituraPublica } from "../intermediarios/rateLimit.js";
import { enviarMensajeATodos } from "../servicios/telegram.js";
import { registrarAccion } from "../servicios/auditoria.js";

const router = Router();

// Historial público de cambios de estado del río (transparencia hacia la
// comunidad): no requiere sesión, cualquiera puede ver qué pasó y cuándo.
router.get("/historial", async (req, res, next) => {
  try {
    const limite = Math.min(Math.max(Number(req.query.limite) || 30, 1), 100);
    const { rows } = await pool.query(
      `SELECT e.id, e.estado_anterior, e.estado_nuevo, e.nivel_cm, e.iniciado_en,
              s.codigo AS sensor_codigo, s.nombre AS sensor_nombre
       FROM eventos_alerta e
       JOIN sensores s ON s.id = e.sensor_id
       ORDER BY e.iniciado_en DESC
       LIMIT $1`,
      [limite]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Historial de avisos preventivos por lluvia fuerte (ver avisoLluvia.js).
// Público como /historial: el aviso ya se difundió a todos por Telegram y
// push, y la app lo usa para mostrar el último aviso al abrirse.
router.get("/avisos-lluvia", async (req, res, next) => {
  try {
    const limite = Math.min(Math.max(Number(req.query.limite) || 20, 1), 100);
    const { rows } = await pool.query(
      `SELECT a.id, a.intensidad, a.maxima_mm_h, a.total_mm, a.probabilidad_max, a.hora_maxima,
              a.mensaje, a.enviado_en, s.codigo AS sensor_codigo, s.nombre AS sensor_nombre
       FROM avisos_lluvia a
       JOIN sensores s ON s.id = a.sensor_id
       ORDER BY a.enviado_en DESC
       LIMIT $1`,
      [limite]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Difusión manual (a diferencia del aviso automático de alertEngine.js, que
// solo se dispara en un cambio de estado del río): exclusiva de Defensa
// Civil/COER y administrador -- operario no redacta avisos a la población.
router.post(
  "/difundir",
  requerirSesion,
  requerirRol("defensa_civil", "administrador"),
  limitadorEscrituraPublica,
  validarBody(difusionSchema),
  async (req, res, next) => {
    try {
      const { mensaje } = req.body;
      const resultado = await enviarMensajeATodos(`📣 AVISO DE DEFENSA CIVIL\n\n${mensaje}`);
      await registrarAccion({
        usuario: req.usuario,
        accion: "difusion_manual",
        detalle: mensaje.slice(0, 200),
      });
      res.json({ enviado_a: resultado.enviados });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
