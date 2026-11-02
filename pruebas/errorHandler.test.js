import { test } from "node:test";
import assert from "node:assert/strict";
import { manejadorErrores } from "../src/intermediarios/errorHandler.js";

function crearResFalso() {
  const res = { statusCode: null, body: null };
  res.status = (codigo) => {
    res.statusCode = codigo;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

test("manejadorErrores: preserva status y mensaje de errores operacionales", () => {
  const res = crearResFalso();
  const error = Object.assign(new Error("Sensor no existe"), { status: 404 });
  manejadorErrores(error, {}, res, () => {});
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "Sensor no existe" });
});

test("manejadorErrores: enmascara errores inesperados con mensaje genérico", () => {
  const res = crearResFalso();
  const error = new Error("relation lecturas does not exist (detalle interno de SQL)");
  manejadorErrores(error, {}, res, () => {});
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "Error interno del servidor" });
});

test("manejadorErrores: responde 400 cuando Postgres rechaza un id mal formado", () => {
  const res = crearResFalso();
  const error = Object.assign(new Error('invalid input syntax for type uuid: "abc"'), { code: "22P02" });
  manejadorErrores(error, {}, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "Identificador con formato inválido" });
});
