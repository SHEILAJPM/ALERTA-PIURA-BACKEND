import { Router } from "express";
import { pool } from "../../bd/pool.js";
import { requerirSesion, requerirRol } from "../intermediarios/auth.js";
import { limitadorEscrituraPublica } from "../intermediarios/rateLimit.js";
import { validarBody } from "../intermediarios/validate.js";
import { reporteSaludSchema } from "../validacion/schemas.js";
import { redondearUbicacion, resumirReportesSalud } from "../servicios/reportesSalud.js";

const router = Router();

// Aviso ANÓNIMO de casos de enfermedad en la zona: sin sesión, sin nombre y
// con la ubicación redondeada a ~500 m antes de guardarla. No se registra
// quién lo envió (ni usuario ni IP en la base).
router.post(
  "/reportes",
  limitadorEscrituraPublica,
  validarBody(reporteSaludSchema),
  async (req, res, next) => {
    try {
      const { enfermedad, personas, lon, lat } = req.body;
      const zona = redondearUbicacion({ lon, lat });
      await pool.query(
        `INSERT INTO reportes_salud (enfermedad, personas, ubicacion)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326))`,
        [enfermedad, personas, zona.lon, zona.lat]
      );
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

// Resumen para Defensa Civil y administradores: casos por enfermedad y por
// zona en los últimos días (por defecto 14, máximo 90). Datos de salud: no es
// público, aunque sean anónimos y aproximados.
router.get(
  "/reportes/resumen",
  requerirSesion,
  requerirRol("administrador", "defensa_civil"),
  async (req, res, next) => {
    try {
      const dias = Math.min(90, Math.max(1, Number.parseInt(req.query.dias, 10) || 14));
      const { rows } = await pool.query(
        `SELECT enfermedad, personas::int AS personas, ST_X(ubicacion) AS lon, ST_Y(ubicacion) AS lat
         FROM reportes_salud
         WHERE creado_en > now() - make_interval(days => $1)`,
        [dias]
      );
      res.json({ dias, ...resumirReportesSalud(rows) });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
