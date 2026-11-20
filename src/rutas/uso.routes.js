import { Router } from "express";
import { pool } from "../../bd/pool.js";
import { validarBody } from "../intermediarios/validate.js";
import { usoContenidoSchema } from "../validacion/schemas.js";

const router = Router();

// Conteo ANÓNIMO de uso de contenidos educativos para los indicadores ODS 2.4
// (recomendaciones para agricultores) y 4.7 (Laboratorio de simulación).
// Solo se guarda qué contenido y cuándo: ni usuario, ni IP, ni ubicación.
router.post("/", validarBody(usoContenidoSchema), async (req, res, next) => {
  try {
    await pool.query("INSERT INTO uso_contenido (recurso, accion) VALUES ($1, $2)", [
      req.body.recurso,
      req.body.accion,
    ]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
