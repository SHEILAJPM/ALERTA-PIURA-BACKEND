import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decidirCambio,
  formatearDuracion,
  mensajesCaida,
  mensajesRecuperado,
  revisarSensores,
} from "../src/servicios/sensorCaido.js";
import { chatsAdministradores } from "../src/servicios/telegram.js";
import { pool } from "../bd/pool.js";

const AHORA = new Date("2026-11-15T21:00:00Z");
const haceMin = (m) => new Date(AHORA.getTime() - m * 60000);
const SENSOR = { id: "uuid-1", codigo: "RIO-PIURA-01", nombre: "Puente Bolognesi" };

test("decidirCambio: más de 30 min sin lecturas y sin caída abierta -> caida", () => {
  assert.equal(decidirCambio({ ultimaLecturaEn: haceMin(45), caidaAbierta: false, ahora: AHORA }), "caida");
});

test("decidirCambio: ya avisado (caída abierta) no vuelve a avisar", () => {
  assert.equal(decidirCambio({ ultimaLecturaEn: haceMin(300), caidaAbierta: true, ahora: AHORA }), null);
});

test("decidirCambio: vuelve a reportar con caída abierta -> recuperado", () => {
  assert.equal(
    decidirCambio({ ultimaLecturaEn: haceMin(1), caidaAbierta: true, ahora: AHORA }),
    "recuperado"
  );
});

test("decidirCambio: reportando normal no hace nada", () => {
  assert.equal(decidirCambio({ ultimaLecturaEn: haceMin(2), caidaAbierta: false, ahora: AHORA }), null);
});

test("decidirCambio: un sensor que nunca reportó no cuenta como caído", () => {
  assert.equal(decidirCambio({ ultimaLecturaEn: null, caidaAbierta: false, ahora: AHORA }), null);
});

test("formatearDuracion: minutos, horas y días", () => {
  assert.equal(formatearDuracion(40 * 60000), "40 min");
  assert.equal(formatearDuracion(5 * 3600000), "5 h");
  assert.equal(formatearDuracion(5 * 24 * 3600000), "5 días");
});

test("mensajesCaida y mensajesRecuperado: nombran el sensor y el tiempo", () => {
  const caida = mensajesCaida(SENSOR, haceMin(120), AHORA);
  assert.match(caida.telegram, /RIO-PIURA-01 \(Puente Bolognesi\) sin señal/);
  assert.match(caida.texto, /hace 2 h/);
  const vuelta = mensajesRecuperado(SENSOR, haceMin(120), AHORA);
  assert.match(vuelta.telegram, /volvió a reportar tras 2 h/);
});

test("chatsAdministradores: lee ids separados por coma y descarta basura", () => {
  assert.deepEqual(chatsAdministradores(" 123, -456 ,abc,,789"), ["123", "-456", "789"]);
  assert.deepEqual(chatsAdministradores(undefined), []);
});

function mockBase(t, filasSensores, { insertRowCount = 1 } = {}) {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql: sql.trim().split(/\s+/).slice(0, 2).join(" "), params });
    if (sql.includes("FROM sensores")) return { rows: filasSensores };
    if (sql.includes("INSERT INTO caidas_sensor")) return { rowCount: insertRowCount, rows: [] };
    if (sql.includes("UPDATE caidas_sensor")) return { rowCount: 1, rows: [] };
    if (sql.includes("FROM usuarios")) return { rows: [] };
    throw new Error(`consulta inesperada: ${sql}`);
  });
  return consultas;
}

test("revisarSensores: abre la caída y avisa una vez", async (t) => {
  const consultas = mockBase(t, [
    { ...SENSOR, ultima_lectura_en: haceMin(90), caida_id: null, caida_desde: null },
  ]);
  assert.equal(await revisarSensores({ ahora: AHORA }), 1);
  assert.ok(consultas.some((c) => c.sql === "INSERT INTO"));
});

test("revisarSensores: si otro proceso ya abrió la caída, no avisa de nuevo", async (t) => {
  mockBase(t, [{ ...SENSOR, ultima_lectura_en: haceMin(90), caida_id: null, caida_desde: null }], {
    insertRowCount: 0,
  });
  assert.equal(await revisarSensores({ ahora: AHORA }), 0);
});

test("revisarSensores: al volver cierra la caída con la hora de la nueva lectura", async (t) => {
  const consultas = mockBase(t, [
    { ...SENSOR, ultima_lectura_en: haceMin(1), caida_id: 7, caida_desde: haceMin(600) },
  ]);
  assert.equal(await revisarSensores({ ahora: AHORA }), 1);
  const update = consultas.find((c) => c.sql === "UPDATE caidas_sensor");
  assert.equal(update.params[0], 7);
});
