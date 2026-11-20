import { Router } from "express";
import { pool } from "../../bd/pool.js";
import { transmitirRestringido } from "../servicios/websocket.js";
import { validarBody } from "../intermediarios/validate.js";
import { sosSchema, sosEstadoSchema } from "../validacion/schemas.js";
import { limitadorSOS } from "../intermediarios/rateLimit.js";
import { requerirSesion, requerirRol, autenticacionOpcional } from "../intermediarios/auth.js";

const router = Router();

// Quién puede ver una alerta SOS (ubicación exacta, nombre, teléfono): mismo
// criterio en el GET/PATCH de abajo y en la transmisión por WebSocket -- ver
// transmitirRestringido en websocket.js.
const ROLES_SOS = ["administrador", "defensa_civil"];

// Botón de pánico: no requiere sesión (mismo criterio que reportes_ciudadanos
// -- una emergencia real no debería esperar un login). Se transmite por
// WebSocket para que la Consola de Despacho lo muestre al instante.
router.post("/", autenticacionOpcional, limitadorSOS, validarBody(sosSchema), async (req, res, next) => {
  try {
    const { nombre_contacto: nombreContacto, telefono_contacto: telefonoContacto, lon, lat } = req.body;
    const usuarioId = req.usuario?.id ?? null;
    let nombreMostrado = nombreContacto ?? null;
    let telefonoMostrado = telefonoContacto ?? null;
    let apoyoEvacuacion = [];
    if (usuarioId) {
      // El JWT no trae teléfono (se emite liviano a propósito, ver
      // generarToken en servicios/auth.js) -- sin esto, telefono_contacto
      // quedaba siempre vacío para cualquier envío con sesión, sin importar
      // lo que la cuenta tuviera guardado. Los datos de la cuenta pisan lo
      // que haya venido en el body: son más confiables que texto libre.
      const { rows: perfilRows } = await pool.query(
        "SELECT nombre, telefono, apoyo_evacuacion FROM usuarios WHERE id = $1",
        [usuarioId]
      );
      // || (no ??): perfilSchema no exige mínimo de largo para teléfono
      // (ver validacion/schemas.js), así que una cuenta con telefono = ''
      // guardado no debería pisar un telefono_contacto real que sí vino en
      // el body -- '' es tan "sin dato" como null acá.
      nombreMostrado = perfilRows[0]?.nombre || nombreMostrado;
      telefonoMostrado = perfilRows[0]?.telefono || telefonoMostrado;
      apoyoEvacuacion = perfilRows[0]?.apoyo_evacuacion ?? [];
    }

    const { rows } = await pool.query(
      `INSERT INTO alertas_sos (usuario_id, nombre_contacto, telefono_contacto, ubicacion)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
         RETURNING id, estado, creado_en`,
      [usuarioId, nombreMostrado, telefonoMostrado, lon, lat]
    );

    const alerta = {
      ...rows[0],
      nombre_contacto: nombreMostrado,
      telefono_contacto: telefonoMostrado,
      ubicacion: { type: "Point", coordinates: [lon, lat] },
    };
    // El apoyo para evacuar (registro voluntario) va solo a Despacho, para
    // priorizar; no hace falta devolverlo a quien envió el SOS.
    transmitirRestringido("alerta_sos", { ...alerta, apoyo_evacuacion: apoyoEvacuacion }, ROLES_SOS);
    res.status(201).json(alerta);
  } catch (err) {
    next(err);
  }
});

// Panel de Defensa Civil/admin: solo lo pendiente por defecto (para que la
// consola de despacho no se llene de casos ya resueltos), con lo más
// reciente primero -- una emergencia nueva no debería quedar tapada.
router.get("/", requerirSesion, requerirRol(...ROLES_SOS), async (req, res, next) => {
  try {
    const soloPendientes = req.query.incluirAtendidas !== "true";
    const { rows } = await pool.query(
      // apoyo_evacuacion: lo que la persona registró voluntariamente en su
      // perfil (adulto mayor, gestante...), para que Despacho priorice. Un
      // SOS anónimo (sin cuenta) siempre trae lista vacía.
      `SELECT s.id, s.nombre_contacto, s.telefono_contacto, s.estado, s.creado_en, s.atendido_en,
              ST_AsGeoJSON(s.ubicacion)::json AS ubicacion,
              COALESCE(u.apoyo_evacuacion, '{}') AS apoyo_evacuacion
       FROM alertas_sos s
       LEFT JOIN usuarios u ON u.id = s.usuario_id
       WHERE $1 = false OR s.estado = 'pendiente'
       ORDER BY s.creado_en DESC`,
      [soloPendientes]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/:id/estado",
  requerirSesion,
  requerirRol(...ROLES_SOS),
  validarBody(sosEstadoSchema),
  async (req, res, next) => {
    try {
      // $2::varchar explícito en las dos apariciones: sin el cast, Postgres
      // deduce tipos distintos para el mismo parámetro (varchar por la
      // columna `estado`, text por la comparación con el literal) y rechaza
      // la consulta entera con "inconsistent types deduced for parameter $2".
      const { rows } = await pool.query(
        `UPDATE alertas_sos
         SET estado = $2::varchar, atendido_en = CASE WHEN $2::varchar = 'atendido' THEN now() ELSE NULL END
         WHERE id = $1
         RETURNING id, estado, atendido_en`,
        [req.params.id, req.body.estado]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Alerta no encontrada" });
      }

      transmitirRestringido("alerta_sos_actualizada", rows[0], ROLES_SOS);
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
