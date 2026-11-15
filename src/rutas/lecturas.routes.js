import { Router } from "express";
import { pool } from "../../bd/pool.js";
import { procesarLectura } from "../servicios/alertEngine.js";
import { estimarTiempoCrecida, evaluarRiesgo } from "../servicios/prediccion.js";
import { pronosticoParaSensor } from "../servicios/pronosticoLluvia.js";
import { transmitir } from "../servicios/websocket.js";
import { avisarCambioEstado } from "../servicios/avisos.js";
import { validarBody } from "../intermediarios/validate.js";
import { lecturaSchema } from "../validacion/schemas.js";
import { limitadorLecturas } from "../intermediarios/rateLimit.js";
import { requerirApiKeySensor } from "../intermediarios/sensorAuth.js";

const router = Router();
const SENSOR_POR_DEFECTO = "RIO-PIURA-01";

router.get("/ultima", async (req, res, next) => {
  try {
    const sensorCodigo = req.query.sensor ?? SENSOR_POR_DEFECTO;
    const { rows } = await pool.query(
      `SELECT l.id, l.nivel_cm, l.porcentaje, l.estado, l.medido_en
       FROM lecturas l JOIN sensores s ON s.id = l.sensor_id
       WHERE s.codigo = $1
       ORDER BY l.medido_en DESC LIMIT 1`,
      [sensorCodigo]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Sin lecturas todavía para este sensor" });
    }

    // En paralelo: el pronóstico sale del cache casi siempre, pero si toca
    // pedirlo a Open-Meteo no debe sumar su espera a la de la predicción.
    const [prediccion, lluvia] = await Promise.all([
      estimarTiempoCrecida(sensorCodigo),
      pronosticoParaSensor(sensorCodigo),
    ]);
    res.json({ ...rows[0], prediccion, lluvia, riesgo: evaluarRiesgo(prediccion, lluvia) });
  } catch (err) {
    next(err);
  }
});

// Solo el pronóstico de lluvia de las próximas 24 h sobre el sensor.
router.get("/lluvia", async (req, res, next) => {
  try {
    const sensorCodigo = req.query.sensor ?? SENSOR_POR_DEFECTO;
    const { rowCount } = await pool.query(`SELECT 1 FROM sensores WHERE codigo = $1`, [sensorCodigo]);
    if (rowCount === 0) {
      return res.status(404).json({ error: "Sensor no encontrado" });
    }
    const lluvia = await pronosticoParaSensor(sensorCodigo);
    if (!lluvia) {
      return res.status(503).json({ error: "Pronóstico de lluvia no disponible en este momento" });
    }
    res.json({ sensor: sensorCodigo, fuente: "Open-Meteo", ...lluvia });
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const sensorCodigo = req.query.sensor ?? SENSOR_POR_DEFECTO;
    // Acotado entre 1 minuto y 7 días: sin esto, ?minutos=abc terminaba en un
    // intervalo 'NaN minutes' (500) y un número enorme volcaba la tabla entera.
    const minutos = Math.min(Math.max(Number(req.query.minutos) || 180, 1), 7 * 24 * 60);
    const { rows } = await pool.query(
      `SELECT l.nivel_cm, l.porcentaje, l.estado, l.medido_en
       FROM lecturas l JOIN sensores s ON s.id = l.sensor_id
       WHERE s.codigo = $1 AND l.medido_en >= now() - ($2 || ' minutes')::interval
       ORDER BY l.medido_en ASC`,
      [sensorCodigo, minutos]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Registra una medición. Hoy la usa el simulador (npm run simulate); cuando
// el ESP32 esté conectado por SerialPort, seguirá siendo el mismo punto de
// entrada (procesarLectura) llamado directamente en vez de vía HTTP.
router.post(
  "/",
  limitadorLecturas,
  requerirApiKeySensor,
  validarBody(lecturaSchema),
  async (req, res, next) => {
    try {
      const { sensor_codigo: sensorCodigo = SENSOR_POR_DEFECTO, nivel_cm: nivelCm } = req.body;

      const { lectura, evento } = await procesarLectura({ sensorCodigo, nivelCm });
      transmitir("lectura", lectura);

      if (evento) {
        transmitir("evento_alerta", evento);
        await avisarCambioEstado(evento);
      }

      res.status(201).json({ lectura, evento });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
