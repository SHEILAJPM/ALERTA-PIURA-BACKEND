import { Router } from "express";
import { pool } from "../../bd/pool.js";
import { requerirSesion, requerirRol } from "../intermediarios/auth.js";
import { construirResumenImpacto } from "../servicios/resumenImpacto.js";
import { construirIndicadoresODS } from "../servicios/indicadoresODS.js";

const router = Router();

// Resumen ejecutivo para mostrarle a Defensa Civil/la municipalidad: cuánta
// gente está cubierta por el sistema y cuánto se usó, en una sola pantalla.
// Todo son COUNT/MAX de tablas que ya existen -- no se agrega nada nuevo acá,
// solo se junta lo que ya se registra en cada función por separado.
router.get("/", requerirSesion, requerirRol("administrador", "defensa_civil"), async (_req, res, next) => {
  try {
    const [
      usuarios,
      telegram,
      push,
      alertasEnviadas,
      reportes,
      polizasVigentes,
      chequeosRecientes,
      avisosLluvia,
    ] = await Promise.all([
      pool.query("SELECT rol, count(*)::int AS cantidad FROM usuarios GROUP BY rol"),
      pool.query("SELECT count(*)::int AS cantidad FROM suscriptores_telegram WHERE activo = true"),
      pool.query("SELECT count(*)::int AS cantidad FROM push_subscriptions"),
      pool.query("SELECT count(*)::int AS cantidad FROM eventos_alerta WHERE notificado_telegram = true"),
      pool.query(`SELECT estado, count(*)::int AS cantidad FROM reportes_ciudadanos GROUP BY estado`),
      pool.query("SELECT count(*)::int AS cantidad FROM polizas_seguro WHERE fecha_fin > now()"),
      pool.query(
        "SELECT count(DISTINCT usuario_id)::int AS cantidad FROM chequeos_seguridad WHERE creado_en > now() - interval '24 hours'"
      ),
      // Avisos preventivos por lluvia fuerte (ver avisoLluvia.js): llegan
      // antes que las alertas de cambio de estado, cuando el río sigue bajo.
      pool.query("SELECT count(*)::int AS cantidad FROM avisos_lluvia"),
    ]);

    res.json(
      construirResumenImpacto({
        usuariosPorRol: usuarios.rows,
        suscriptoresTelegram: telegram.rows[0].cantidad,
        suscriptoresPush: push.rows[0].cantidad,
        alertasEnviadas: alertasEnviadas.rows[0].cantidad,
        reportesPorEstado: reportes.rows,
        polizasVigentes: polizasVigentes.rows[0].cantidad,
        chequeosUltimas24h: chequeosRecientes.rows[0].cantidad,
        avisosLluvia: avisosLluvia.rows[0].cantidad,
      })
    );
  } catch (err) {
    next(err);
  }
});

