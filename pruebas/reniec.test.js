import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { consultarDni, limpiarCacheDni } from "../src/servicios/reniec.js";

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

function conToken(t) {
  const original = process.env.DNI_API_TOKEN;
  process.env.DNI_API_TOKEN = "token-de-prueba";
  t.after(() => {
    if (original === undefined) delete process.env.DNI_API_TOKEN;
    else process.env.DNI_API_TOKEN = original;
  });
}

beforeEach(() => limpiarCacheDni());

test("consultarDni: sin DNI_API_TOKEN, no llama a fetch y devuelve null", async (t) => {
  const original = process.env.DNI_API_TOKEN;
  delete process.env.DNI_API_TOKEN;
  t.after(() => {
    if (original !== undefined) process.env.DNI_API_TOKEN = original;
  });
  const llamadas = mockFetch(t, async () => {
    throw new Error("no debería llamarse");
  });

  assert.equal(await consultarDni("46027897"), null);
  assert.equal(llamadas(), 0);
});

test("consultarDni: DNI encontrado devuelve nombres y apellidos capitalizados", async (t) => {
  conToken(t);
  let urlPedida;
  let headers;
  mockFetch(t, async (url, opciones) => {
    urlPedida = url;
    headers = opciones.headers;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        first_name: "ROXANA KARINA",
        first_last_name: "DELGADO",
        second_last_name: "HUAMANI",
        document_number: "46027897",
      }),
    };
  });

  const resultado = await consultarDni("46027897");
  assert.deepEqual(resultado, { encontrado: true, nombre: "Roxana Karina Delgado Huamani" });
  assert.equal(urlPedida, "https://api.decolecta.com/v1/reniec/dni?numero=46027897");
  assert.equal(headers.Authorization, "Bearer token-de-prueba");
});

test("consultarDni: 404 del proveedor significa DNI inexistente", async (t) => {
  conToken(t);
  mockFetch(t, async () => ({ ok: false, status: 404, json: async () => ({ error: "not found" }) }));
  assert.deepEqual(await consultarDni("00000000"), { encontrado: false });
});

test("consultarDni: token inválido, sin cuota o caída devuelven null (no bloquean el registro)", async (t) => {
  conToken(t);
  for (const status of [401, 429, 500]) {
    limpiarCacheDni();
    mockFetch(t, async () => ({ ok: false, status, json: async () => ({}) }));
    assert.equal(await consultarDni("46027897"), null, `status ${status}`);
  }
  mockFetch(t, async () => {
    throw new Error("ECONNRESET");
  });
  assert.equal(await consultarDni("46027897"), null);
});

test("consultarDni: la segunda consulta del mismo DNI sale del cache", async (t) => {
  conToken(t);
  const llamadas = mockFetch(t, async () => ({
    ok: true,
    status: 200,
    json: async () => ({ first_name: "ANA", first_last_name: "PEREZ", second_last_name: "" }),
  }));

  assert.deepEqual(await consultarDni("12345678"), { encontrado: true, nombre: "Ana Perez" });
  assert.deepEqual(await consultarDni("12345678"), { encontrado: true, nombre: "Ana Perez" });
  assert.equal(llamadas(), 1);
});
