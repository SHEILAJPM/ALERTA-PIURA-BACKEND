import { Router } from "express";
import { puntajeParaUbicacion } from "../servicios/puntajeRiesgo.js";

const router = Router();
const SENSOR_POR_DEFECTO = "RIO-PIURA-01";

// Lee lat/lon de la query. Devuelve { lat, lon } (ambos null si no vinieron)
// o { error } si vienen incompletos o fuera de rango.
export function leerUbicacion(query) {
  const tieneLat = query.lat !== undefined && query.lat !== "";
  const tieneLon = query.lon !== undefined && query.lon !== "";
  if (!tieneLat && !tieneLon) return { lat: null, lon: null };
  if (tieneLat !== tieneLon) return { error: "lat y lon deben enviarse juntos" };

  const lat = Number(query.lat);
  const lon = Number(query.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { error: "lat inválida" };
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return { error: "lon inválida" };
  return { lat, lon };
}

// Puntaje de riesgo explicado (ver servicios/puntajeRiesgo.js). Público: no
// guarda la ubicación, solo la usa para calcular y la descarta.
router.get("/", async (req, res, next) => {
  try {
    const ubicacion = leerUbicacion(req.query);
    if (ubicacion.error) return res.status(400).json({ error: ubicacion.error });

    const sensorCodigo = req.query.sensor ?? SENSOR_POR_DEFECTO;
    const resultado = await puntajeParaUbicacion({ sensorCodigo, ...ubicacion });
    if (!resultado) return res.status(404).json({ error: "Sensor no encontrado" });

    res.json({ sensor: sensorCodigo, con_ubicacion: ubicacion.lat !== null, ...resultado });
  } catch (err) {
    next(err);
  }
});

export default router;
