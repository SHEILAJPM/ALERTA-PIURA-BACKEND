import { test } from "node:test";
import assert from "node:assert/strict";
import {
  redondearUbicacion,
  resumirReportesSalud,
  resumirReportesAgua,
} from "../src/servicios/reportesSalud.js";
import {
  reporteSaludSchema,
  reporteAguaSchema,
  perfilSchema,
  usoContenidoSchema,
} from "../src/validacion/schemas.js";

test("redondearUbicacion: lleva el punto a una grilla de ~500 m", () => {
  const z = redondearUbicacion({ lon: -80.62664, lat: -5.19714 });
  assert.deepEqual(z, { lon: -80.625, lat: -5.195 });
  // Dos casas vecinas caen en la misma zona.
  assert.deepEqual(redondearUbicacion({ lon: -80.6261, lat: -5.1962 }), z);
});

test("resumirReportesSalud: suma personas por enfermedad y por zona, de mayor a menor", () => {
  const r = resumirReportesSalud([
    { enfermedad: "fiebre_dengue", personas: 3, lon: -80.625, lat: -5.195 },
    { enfermedad: "diarrea", personas: 1, lon: -80.625, lat: -5.195 },
    { enfermedad: "fiebre_dengue", personas: 5, lon: -80.61, lat: -5.2 },
  ]);
  assert.equal(r.avisos, 3);
  assert.equal(r.personas, 9);
  assert.deepEqual(r.por_enfermedad, { fiebre_dengue: 8, diarrea: 1 });
  assert.equal(r.zonas.length, 2);
  assert.equal(r.zonas[0].personas, 5);
  assert.deepEqual(r.zonas[1].enfermedades, { fiebre_dengue: 3, diarrea: 1 });
});

test("resumirReportesSalud: sin avisos devuelve totales en cero", () => {
  assert.deepEqual(resumirReportesSalud([]), { avisos: 0, personas: 0, por_enfermedad: {}, zonas: [] });
});

test("reporteSaludSchema: acepta un aviso válido y pone 1 persona por defecto", () => {
  const r = reporteSaludSchema.parse({ enfermedad: "diarrea", lon: -80.6, lat: -5.2 });
  assert.equal(r.personas, 1);
});

test("reporteSaludSchema: rechaza datos personales u otros campos extra", () => {
  const r = reporteSaludSchema.safeParse({ enfermedad: "diarrea", lon: -80.6, lat: -5.2, nombre: "Juan" });
  assert.equal(r.success, false);
});

test("reporteSaludSchema: rechaza enfermedades desconocidas y cantidades fuera de rango", () => {
  assert.equal(
    reporteSaludSchema.safeParse({ enfermedad: "gripe_aviar", lon: -80.6, lat: -5.2 }).success,
    false
  );
  assert.equal(
    reporteSaludSchema.safeParse({ enfermedad: "piel", personas: 0, lon: -80.6, lat: -5.2 }).success,
    false
  );
  assert.equal(
    reporteSaludSchema.safeParse({ enfermedad: "piel", personas: 50, lon: -80.6, lat: -5.2 }).success,
    false
  );
});

test("resumirReportesAgua: cuenta hogares por tipo y por zona", () => {
  const r = resumirReportesAgua([
    { tipo: "sin_agua", lon: -80.625, lat: -5.195 },
    { tipo: "sin_agua", lon: -80.625, lat: -5.195 },
    { tipo: "agua_turbia", lon: -80.61, lat: -5.2 },
  ]);
  assert.equal(r.avisos, 3);
  assert.deepEqual(r.por_tipo, { sin_agua: 2, agua_turbia: 1 });
  assert.equal(r.zonas[0].avisos, 2);
});

test("reporteAguaSchema: acepta tipos válidos y rechaza campos extra", () => {
  assert.equal(reporteAguaSchema.safeParse({ tipo: "agua_turbia", lon: -80.6, lat: -5.2 }).success, true);
  assert.equal(reporteAguaSchema.safeParse({ tipo: "inundada", lon: -80.6, lat: -5.2 }).success, false);
  assert.equal(
    reporteAguaSchema.safeParse({ tipo: "sin_agua", lon: -80.6, lat: -5.2, direccion: "Jr. Lima 123" })
      .success,
    false
  );
});

test("perfilSchema: sexo y año de nacimiento son opcionales y se pueden borrar con null", () => {
  assert.equal(perfilSchema.safeParse({ sexo: "mujer", anio_nacimiento: 1960 }).success, true);
  assert.equal(perfilSchema.safeParse({ sexo: null, anio_nacimiento: null }).success, true);
  assert.equal(perfilSchema.safeParse({ sexo: "x" }).success, false);
  assert.equal(perfilSchema.safeParse({ anio_nacimiento: new Date().getFullYear() + 1 }).success, false);
});

test("usoContenidoSchema: acepta plan creado y quiz completado", () => {
  assert.equal(usoContenidoSchema.safeParse({ recurso: "plan", accion: "creado" }).success, true);
  assert.equal(usoContenidoSchema.safeParse({ recurso: "quiz", accion: "completado" }).success, true);
  assert.equal(usoContenidoSchema.safeParse({ recurso: "otro", accion: "visita" }).success, false);
});