// Indicadores alineados a los ODS y a la Meta G del Marco de Sendai (ver
// servicios/indicadoresODS.js). Igual que el resumen de arriba: solo consulta
// tablas que ya existen, no registra nada nuevo.
router.get("/ods", requerirSesion, requerirRol("administrador", "defensa_civil"), async (_req, res, next) => {
  try {
    const [
      alertasRojas,
      eventosPorEstado,
      telegram,
      push,
      sms,
      albergues,
      sos,
      sensoresActivos,
      caidas,
      reportes,
      polizas,
      avisosLluvia,
      chequeos,
      apoyo,
    ] = await Promise.all([
      // Para cada alerta roja: el evento inmediatamente anterior del mismo
      // sensor. Si fue una prealerta, la diferencia es el tiempo de anticipación.
      pool.query(
        `SELECT CASE WHEN previo.estado_nuevo = 'prealerta'
                     THEN EXTRACT(EPOCH FROM (r.iniciado_en - previo.iniciado_en)) / 60
                END AS minutos_desde_prealerta
         FROM eventos_alerta r
         LEFT JOIN LATERAL (
           SELECT e.estado_nuevo, e.iniciado_en
           FROM eventos_alerta e
           WHERE e.sensor_id = r.sensor_id AND e.iniciado_en < r.iniciado_en
           ORDER BY e.iniciado_en DESC
           LIMIT 1
         ) previo ON true
         WHERE r.estado_nuevo = 'alerta_roja'`
      ),
      pool.query("SELECT estado_nuevo, count(*)::int AS cantidad FROM eventos_alerta GROUP BY estado_nuevo"),
      pool.query("SELECT count(*)::int AS cantidad FROM suscriptores_telegram WHERE activo = true"),
      pool.query("SELECT count(*)::int AS cantidad FROM push_subscriptions"),
      pool.query(
        "SELECT count(*)::int AS cantidad FROM usuarios WHERE recibir_alertas_sms = true AND telefono IS NOT NULL AND activo = true"
      ),
      pool.query(
        `SELECT count(*)::int AS cantidad, COALESCE(sum(capacidad), 0)::int AS capacidad,
                COALESCE(sum(ocupacion_actual), 0)::int AS ocupacion
         FROM albergues WHERE activo = true`
      ),
      pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE estado = 'atendido')::int AS atendidos,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (atendido_en - creado_en)) / 60)
                  FILTER (WHERE atendido_en IS NOT NULL) AS mediana_minutos
         FROM alertas_sos`
      ),
      pool.query("SELECT count(*)::int AS cantidad FROM sensores WHERE activo = true"),
      // Horas sin señal dentro de los últimos 30 días (una caída abierta
      // cuenta hasta ahora; una que empezó antes de la ventana, desde su inicio).
      pool.query(
        `SELECT count(*)::int AS caidas,
                COALESCE(sum(EXTRACT(EPOCH FROM (
                  COALESCE(c.hasta, now()) - GREATEST(c.desde, now() - interval '30 days')
                ))) / 3600, 0) AS horas
         FROM caidas_sensor c
         JOIN sensores s ON s.id = c.sensor_id AND s.activo = true
         WHERE COALESCE(c.hasta, now()) > now() - interval '30 days'`
      ),
      pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE estado = 'verificado')::int AS verificados,
                count(*) FILTER (WHERE categoria = 'agua_estancada' AND estado <> 'descartado')::int AS agua_estancada,
                count(*) FILTER (WHERE categoria = 'agua_estancada' AND estado <> 'descartado'
                                   AND creado_en > now() - interval '30 days')::int AS agua_estancada_30d
         FROM reportes_ciudadanos`
      ),
      pool.query("SELECT count(*)::int AS cantidad FROM polizas_seguro WHERE fecha_fin > now()"),
      pool.query("SELECT count(*)::int AS cantidad FROM avisos_lluvia"),
      pool.query("SELECT count(*)::int AS cantidad FROM chequeos_seguridad"),
      pool.query(
        `SELECT
           (SELECT count(*)::int FROM usuarios
            WHERE cardinality(apoyo_evacuacion) > 0 AND activo = true) AS personas,
           (SELECT count(*)::int FROM alertas_sos s JOIN usuarios u ON u.id = s.usuario_id
            WHERE cardinality(u.apoyo_evacuacion) > 0) AS sos`
      ),
    ]);

    res.json(
      construirIndicadoresODS({
        alertasRojas: alertasRojas.rows.map((r) => ({
          minutos_desde_prealerta:
            r.minutos_desde_prealerta === null ? null : Number(r.minutos_desde_prealerta),
        })),
        eventosPorEstado: eventosPorEstado.rows,
        cobertura: {
          telegram: telegram.rows[0].cantidad,
          push: push.rows[0].cantidad,
          sms: sms.rows[0].cantidad,
        },
        albergues: albergues.rows[0],
        sos: {
          total: sos.rows[0].total,
          atendidos: sos.rows[0].atendidos,
          mediana_minutos: sos.rows[0].mediana_minutos === null ? null : Number(sos.rows[0].mediana_minutos),
        },
        red: {
          sensores_activos: sensoresActivos.rows[0].cantidad,
          caidas_30d: caidas.rows[0].caidas,
          horas_caida_30d: Number(caidas.rows[0].horas),
        },
        reportes: reportes.rows[0],
        polizasVigentes: polizas.rows[0].cantidad,
        avisosLluvia: avisosLluvia.rows[0].cantidad,
        chequeosSeguridad: chequeos.rows[0].cantidad,
        apoyo: apoyo.rows[0],
      })
    );
  } catch (err) {
    next(err);
  }
});

export default router;
