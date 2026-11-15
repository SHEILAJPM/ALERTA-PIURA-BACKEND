import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularPuntaje, nivelDePuntaje } from "../src/servicios/puntajeRiesgo.js";
import { leerUbicacion } from "../src/rutas/riesgo.routes.js";

const BASE = { sensorCodigo: "RIO-PIURA-01", umbralRojoCm: 15 };
const SUBIENDO = { disponible: true, pendienteCmPorMin: 0.4, minutosParaAlerta: 11 };
const ESTABLE = { disponible: false, pendienteCmPorMin: 0 };
const MODERADA = { intensidad: "moderada", maxima_mm_h: 6.1, probabilidad_max: 85 };
const puntosDe = (resultado, clave) => resultado.factores.find((f) => f.clave === clave)?.puntos;

test("nivelDePuntaje: cortes en 35 y 65", () => {
  assert.equal(nivelDePuntaje(34), "bajo");
  assert.equal(nivelDePuntaje(35), "medio");
  assert.equal(nivelDePuntaje(64), "medio");
  assert.equal(nivelDePuntaje(65), "alto");
});

test("calcularPuntaje: caso del diseño (río subiendo, lluvia moderada, zona alta, albergue cerca) = alto", () => {
  const r = calcularPuntaje({
    ...BASE,
    nivelCm: 10.8,
    prediccion: SUBIENDO,
    lluvia: MODERADA,
    zona: { nombre: "Castilla", nivel_riesgo: "alto" },
    albergue: { nombre: "Albergue A", distancia_m: 1200 },
  });
  // río: round(0.72*30)=22 +10 = 32 · lluvia: round(15*0.85)=13 · zona 25 · albergue -5
  assert.equal(puntosDe(r, "rio"), 32);
  assert.equal(puntosDe(r, "lluvia"), 13);
  assert.equal(puntosDe(r, "zona"), 25);
  assert.equal(puntosDe(r, "albergue"), -5);
  assert.equal(r.puntaje, 65);
  assert.equal(r.nivel, "alto");
});

test("calcularPuntaje: cada factor dice de qué dato viene", () => {
  const r = calcularPuntaje({ ...BASE, nivelCm: 10.8, prediccion: SUBIENDO, lluvia: MODERADA, zona: null });
  assert.deepEqual(
    r.factores.map((f) => f.fuente),
    ["Sensor RIO-PIURA-01", "Pronóstico Open-Meteo", "Mapa de zonas de riesgo"]
  );
  assert.match(r.factores[0].texto, /sube 0.4 cm\/min y está al 72 %/);
});

test("calcularPuntaje: sin ubicación no incluye zona ni albergue", () => {
  const r = calcularPuntaje({ ...BASE, nivelCm: 6, prediccion: ESTABLE, lluvia: null });
  assert.deepEqual(
    r.factores.map((f) => f.clave),
    ["rio", "lluvia"]
  );
  assert.equal(r.nivel, "bajo");
});

test("calcularPuntaje: albergue a más de 2 km no resta", () => {
  const r = calcularPuntaje({
    ...BASE,
    nivelCm: 6,
    prediccion: ESTABLE,
    lluvia: null,
    zona: null,
    albergue: { nombre: "Lejos", distancia_m: 3500 },
  });
  assert.equal(puntosDe(r, "albergue"), undefined);
});

test("calcularPuntaje: sin lecturas el río suma 0 y lo dice", () => {
  const r = calcularPuntaje({ ...BASE, nivelCm: null, prediccion: null, lluvia: null });
  assert.equal(puntosDe(r, "rio"), 0);
  assert.match(r.factores[0].texto, /Sin lecturas recientes/);
});

test("calcularPuntaje: río sobre el límite no pasa de 40 y el total no pasa de 100", () => {
  const r = calcularPuntaje({
    ...BASE,
    nivelCm: 30,
    prediccion: SUBIENDO,
    lluvia: { intensidad: "fuerte", maxima_mm_h: 12, probabilidad_max: 100 },
    zona: { nombre: "Z", nivel_riesgo: "alto" },
  });
  assert.equal(puntosDe(r, "rio"), 40);
  assert.equal(r.puntaje, 90);
  assert.ok(r.puntaje <= 100);
});

test("calcularPuntaje: el puntaje nunca es negativo", () => {
  const r = calcularPuntaje({
    ...BASE,
    nivelCm: 0,
    prediccion: ESTABLE,
    lluvia: { intensidad: "sin_lluvia", maxima_mm_h: 0, probabilidad_max: 0 },
    zona: null,
    albergue: { nombre: "Cerca", distancia_m: 300 },
  });
  assert.equal(r.puntaje, 0);
});

test("leerUbicacion: sin lat ni lon es válido (sin ubicación)", () => {
  assert.deepEqual(leerUbicacion({}), { lat: null, lon: null });
});

test("leerUbicacion: convierte lat/lon a número", () => {
  assert.deepEqual(leerUbicacion({ lat: "-5.19", lon: "-80.63" }), { lat: -5.19, lon: -80.63 });
});

test("leerUbicacion: rechaza lat sin lon y valores fuera de rango", () => {
  assert.ok(leerUbicacion({ lat: "-5.19" }).error);
  assert.ok(leerUbicacion({ lat: "abc", lon: "-80" }).error);
  assert.ok(leerUbicacion({ lat: "-5", lon: "200" }).error);
});

test("calcularPuntaje: una lectura de hace más de 30 min no suma riesgo del río", () => {
  const ahora = new Date("2026-11-15T21:00:00Z");
  const r = calcularPuntaje({
    ...BASE,
    nivelCm: 10.8,
    medidoEn: new Date("2026-11-10T21:00:00Z"),
    ahora,
    prediccion: SUBIENDO,
    lluvia: null,
  });
  assert.equal(puntosDe(r, "rio"), 0);
  assert.match(r.factores[0].texto, /no reporta desde hace 120 h/);
});

test("calcularPuntaje: una lectura de hace 5 min sí cuenta", () => {
  const ahora = new Date("2026-11-15T21:00:00Z");
  const r = calcularPuntaje({
    ...BASE,
    nivelCm: 10.8,
    medidoEn: new Date("2026-11-15T20:55:00Z"),
    ahora,
    prediccion: SUBIENDO,
    lluvia: null,
  });
  assert.equal(puntosDe(r, "rio"), 32);
});

test("calcularPuntaje: avisa con datos_completos=false si al sensor o la lluvia les faltan datos", () => {
  const completo = calcularPuntaje({ ...BASE, nivelCm: 10.8, prediccion: SUBIENDO, lluvia: MODERADA });
  assert.equal(completo.datos_completos, true);

  const sinLluvia = calcularPuntaje({ ...BASE, nivelCm: 10.8, prediccion: SUBIENDO, lluvia: null });
  assert.equal(sinLluvia.datos_completos, false);
  assert.equal(sinLluvia.factores.find((f) => f.clave === "lluvia").sin_datos, true);
});
