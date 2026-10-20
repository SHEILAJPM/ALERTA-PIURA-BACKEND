import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearNivel } from "../src/servicios/serialIngest.js";

test("parsearNivel: acepta número plano y JSON con nivel_cm", () => {
  assert.equal(parsearNivel("12.4\r"), 12.4);
  assert.equal(parsearNivel('{"nivel_cm":250}'), 250);
});

test("parsearNivel: ignora líneas vacías o que no son número", () => {
  assert.equal(parsearNivel(""), null);
  assert.equal(parsearNivel("   "), null);
  assert.equal(parsearNivel("hola"), null);
  assert.equal(parsearNivel('{"nivel_cm":"12"}'), null);
});

test("parsearNivel: descarta lecturas fuera de 0-2000 cm", () => {
  assert.equal(parsearNivel("-5"), null);
  assert.equal(parsearNivel("99999"), null);
  assert.equal(parsearNivel('{"nivel_cm":2001}'), null);
  assert.equal(parsearNivel("0"), 0);
  assert.equal(parsearNivel("2000"), 2000);
});
