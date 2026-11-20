import { Router } from "express";
import { pool } from "../../bd/pool.js";
import { requerirSesion, requerirRol } from "../intermediarios/auth.js";
import { limitadorEscrituraPublica } from "../intermediarios/rateLimit.js";
import { validarBody } from "../intermediarios/validate.js";
import { reporteAguaSchema } from "../validacion/schemas.js";
import { redondearUbicacion, resumirReportesAgua } from "../servicios/reportesSalud.js";

const router = Router();

// Aviso ANÓNIMO de problemas con el agua de la casa (sin agua, turbia, con
// olor): sin sesión, sin texto libre y con la ubicación redondeada a ~500 m.
router.post(
  "/reportes",
  limitadorEscrituraPublica,
  validarBody(reporteAguaSchema),
  async (req, res, next) => {
    try {
      const zona = redondearUbicacion(req.body);
      await pool.query(
        `INSERT INTO reportes_agua (tipo, ubicacion) VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326))`,
        [req.body.tipo, zona.lon, zona.lat]
      );
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

// Resumen por tipo y por zona para Defensa Civil y administradores.
router.get(
  "/reportes/resumen",
  requerirSesion,
  requerirRol("administrador", "defensa_civil"),
  async (req, res, next) => {
    try {
      const dias = Math.min(90, Math.max(1, Number.parseInt(req.query.dias, 10) || 14));
      const { rows } = await pool.query(
        `SELECT tipo, ST_X(ubicacion) AS lon, ST_Y(ubicacion) AS lat
         FROM reportes_agua
         WHERE creado_en > now() - make_interval(days => $1)`,
        [dias]
      );
      res.json({ dias, ...resumirReportesAgua(rows) });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
