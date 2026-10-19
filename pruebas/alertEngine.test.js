import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularEstado, procesarLectura } from "../src/servicios/alertEngine.js";
import { pool } from "../bd/pool.js";

test("calcularEstado: normal por debajo de prealerta", () => {
  assert.equal(calcularEstado(5, 10, 16), "normal");
});

test("calcularEstado: prealerta en el límite inferior", () => {
  assert.equal(calcularEstado(10, 10, 16), "prealerta");
});

test("calcularEstado: alerta_roja en el límite superior", () => {
  assert.equal(calcularEstado(16, 10, 16), "alerta_roja");
});

test("calcularEstado: alerta_roja por encima del umbral", () => {
  assert.equal(calcularEstado(25, 10, 16), "alerta_roja");
});

// Cliente de pool falso: responde según el SQL recibido y registra el orden.
function clienteFalso({ sensor, ultimoEstado, fallarEn } = {}) {
  const consultas = [];
  let liberado = false;
  return {
    consultas,
    get liberado() {
      return liberado;
    },
    release: () => {
      liberado = true;
    },
    async query(sql) {
      const texto = sql.trim();
      consultas.push(texto.split(/\s+/).slice(0, 3).join(" "));
      if (fallarEn && texto.startsWith(fallarEn)) throw new Error("falla simulada");
      if (texto.includes("FROM sensores")) return { rows: sensor ? [sensor] : [] };
      if (texto.startsWith("INSERT INTO lecturas")) return { rows: [{ id: 1, medido_en: new Date() }] };
      if (texto.includes("FROM eventos_alerta"))
        return { rows: ultimoEstado ? [{ estado_nuevo: ultimoEstado }] : [] };
      if (texto.startsWith("INSERT INTO eventos_alerta"))
        return { rows: [{ id: 9, estado_nuevo: "alerta_roja" }] };
      return { rows: [] };
    },
  };
}

const SENSOR = { id: 1, nivel_prealerta_cm: 10, nivel_alerta_roja_cm: 16 };

test("procesarLectura: bloquea el sensor dentro de una transacción y hace COMMIT", async (t) => {
  const cliente = clienteFalso({ sensor: SENSOR, ultimoEstado: "prealerta" });
  t.mock.method(pool, "connect", async () => cliente);

  const { evento } = await procesarLectura({ sensorCodigo: "RIO-PIURA-01", nivelCm: 20 });

  assert.equal(evento.estado_nuevo, "alerta_roja");
  assert.equal(cliente.consultas[0], "BEGIN");
  assert.equal(cliente.consultas.at(-1), "COMMIT");
  assert.ok(cliente.liberado);
});

test("procesarLectura: sin cambio de estado no crea evento", async (t) => {
  const cliente = clienteFalso({ sensor: SENSOR, ultimoEstado: "normal" });
  t.mock.method(pool, "connect", async () => cliente);

  const { evento } = await procesarLectura({ sensorCodigo: "RIO-PIURA-01", nivelCm: 5 });

  assert.equal(evento, null);
});

test("procesarLectura: si algo falla hace ROLLBACK y libera la conexión", async (t) => {
  const cliente = clienteFalso({ sensor: SENSOR, fallarEn: "INSERT INTO lecturas" });
  t.mock.method(pool, "connect", async () => cliente);

  await assert.rejects(procesarLectura({ sensorCodigo: "RIO-PIURA-01", nivelCm: 5 }), /falla simulada/);
  assert.equal(cliente.consultas.at(-1), "ROLLBACK");
  assert.ok(cliente.liberado);
});

test("procesarLectura: sensor inexistente responde 404 sin dejar la transacción abierta", async (t) => {
  const cliente = clienteFalso({ sensor: null });
  t.mock.method(pool, "connect", async () => cliente);

  await assert.rejects(
    procesarLectura({ sensorCodigo: "NO-EXISTE", nivelCm: 5 }),
    (err) => err.status === 404
  );
  assert.equal(cliente.consultas.at(-1), "ROLLBACK");
  assert.ok(cliente.liberado);
});
