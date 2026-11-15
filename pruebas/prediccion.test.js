import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularTendencia, evaluarRiesgo } from "../src/servicios/prediccion.js";

const SUBIENDO = { disponible: true, minutosParaAlerta: 40, pendienteCmPorMin: 0.5 };
const ESTABLE = { disponible: false, motivo: "El nivel no muestra tendencia de subida" };
const lluvia = (intensidad, maxima_mm_h = 0) => ({ disponible: true, intensidad, maxima_mm_h });

test("evaluarRiesgo: río subiendo + lluvia fuerte = riesgo alto", () => {
  const riesgo = evaluarRiesgo(SUBIENDO, lluvia("fuerte", 9.2));
  assert.equal(riesgo.nivel, "alto");
  assert.match(riesgo.mensaje, /lluvia fuerte \(9.2 mm\/h\)/);
});

test("evaluarRiesgo: río subiendo + lluvia moderada también es alto", () => {
  assert.equal(evaluarRiesgo(SUBIENDO, lluvia("moderada", 4)).nivel, "alto");
});

test("evaluarRiesgo: río subiendo sin lluvia importante = medio", () => {
  assert.equal(evaluarRiesgo(SUBIENDO, lluvia("ligera", 1)).nivel, "medio");
});

test("evaluarRiesgo: río estable pero viene lluvia fuerte = medio", () => {
  const riesgo = evaluarRiesgo(ESTABLE, lluvia("fuerte", 12));
  assert.equal(riesgo.nivel, "medio");
  assert.match(riesgo.mensaje, /puede empezar a subir/);
});

test("evaluarRiesgo: río estable y sin lluvia = bajo", () => {
  assert.equal(evaluarRiesgo(ESTABLE, lluvia("sin_lluvia")).nivel, "bajo");
});

test("evaluarRiesgo: si Open-Meteo no respondió, decide solo con el sensor", () => {
  const riesgo = evaluarRiesgo(SUBIENDO, null);
  assert.equal(riesgo.nivel, "medio");
  assert.match(riesgo.mensaje, /no disponible/);
  assert.equal(evaluarRiesgo(ESTABLE, null).nivel, "bajo");
});

test("calcularTendencia: sin suficientes puntos no está disponible", () => {
  const resultado = calcularTendencia([{ x: 0, y: 5 }], 16);
  assert.equal(resultado.disponible, false);
});

test("calcularTendencia: nivel estable no está disponible", () => {
  const puntos = [
    { x: 0, y: 5 },
    { x: 1, y: 5 },
    { x: 2, y: 5 },
  ];
  const resultado = calcularTendencia(puntos, 16);
  assert.equal(resultado.disponible, false);
  assert.equal(resultado.motivo, "El nivel no muestra tendencia de subida");
});

test("calcularTendencia: sube 1cm/min, calcula minutos hasta alerta roja", () => {
  const puntos = [
    { x: 0, y: 6 },
    { x: 1, y: 7 },
    { x: 2, y: 8 },
    { x: 3, y: 9 },
  ];
  const resultado = calcularTendencia(puntos, 16);
  assert.equal(resultado.disponible, true);
  assert.equal(resultado.pendienteCmPorMin, 1);
  // nivel actual 9cm, umbral 16cm, pendiente 1cm/min -> 7 minutos
  assert.equal(resultado.minutosParaAlerta, 7);
});

test("calcularTendencia: si ya superó el umbral, minutos es 0 (no negativo)", () => {
  const puntos = [
    { x: 0, y: 10 },
    { x: 1, y: 20 },
  ];
  const resultado = calcularTendencia(puntos, 16);
  assert.equal(resultado.disponible, true);
  assert.equal(resultado.minutosParaAlerta, 0);
});
