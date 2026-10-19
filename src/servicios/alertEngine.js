import { pool } from "../../bd/pool.js";

export function calcularEstado(nivelCm, prealertaCm, alertaRojaCm) {
  if (nivelCm >= alertaRojaCm) return "alerta_roja";
  if (nivelCm >= prealertaCm) return "prealerta";
  return "normal";
}

// Punto de entrada único para registrar una medición, sin importar si viene
// del ESP32 (SerialPort), del simulador, o de un POST manual de prueba.
// Inserta la lectura y, si el estado cambió respecto al último evento
// registrado, crea un nuevo eventos_alerta.
//
// Todo va en una transacción con la fila del sensor bloqueada (FOR UPDATE):
// sin eso, dos lecturas casi simultáneas (reintento del ESP32 + simulador,
// serial + POST) podían leer ambas el mismo "último evento", insertar dos
// eventos_alerta iguales y mandar la misma alerta dos veces por Telegram/SMS.
// El bloqueo es por sensor, así que lecturas de sensores distintos no se esperan.
export async function procesarLectura({ sensorCodigo, nivelCm }) {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const resultado = await procesarEnTransaccion(cliente, { sensorCodigo, nivelCm });
    await cliente.query("COMMIT");
    return resultado;
  } catch (err) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}

async function procesarEnTransaccion(cliente, { sensorCodigo, nivelCm }) {
  const { rows: sensorRows } = await cliente.query(
    `SELECT id, nivel_prealerta_cm, nivel_alerta_roja_cm
     FROM sensores WHERE codigo = $1 AND activo = true
     FOR UPDATE`,
    [sensorCodigo]
  );
  if (sensorRows.length === 0) {
    const error = new Error(`Sensor '${sensorCodigo}' no existe o está inactivo`);
    error.status = 404;
    throw error;
  }
  const sensor = sensorRows[0];
  const estado = calcularEstado(nivelCm, sensor.nivel_prealerta_cm, sensor.nivel_alerta_roja_cm);
  const porcentaje = Math.min(100, (nivelCm / sensor.nivel_alerta_roja_cm) * 100);

  const { rows: lecturaRows } = await cliente.query(
    `INSERT INTO lecturas (sensor_id, nivel_cm, porcentaje, estado)
     VALUES ($1, $2, $3, $4)
     RETURNING id, medido_en`,
    [sensor.id, nivelCm, porcentaje.toFixed(2), estado]
  );
  const lectura = {
    ...lecturaRows[0],
    sensor_id: sensor.id,
    sensor_codigo: sensorCodigo,
    nivel_cm: nivelCm,
    porcentaje: Number(porcentaje.toFixed(2)),
    estado,
  };

  const { rows: ultimoEvento } = await cliente.query(
    `SELECT estado_nuevo FROM eventos_alerta
     WHERE sensor_id = $1 ORDER BY iniciado_en DESC LIMIT 1`,
    [sensor.id]
  );
  const estadoAnterior = ultimoEvento[0]?.estado_nuevo ?? null;

  let evento = null;
  if (estadoAnterior !== estado) {
    const { rows: eventoRows } = await cliente.query(
      `INSERT INTO eventos_alerta (sensor_id, estado_anterior, estado_nuevo, nivel_cm)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [sensor.id, estadoAnterior, estado, nivelCm]
    );
    evento = { ...eventoRows[0], sensor_codigo: sensorCodigo };
  }

  return { lectura, evento };
}
