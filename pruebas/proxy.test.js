import { test } from "node:test";
import assert from "node:assert/strict";
import { ipCliente, saltosProxy } from "../src/utilidades/proxy.js";

function request(remoteAddress, xff) {
  return { socket: { remoteAddress }, headers: xff ? { "x-forwarded-for": xff } : {} };
}

test("ipCliente: sin proxy de confianza ignora X-Forwarded-For (no se puede falsear)", () => {
  assert.equal(ipCliente(request("10.0.0.1", "1.2.3.4"), 0), "10.0.0.1");
});

test("ipCliente: con 1 proxy toma la IP que agregó ese proxy", () => {
  assert.equal(ipCliente(request("10.0.0.1", "1.2.3.4"), 1), "1.2.3.4");
});

test("ipCliente: con 1 proxy ignora lo que el cliente inventó más a la izquierda", () => {
  assert.equal(ipCliente(request("10.0.0.1", "6.6.6.6, 1.2.3.4"), 1), "1.2.3.4");
});

test("ipCliente: con más saltos que entradas usa la más lejana disponible", () => {
  assert.equal(ipCliente(request("10.0.0.1", "1.2.3.4"), 3), "1.2.3.4");
  assert.equal(ipCliente(request("10.0.0.1"), 1), "10.0.0.1");
});

test("saltosProxy: lee TRUST_PROXY y descarta valores inválidos", () => {
  const original = process.env.TRUST_PROXY;
  try {
    process.env.TRUST_PROXY = "1";
    assert.equal(saltosProxy(), 1);
    for (const valor of ["", "0", "-2", "true", "abc"]) {
      process.env.TRUST_PROXY = valor;
      assert.equal(saltosProxy(), 0, `TRUST_PROXY="${valor}"`);
    }
  } finally {
    if (original === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = original;
  }
});
