import { test } from "node:test";
import assert from "node:assert/strict";
import {
  construirIndicadoresODS,
  resumirAnticipacion,
  disponibilidadRed,
} from "../src/servicios/indicadoresODS.js";

function buscar(resultado, clave) {
  for (const ods of resultado.ods) {
    const encontrado = ods.indicadores.find((i) => i.clave === clave);
    if (encontrado) return encontrado;
  }
  throw new Error(`No existe el indicador ${clave}`);
}

test("resumirAnticipacion: mediana solo de las alertas rojas con prealerta previa", () => {
  const r = resumirAnticipacion([
    { minutos_desde_prealerta: 30 },
    { minutos_desde_prealerta: 90 },
    { minutos_desde_prealerta: null },
    { minutos_desde_prealerta: 60 },
  ]);
  assert.equal(r.alertas_rojas, 4);
  assert.equal(r.con_prealerta_previa, 3);
  assert.equal(r.porcentaje_con_prealerta, 75);
  assert.equal(r.mediana_minutos, 60);
});

test("resumirAnticipacion: sin alertas rojas no inventa valores (null, no 0)", () => {
  const r = resumirAnticipacion([]);
  assert.equal(r.alertas_rojas, 0);
  assert.equal(r.porcentaje_con_prealerta, null);
  assert.equal(r.mediana_minutos, null);
});

test("resumirAnticipacion: mediana con cantidad par promedia los dos del medio", () => {
  const r = resumirAnticipacion([{ minutos_desde_prealerta: 10 }, { minutos_desde_prealerta: 20 }]);
  assert.equal(r.mediana_minutos, 15);
});

test("disponibilidadRed: descuenta las horas caídas de 30 días por sensor", () => {
  // 2 sensores x 720 h = 1440 h posibles; 72 h caídas -> 95%.
  assert.equal(disponibilidadRed(2, 72), 95);
  assert.equal(disponibilidadRed(1, 0), 100);
});

test("disponibilidadRed: sin sensores activos no hay disponibilidad que medir", () => {
  assert.equal(disponibilidadRed(0, 0), null);
});

test("disponibilidadRed: nunca baja de 0% aunque las horas caídas superen la ventana", () => {
  assert.equal(disponibilidadRed(1, 5000), 0);
});

test("construirIndicadoresODS: agrupa por ODS con meta y marca los de Sendai", () => {
  const r = construirIndicadoresODS({
    alertasRojas: [{ minutos_desde_prealerta: 45 }],
    eventosPorEstado: [
      { estado_nuevo: "prealerta", cantidad: 3 },
      { estado_nuevo: "alerta_roja", cantidad: 1 },
    ],
    ahora: new Date("2026-11-19T12:00:00Z"),
  });
  assert.deepEqual(
    r.ods.map((o) => o.numero),
    [11, 13, 9, 10, 3, 1, 2, 4, 17]
  );
  assert.equal(r.generado_en, "2026-11-19T12:00:00.000Z");
  const anticipacion = buscar(r, "anticipacion_mediana");
  assert.equal(anticipacion.valor, 45);
  assert.equal(anticipacion.meta, "11.5");
  assert.equal(anticipacion.sendai, true);
  assert.equal(buscar(r, "prealertas_emitidas").valor, 3);
});

test("construirIndicadoresODS: porcentajes de SOS, albergues y reportes", () => {
  const r = construirIndicadoresODS({
    sos: { total: 8, atendidos: 6, mediana_minutos: 12.4 },
    albergues: { cantidad: 2, capacidad: 400, ocupacion: 100 },
    reportes: { total: 20, verificados: 5, agua_estancada: 4, agua_estancada_30d: 1 },
  });
  assert.equal(buscar(r, "sos_atendidos").valor, 75);
  assert.equal(buscar(r, "sos_tiempo_atencion").valor, 12);
  assert.equal(buscar(r, "albergues_ocupacion").valor, 25);
  assert.equal(buscar(r, "reportes_verificados").valor, 25);
  assert.equal(buscar(r, "focos_agua_estancada").valor, 4);
});

test("construirIndicadoresODS: suma las suscripciones de todos los canales", () => {
  const r = construirIndicadoresODS({ cobertura: { telegram: 10, push: 5, sms: 2 } });
  assert.equal(buscar(r, "suscripciones_alerta").valor, 17);
});

test("construirIndicadoresODS: sin datos, los porcentajes quedan en null y los conteos en 0", () => {
  const r = construirIndicadoresODS({});
  assert.equal(buscar(r, "sos_atendidos").valor, null);
  assert.equal(buscar(r, "albergues_ocupacion").valor, null);
  assert.equal(buscar(r, "sos_recibidos").valor, 0);
  assert.equal(buscar(r, "personas_con_apoyo").valor, 0);
});

test("construirIndicadoresODS: cuenta las personas con síntomas avisadas en 30 días (ODS 3.3)", () => {
  const r = construirIndicadoresODS({ avisosSalud: { avisos_30d: 4, personas_30d: 11 } });
  const ind = buscar(r, "personas_con_sintomas");
  assert.equal(ind.valor, 11);
  assert.equal(ind.meta, "3.3");
  assert.match(ind.ayuda, /4 avisos/);
});

test("construirIndicadoresODS: cuenta el uso de recomendaciones agrícolas (ODS 2.4) y del Laboratorio (ODS 4.7)", () => {
  const r = construirIndicadoresODS({
    usoContenido: [
      { recurso: "agricultura", accion: "visita", ultimos_30d: 12, total: 40 },
      { recurso: "laboratorio", accion: "visita", ultimos_30d: 7, total: 20 },
      { recurso: "laboratorio", accion: "simulacion", ultimos_30d: 5, total: 9 },
    ],
  });
  const agro = buscar(r, "consultas_agricultura");
  assert.equal(agro.valor, 12);
  assert.equal(agro.meta, "2.4");
  assert.match(agro.ayuda, /Desde el inicio: 40/);
  const lab = buscar(r, "sesiones_laboratorio");
  assert.equal(lab.valor, 7);
  assert.equal(lab.meta, "4.7");
  assert.match(lab.ayuda, /5 reprodujeron/);
});

test("construirIndicadoresODS: sin uso registrado, los indicadores de ODS 2 y 4 quedan en 0", () => {
  const r = construirIndicadoresODS({});
  assert.equal(buscar(r, "consultas_agricultura").valor, 0);
  assert.equal(buscar(r, "sesiones_laboratorio").valor, 0);
});
