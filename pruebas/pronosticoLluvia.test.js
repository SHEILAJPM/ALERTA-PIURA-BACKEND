import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clasificarIntensidad,
  resumirPronostico,
  obtenerPronosticoLluvia,
  limpiarCacheLluvia,
} from "../src/servicios/pronosticoLluvia.js";

function mockFetch(t, implementacion) {
  const original = global.fetch;
  let llamadas = 0;
  global.fetch = async (...args) => {
    llamadas++;
    return implementacion(...args);
  };
  t.after(() => {
    global.fetch = original;
  });
  return () => llamadas;
}

function respuestaOpenMeteo(precipitacion, probabilidad) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      hourly: {
        time: precipitacion.map((_, i) => `2026-11-15T${String(i).padStart(2, "0")}:00`),
        precipitation: precipitacion,
        precipitation_probability: probabilidad,
      },
    }),
  };
}

beforeEach(() => limpiarCacheLluvia());

test("clasificarIntensidad: umbrales de la OMM", () => {
  assert.equal(clasificarIntensidad(0), "sin_lluvia");
  assert.equal(clasificarIntensidad(1), "ligera");
  assert.equal(clasificarIntensidad(2.5), "moderada");
  assert.equal(clasificarIntensidad(7.6), "moderada");
  assert.equal(clasificarIntensidad(12), "fuerte");
});

test("resumirPronostico: suma el total y encuentra la hora más lluviosa", () => {
  const resumen = resumirPronostico({
    time: ["2026-11-15T15:00", "2026-11-15T16:00", "2026-11-15T17:00"],
    precipitation: [0.3, 9.2, 1.0],
    precipitation_probability: [20, 85, 60],
  });
  assert.deepEqual(resumen, {
    disponible: true,
    horas: 3,
    total_mm: 10.5,
    maxima_mm_h: 9.2,
    hora_maxima: "2026-11-15T16:00",
    probabilidad_max: 85,
    intensidad: "fuerte",
  });
});

test("resumirPronostico: sin lluvia no marca hora máxima", () => {
  const resumen = resumirPronostico({
    time: ["2026-11-15T15:00", "2026-11-15T16:00"],
    precipitation: [0, 0],
    precipitation_probability: [0, 5],
  });
  assert.equal(resumen.intensidad, "sin_lluvia");
  assert.equal(resumen.hora_maxima, null);
});

test("resumirPronostico: valores null de Open-Meteo cuentan como 0", () => {
  const resumen = resumirPronostico({
    time: ["2026-11-15T15:00", "2026-11-15T16:00"],
    precipitation: [null, 3],
  });
  assert.equal(resumen.total_mm, 3);
  assert.equal(resumen.probabilidad_max, 0);
});

test("resumirPronostico: formato inesperado devuelve null", () => {
  assert.equal(resumirPronostico(undefined), null);
  assert.equal(resumirPronostico({ time: [], precipitation: [] }), null);
});

test("obtenerPronosticoLluvia: consulta Open-Meteo con las coordenadas y la zona horaria de Lima", async (t) => {
  let urlPedida;
  mockFetch(t, async (url) => {
    urlPedida = new URL(url);
    return respuestaOpenMeteo([0, 4], [10, 70]);
  });

  const resumen = await obtenerPronosticoLluvia(-5.19, -80.63);
  assert.equal(resumen.intensidad, "moderada");
  assert.equal(urlPedida.searchParams.get("latitude"), "-5.19");
  assert.equal(urlPedida.searchParams.get("longitude"), "-80.63");
  assert.equal(urlPedida.searchParams.get("timezone"), "America/Lima");
});

test("obtenerPronosticoLluvia: la segunda consulta sale del cache", async (t) => {
  const llamadas = mockFetch(t, async () => respuestaOpenMeteo([1], [50]));

  await obtenerPronosticoLluvia(-5.19, -80.63);
  await obtenerPronosticoLluvia(-5.191, -80.629); // mismo punto redondeado
  assert.equal(llamadas(), 1);
});

test("obtenerPronosticoLluvia: si Open-Meteo falla devuelve null y no lanza", async (t) => {
  mockFetch(t, async () => ({ ok: false, status: 503, json: async () => ({}) }));
  assert.equal(await obtenerPronosticoLluvia(-5.19, -80.63), null);

  limpiarCacheLluvia();
  mockFetch(t, async () => {
    throw new Error("sin red");
  });
  assert.equal(await obtenerPronosticoLluvia(-5.19, -80.63), null);
});

test("obtenerPronosticoLluvia: un fallo no se guarda en cache", async (t) => {
  let falla = true;
  const llamadas = mockFetch(t, async () =>
    falla ? { ok: false, status: 500, json: async () => ({}) } : respuestaOpenMeteo([0], [0])
  );

  assert.equal(await obtenerPronosticoLluvia(-5.19, -80.63), null);
  falla = false;
  assert.equal((await obtenerPronosticoLluvia(-5.19, -80.63)).disponible, true);
  assert.equal(llamadas(), 2);
});
