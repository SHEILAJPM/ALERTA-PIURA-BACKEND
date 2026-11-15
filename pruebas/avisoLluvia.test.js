import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  debeAvisarLluvia,
  mensajeAvisoLluvia,
  intensidadMinima,
  revisarLluviaFuerte,
} from "../src/servicios/avisoLluvia.js";
import { limpiarCacheLluvia } from "../src/servicios/pronosticoLluvia.js";
import { pool } from "../bd/pool.js";

const AHORA = new Date("2026-11-15T12:00:00Z");
const FUERTE = {
  disponible: true,
  intensidad: "fuerte",
  maxima_mm_h: 9.2,
  total_mm: 31.5,
  probabilidad_max: 85,
  hora_maxima: "2026-11-15T16:00",
};
const haceHoras = (h) => new Date(AHORA.getTime() - h * 60 * 60 * 1000);

beforeEach(() => limpiarCacheLluvia());

test("debeAvisarLluvia: lluvia fuerte probable y sin avisos previos -> avisa", () => {
  assert.equal(debeAvisarLluvia(FUERTE, null, { ahora: AHORA }), true);
});

test("debeAvisarLluvia: lluvia moderada no alcanza el mínimo por defecto", () => {
  assert.equal(debeAvisarLluvia({ ...FUERTE, intensidad: "moderada" }, null, { ahora: AHORA }), false);
});

test("debeAvisarLluvia: con probabilidad baja no avisa (evita falsas alarmas)", () => {
  assert.equal(debeAvisarLluvia({ ...FUERTE, probabilidad_max: 30 }, null, { ahora: AHORA }), false);
});

test("debeAvisarLluvia: no repite el aviso antes de 6 horas", () => {
  assert.equal(debeAvisarLluvia(FUERTE, haceHoras(2), { ahora: AHORA }), false);
  assert.equal(debeAvisarLluvia(FUERTE, haceHoras(7), { ahora: AHORA }), true);
});

test("debeAvisarLluvia: sin pronóstico (Open-Meteo caído) no avisa", () => {
  assert.equal(debeAvisarLluvia(null, null, { ahora: AHORA }), false);
});

test("debeAvisarLluvia: con mínimo 'ligera' (modo demo) también avisa lluvia ligera", () => {
  const ligera = { ...FUERTE, intensidad: "ligera", maxima_mm_h: 0.9 };
  assert.equal(debeAvisarLluvia(ligera, null, { minima: "ligera", ahora: AHORA }), true);
  assert.equal(debeAvisarLluvia({ ...ligera, intensidad: "sin_lluvia" }, null, { minima: "ligera" }), false);
});

test("intensidadMinima: lee AVISO_LLUVIA_INTENSIDAD y descarta valores inválidos", (t) => {
  const original = process.env.AVISO_LLUVIA_INTENSIDAD;
  t.after(() => {
    if (original === undefined) delete process.env.AVISO_LLUVIA_INTENSIDAD;
    else process.env.AVISO_LLUVIA_INTENSIDAD = original;
  });

  delete process.env.AVISO_LLUVIA_INTENSIDAD;
  assert.equal(intensidadMinima(), "fuerte");
  process.env.AVISO_LLUVIA_INTENSIDAD = "ligera";
  assert.equal(intensidadMinima(), "ligera");
  process.env.AVISO_LLUVIA_INTENSIDAD = "sin_lluvia";
  assert.equal(intensidadMinima(), "fuerte");
  process.env.AVISO_LLUVIA_INTENSIDAD = "cualquiera";
  assert.equal(intensidadMinima(), "fuerte");
});

test("mensajeAvisoLluvia: incluye sensor, intensidad, hora local y probabilidad", () => {
  const mensaje = mensajeAvisoLluvia("Puente Sánchez Cerro", FUERTE);
  assert.match(mensaje, /lluvia fuerte cerca de Puente Sánchez Cerro/);
  assert.match(mensaje, /hasta 9.2 mm\/h hacia las 16:00 del 15\/11/);
  assert.match(mensaje, /31.5 mm en 24 h, probabilidad 85 %/);
});

function mockOpenMeteo(t, mmPorHora, probabilidad) {
  const original = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      hourly: {
        time: ["2026-11-15T15:00", "2026-11-15T16:00"],
        precipitation: [1, mmPorHora],
        precipitation_probability: [40, probabilidad],
      },
    }),
  });
  t.after(() => {
    global.fetch = original;
  });
}

function mockBase(t, sensores) {
  const inserts = [];
  t.mock.method(pool, "query", async (sql, params) => {
    if (sql.includes("FROM sensores")) return { rows: sensores };
    if (sql.includes("INSERT INTO avisos_lluvia")) {
      inserts.push(params);
      return { rows: [] };
    }
    throw new Error(`consulta inesperada: ${sql}`);
  });
  return inserts;
}

const SENSOR = { id: "uuid-1", codigo: "RIO-PIURA-01", nombre: "Río Piura", lat: -5.19, lon: -80.63 };

test("revisarLluviaFuerte: con lluvia fuerte registra y manda el aviso", async (t) => {
  mockOpenMeteo(t, 12, 90);
  const inserts = mockBase(t, [{ ...SENSOR, ultimo_aviso: null }]);

  const enviados = await revisarLluviaFuerte({ ahora: AHORA });
  assert.equal(enviados, 1);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][0], "uuid-1");
  assert.equal(inserts[0][1], "fuerte");
  assert.match(inserts[0][6], /Río Piura/);
});

test("revisarLluviaFuerte: si ya se avisó hace poco no vuelve a mandar", async (t) => {
  mockOpenMeteo(t, 12, 90);
  const inserts = mockBase(t, [{ ...SENSOR, ultimo_aviso: haceHoras(1) }]);

  assert.equal(await revisarLluviaFuerte({ ahora: AHORA }), 0);
  assert.equal(inserts.length, 0);
});

test("revisarLluviaFuerte: con lluvia ligera no manda nada", async (t) => {
  mockOpenMeteo(t, 1.2, 90);
  const inserts = mockBase(t, [{ ...SENSOR, ultimo_aviso: null }]);

  assert.equal(await revisarLluviaFuerte({ ahora: AHORA }), 0);
  assert.equal(inserts.length, 0);
});
