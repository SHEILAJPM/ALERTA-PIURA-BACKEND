import { Router } from "express";
import { limitadorDni } from "../intermediarios/rateLimit.js";
import { consultarDni, consultaDniDisponible } from "../servicios/reniec.js";

const router = Router();

// Autocompletar el nombre en el formulario de registro. Devuelve solo el
// nombre (nada más de RENIEC) y con límite estricto por IP, para que no sirva
// para buscar DNIs ajenos en masa.
router.get("/:dni", limitadorDni, async (req, res, next) => {
  try {
    const { dni } = req.params;
    if (!/^\d{8}$/.test(dni)) {
      return res.status(400).json({ error: "El DNI debe tener 8 dígitos" });
    }
    if (!consultaDniDisponible()) {
      return res.status(503).json({ error: "Consulta de DNI no disponible" });
    }

    const resultado = await consultarDni(dni);
    if (!resultado) {
      return res.status(503).json({ error: "No se pudo consultar RENIEC, intenta de nuevo" });
    }
    if (!resultado.encontrado) {
      return res.status(404).json({ error: "DNI no encontrado en RENIEC" });
    }
    res.json({ nombre: resultado.nombre });
  } catch (err) {
    next(err);
  }
});

export default router;
