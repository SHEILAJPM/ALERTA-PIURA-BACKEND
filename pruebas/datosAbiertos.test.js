import { test } from "node:test";
import assert from "node:assert/strict";
import { resolverRango, aCSV, DIAS_MAXIMOS } from "../src/servicios/datosAbiertos.js";
import { datosAbiertosLecturasSchema, reporteSchema, perfilSchema } from "../src/validacion/schemas.js";

const AHORA = new Date("2026-11-19T12:00:00Z");
const DIA = 86_400_000;

test("resolverRango: sin fechas usa los últimos 7 días", () => {
  const r = resolverRango({ agregacion: "15min" }, AHORA);
  assert.equal(r.hasta.toISOString(), AHORA.toISOString());
  assert.equal(AHORA - r.desde, 7 * DIA);
});

test("resolverRango: en crudo el rango por defecto se recorta al máximo de 2 días", () => {
  const r = resolverRango({ agregacion: "crudo" }, AHORA);
  assert.equal(AHORA - r.desde, DIAS_MAXIMOS.crudo * DIA);
});

test("resolverRango: rechaza un rango mayor al permitido para la agregación", () => {
  const r = resolverRango({ agregacion: "crudo", desde: new Date(AHORA - 5 * DIA), hasta: AHORA }, AHORA);
  assert.match(r.error, /rango máximo es de 2 días/);
});

test("resolverRango: rechaza desde posterior a hasta", () => {
  const r = resolverRango({ agregacion: "1h", desde: AHORA, hasta: new Date(AHORA - DIA) }, AHORA);
  assert.match(r.error, /anterior/);
});

test("aCSV: encabezado, fechas en ISO y escapado RFC 4180", () => {
  const csv = aCSV(
    [
      { a: 'dice "hola", ya', b: new Date("2026-01-02T03:04:05Z") },
      { a: null, b: 7 },
    ],
    ["a", "b"]
  );
  assert.equal(csv, 'a,b\r\n"dice ""hola"", ya",2026-01-02T03:04:05.000Z\r\n,7\r\n');
});

test("datosAbiertosLecturasSchema: valores por defecto y fechas convertidas", () => {
  const r = datosAbiertosLecturasSchema.parse({ sensor: "RIO-01", desde: "2026-11-01" });
  assert.equal(r.agregacion, "15min");
  assert.equal(r.formato, "json");
  assert.ok(r.desde instanceof Date);
});

test("datosAbiertosLecturasSchema: rechaza agregaciones desconocidas", () => {
  assert.equal(datosAbiertosLecturasSchema.safeParse({ sensor: "X", agregacion: "2min" }).success, false);
});

test("reporteSchema: acepta categoría válida y rechaza una inventada", () => {
  const base = { descripcion: "Agua estancada en la esquina", foto_url: "https://example.com/f.jpg" };
  assert.equal(reporteSchema.safeParse({ ...base, categoria: "agua_estancada" }).success, true);
  assert.equal(reporteSchema.safeParse({ ...base, categoria: "incendio" }).success, false);
  assert.equal(reporteSchema.safeParse(base).success, true);
});

test("perfilSchema: apoyo_evacuacion acepta tipos conocidos y lista vacía (retirar consentimiento)", () => {
  assert.equal(perfilSchema.safeParse({ apoyo_evacuacion: ["adulto_mayor", "gestante"] }).success, true);
  assert.equal(perfilSchema.safeParse({ apoyo_evacuacion: [] }).success, true);
  assert.equal(perfilSchema.safeParse({ apoyo_evacuacion: ["otra_cosa"] }).success, false);
});
