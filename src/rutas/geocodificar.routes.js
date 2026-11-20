import { Router } from "express";
import { limitadorGeocodificar } from "../intermediarios/rateLimit.js";
import { geocodificar, normalizarConsulta } from "../servicios/geocodificar.js";

const router = Router();

// GET /api/geocodificar?q=Av. Grau 450 -> [{ nombre, lat, lon }] dentro de Piura.
router.get("/", limitadorGeocodificar, async (req, res, next) => {
  try {
    const consulta = normalizarConsulta(req.query.q);
    if (consulta.length < 3) {
      return res.status(400).json({ error: "Escribe al menos 3 letras de la dirección" });
    }
    const resultados = await geocodificar(consulta);
    if (resultados === null) {
      return res.status(503).json({ error: "La búsqueda de direcciones no está disponible ahora" });
    }
    res.json(resultados);
  } catch (err) {
    next(err);
  }
});

export default router;
