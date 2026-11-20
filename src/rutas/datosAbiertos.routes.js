import { Router } from "express";
import cors from "cors";
import { pool } from "../../bd/pool.js";
import { datosAbiertosLecturasSchema } from "../validacion/schemas.js";
import {
  LICENCIA,
  SEGUNDOS_AGREGACION,
  DIAS_MAXIMOS,
  resolverRango,
  aCSV,
} from "../servicios/datosAbiertos.js";

// Datos abiertos (ODS 17.18): lecturas del río y cambios de estado, públicos,
// sin sesión y con licencia CC BY 4.0, para universidades, ANA, SENAMHI o
// cualquier persona. No incluye ningún dato personal: solo mediciones de los
// sensores. CORS abierto a cualquier origen a propósito (es información
// pública); el rate limit general de /api sigue aplicando.
const router = Router();
router.use(cors());

const COLUMNAS_AGREGADAS = [
  "sensor_codigo",
  "inicio_intervalo",
  "nivel_promedio_cm",
  "nivel_max_cm",
  "estado_mas_grave",
  "lecturas",
];
const COLUMNAS_CRUDAS = ["sensor_codigo", "medido_en", "nivel_cm", "porcentaje_umbral_rojo", "estado"];
const COLUMNAS_EVENTOS = [
  "sensor_codigo",
  "sensor_nombre",
  "iniciado_en",
  "estado_anterior",
  "estado_nuevo",
  "nivel_cm",
];
const MAX_FILAS_CRUDAS = 50_000;
const MAX_EVENTOS = 5_000;

function enviar(res, { formato, nombre, columnas, filas, extra = {} }) {
  res.set("Cache-Control", "public, max-age=300");
  if (formato === "csv") {
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${nombre}.csv"`);
    return res.send(aCSV(filas, columnas));
  }
  return res.json({ licencia: LICENCIA, ...extra, total: filas.length, datos: filas });
}

// Catálogo: qué se publica, cómo pedirlo y bajo qué licencia.
router.get("/", async (_req, res, next) => {
  try {
    const { rows: sensores } = await pool.query(
      `SELECT codigo, nombre, ST_X(ubicacion) AS lon, ST_Y(ubicacion) AS lat,
              nivel_prealerta_cm, nivel_alerta_roja_cm, activo
       FROM sensores ORDER BY codigo`
    );
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      titulo: "Datos abiertos de Piura Alerta",
      descripcion:
        "Nivel del río Piura medido por la red de sensores ciudadanos y su historial de alertas. Sin datos personales.",
      licencia: LICENCIA,
      sensores,
      recursos: [
        {
          nombre: "Lecturas del río",
          ruta: "/api/datos-abiertos/lecturas",
          parametros: {
            sensor: "código del sensor (obligatorio)",
            desde: "fecha ISO 8601 (opcional, por defecto hace 7 días)",
            hasta: "fecha ISO 8601 (opcional, por defecto ahora)",
            agregacion: `crudo | 5min | 15min | 1h | 1d (por defecto 15min). Rango máximo en días: ${JSON.stringify(
              DIAS_MAXIMOS
            )}`,
            formato: "json | csv (por defecto json)",
          },
        },
        {
          nombre: "Historial de alertas (cambios de estado del río)",
          ruta: "/api/datos-abiertos/eventos",
          parametros: { formato: "json | csv (por defecto json)" },
        },
      ],
    });
  } catch (err) {
    next(err);
  }
});

router.get("/lecturas", async (req, res, next) => {
  try {
    const consulta = datosAbiertosLecturasSchema.safeParse(req.query);
    if (!consulta.success) {
      const problema = consulta.error.issues[0];
      return res.status(400).json({ error: `${problema.path.join(".")}: ${problema.message}` });
    }
    const { sensor, agregacion, formato } = consulta.data;
    const rango = resolverRango(consulta.data);
    if (rango.error) return res.status(400).json({ error: rango.error });

    const { rows: encontrados } = await pool.query("SELECT id, codigo FROM sensores WHERE codigo = $1", [
      sensor,
    ]);
    if (encontrados.length === 0) return res.status(404).json({ error: `No existe el sensor "${sensor}"` });
    const { id: sensorId, codigo } = encontrados[0];

    let filas;
    if (agregacion === "crudo") {
      ({ rows: filas } = await pool.query(
        `SELECT $4::text AS sensor_codigo, medido_en, nivel_cm, porcentaje AS porcentaje_umbral_rojo, estado
         FROM lecturas
         WHERE sensor_id = $1 AND medido_en >= $2 AND medido_en < $3
         ORDER BY medido_en
         LIMIT ${MAX_FILAS_CRUDAS}`,
        [sensorId, rango.desde, rango.hasta, codigo]
      ));
    } else {
      ({ rows: filas } = await pool.query(
        `SELECT $5::text AS sensor_codigo,
                to_timestamp(floor(EXTRACT(EPOCH FROM medido_en) / $4) * $4) AS inicio_intervalo,
                round(avg(nivel_cm), 2) AS nivel_promedio_cm,
                max(nivel_cm) AS nivel_max_cm,
                CASE max(CASE estado WHEN 'alerta_roja' THEN 2 WHEN 'prealerta' THEN 1 ELSE 0 END)
                  WHEN 2 THEN 'alerta_roja' WHEN 1 THEN 'prealerta' ELSE 'normal'
                END AS estado_mas_grave,
                count(*)::int AS lecturas
         FROM lecturas
         WHERE sensor_id = $1 AND medido_en >= $2 AND medido_en < $3
         GROUP BY 2
         ORDER BY 2`,
        [sensorId, rango.desde, rango.hasta, SEGUNDOS_AGREGACION[agregacion], codigo]
      ));
    }

    enviar(res, {
      formato,
      nombre: `piura-alerta_${codigo}_${agregacion}_${rango.desde.toISOString().slice(0, 10)}_${rango.hasta
        .toISOString()
        .slice(0, 10)}`,
      columnas: agregacion === "crudo" ? COLUMNAS_CRUDAS : COLUMNAS_AGREGADAS,
      filas,
      extra: { sensor: codigo, agregacion, desde: rango.desde, hasta: rango.hasta },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/eventos", async (req, res, next) => {
  try {
    const formato = req.query.formato === "csv" ? "csv" : "json";
    const { rows } = await pool.query(
      `SELECT s.codigo AS sensor_codigo, s.nombre AS sensor_nombre, e.iniciado_en,
              e.estado_anterior, e.estado_nuevo, e.nivel_cm
       FROM eventos_alerta e
       JOIN sensores s ON s.id = e.sensor_id
       ORDER BY e.iniciado_en DESC
       LIMIT ${MAX_EVENTOS}`
    );
    enviar(res, {
      formato,
      nombre: "piura-alerta_historial-alertas",
      columnas: COLUMNAS_EVENTOS,
      filas: rows,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
