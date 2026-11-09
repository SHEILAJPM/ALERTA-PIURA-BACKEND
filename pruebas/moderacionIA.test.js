import { test } from "node:test";
import assert from "node:assert/strict";
import { analizarReporte, normalizarCalificacion } from "../src/servicios/moderacionIA.js";

function mockFetch(implementacion) {
  const original = global.fetch;
  global.fetch = implementacion;
  return () => {
    global.fetch = original;
  };
}

function respuestaOk(contenidoJson) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(contenidoJson) } }] }),
  };
}

const respuestaError = {
  ok: false,
  status: 400,
  json: async () => ({ error: { message: "modelo no existe" } }),
};

const CALIFICACION_APTA = {
  veredicto: "apto",
  puntaje: 92,
  imagen: { apta: true, comentario: "Calle inundada con agua hasta las rodillas" },
  descripcion: { apta: true, comentario: "Describe bien el lugar" },
  motivo: "Foto y texto coinciden",
};

const FOTO = "https://res.cloudinary.com/demo/foto.jpg";

test("analizarReporte: sin GROQ_API_KEY, no llama a fetch y devuelve null", async (t) => {
  const original = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  let llamado = false;
  const restaurar = mockFetch(async () => {
    llamado = true;
  });
  t.after(() => {
    restaurar();
    if (original !== undefined) process.env.GROQ_API_KEY = original;
  });

  assert.equal(await analizarReporte({ descripcion: "cualquier cosa" }), null);
  assert.equal(llamado, false);
});

test("analizarReporte: con foto usa el modelo de visión y manda la imagen", async (t) => {
  process.env.GROQ_API_KEY = "clave-de-prueba";
  const cuerpos = [];
  const restaurar = mockFetch(async (_url, opciones) => {
    cuerpos.push(JSON.parse(opciones.body));
    return respuestaOk(CALIFICACION_APTA);
  });
  t.after(restaurar);

  const resultado = await analizarReporte({ descripcion: "se inundó la calle Grau", fotoUrl: FOTO });

  assert.equal(cuerpos.length, 1);
  assert.equal(cuerpos[0].model, "qwen/qwen3.8-27b");
  assert.deepEqual(cuerpos[0].response_format, { type: "json_object" });
  assert.ok(cuerpos[0].messages[1].content.some((p) => p.type === "image_url" && p.image_url.url === FOTO));
  assert.deepEqual(resultado, {
    veredicto: "apto",
    puntaje: 92,
    motivo: "Foto y texto coinciden",
    imagen: { apta: true, comentario: "Calle inundada con agua hasta las rodillas" },
    descripcion: { apta: true, comentario: "Describe bien el lugar" },
    es_sospechoso: false,
    fuera_de_tema: false,
  });
});

test("analizarReporte: foto de otro tema queda no_apto (se archiva)", async (t) => {
  process.env.GROQ_API_KEY = "clave-de-prueba";
  const restaurar = mockFetch(async () =>
    respuestaOk({
      veredicto: "no_apto",
      puntaje: 5,
      imagen: { apta: false, comentario: "Un plato de ceviche" },
      descripcion: { apta: false, comentario: "No habla de una emergencia" },
      motivo: "La foto es de comida",
    })
  );
  t.after(restaurar);

  const resultado = await analizarReporte({ descripcion: "rico ceviche", fotoUrl: FOTO });
  assert.equal(resultado.veredicto, "no_apto");
  assert.equal(resultado.fuera_de_tema, true);
});

test("analizarReporte: si falla la visión, califica solo el texto y nunca archiva", async (t) => {
  process.env.GROQ_API_KEY = "clave-de-prueba";
  const modelos = [];
  const restaurar = mockFetch(async (_url, opciones) => {
    const cuerpo = JSON.parse(opciones.body);
    modelos.push(cuerpo.model);
    if (cuerpo.model === "qwen/qwen3.8-27b") return respuestaError;
    assert.ok(cuerpo.messages[1].content.every((p) => p.type === "text"));
    return respuestaOk({ ...CALIFICACION_APTA, veredicto: "no_apto", puntaje: 3 });
  });
  t.after(restaurar);

  const resultado = await analizarReporte({ descripcion: "asdf", fotoUrl: FOTO });
  assert.deepEqual(modelos, ["qwen/qwen3.8-27b", "openai/gpt-oss-20b"]);
  assert.equal(resultado.veredicto, "revisar");
  assert.equal(resultado.fuera_de_tema, false);
  assert.equal(resultado.imagen.apta, null);
  assert.match(resultado.imagen.comentario, /No se pudo analizar la foto/);
});

test("analizarReporte: si todo falla (red caída), devuelve null sin lanzar", async (t) => {
  process.env.GROQ_API_KEY = "clave-de-prueba";
  const restaurar = mockFetch(async () => {
    throw new Error("network error");
  });
  t.after(restaurar);

  assert.equal(await analizarReporte({ descripcion: "algo", fotoUrl: FOTO }), null);
});

test("analizarReporte: contenido que no es JSON o sin veredicto válido devuelve null", async (t) => {
  process.env.GROQ_API_KEY = "clave-de-prueba";
  const restaurar = mockFetch(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "esto no es json" } }] }),
  }));
  t.after(restaurar);
  assert.equal(await analizarReporte({ descripcion: "algo" }), null);

  global.fetch = async () => respuestaOk({ veredicto: "quizas", puntaje: 50 });
  assert.equal(await analizarReporte({ descripcion: "algo" }), null);
});

test("normalizarCalificacion: el puntaje nunca contradice al veredicto", () => {
  const opciones = { imagenAnalizada: true, teniaFoto: true };
  assert.equal(normalizarCalificacion({ veredicto: "no_apto", puntaje: 90 }, opciones).puntaje, 29);
  assert.equal(normalizarCalificacion({ veredicto: "apto", puntaje: 150 }, opciones).puntaje, 100);
  assert.equal(normalizarCalificacion({ veredicto: "apto", puntaje: 10 }, opciones).puntaje, 70);
  assert.equal(normalizarCalificacion({ veredicto: "revisar" }, opciones).puntaje, 50);
});

test("normalizarCalificacion: sin poder ver la foto, 'apto' también baja a 'revisar'", () => {
  const resultado = normalizarCalificacion(CALIFICACION_APTA, { imagenAnalizada: false, teniaFoto: true });
  assert.equal(resultado.veredicto, "revisar");
  assert.equal(resultado.es_sospechoso, true);
});
