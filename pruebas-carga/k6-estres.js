// Prueba de estrés: sube usuarios por escalones hasta encontrar el punto en
// que el backend empieza a fallar. Usa /health (consulta Postgres y no pasa
// por el limitador por IP), así que mide la capacidad real del servidor.
//
//   k6 run pruebas-carga/k6-estres.js
//
// OJO: puede dejar el backend lento o caído unos minutos (plan gratis de
// Render). Se corta sola si más del 30 % de las peticiones falla.
import http from "k6/http";
import { sleep } from "k6";
import { Rate } from "k6/metrics";
import exec from "k6/execution";

const URL = __ENV.URL || "https://alerta-piura-backend-fk56.onrender.com";
const errores = new Rate("errores");

// Cada escalón: 20 s subiendo + 30 s sostenido.
const ESCALONES = (__ENV.ESCALONES || "100,200,400,600,800,1000").split(",").map(Number);
const SUBIDA_S = 20;
const SOSTENIDO_S = 30;

const stages = [];
for (const usuarios of ESCALONES) {
  stages.push({ duration: `${SUBIDA_S}s`, target: usuarios });
  stages.push({ duration: `${SOSTENIDO_S}s`, target: usuarios });
}
stages.push({ duration: "10s", target: 0 });

// Umbrales por escalón: no cortan la prueba (salvo el global), sirven para que
// el resumen muestre tiempos y errores de cada escalón por separado.
const thresholds = {
  errores: [{ threshold: "rate<0.3", abortOnFail: true, delayAbortEval: "20s" }],
};
for (const usuarios of ESCALONES) {
  thresholds[`http_req_duration{escalon:${usuarios}}`] = ["p(95)<600000"];
  thresholds[`errores{escalon:${usuarios}}`] = ["rate<=1"];
}

export const options = {
  scenarios: { estres: { executor: "ramping-vus", startVUs: 0, stages } },
  thresholds,
  summaryTrendStats: ["avg", "med", "p(95)", "max"],
};

// Escalón según el tiempo transcurrido: solo se cuenta la parte sostenida.
function escalonActual() {
  const s = (Date.now() - exec.scenario.startTime) / 1000;
  const bloque = SUBIDA_S + SOSTENIDO_S;
  const i = Math.floor(s / bloque);
  if (i >= ESCALONES.length || s - i * bloque < SUBIDA_S) return "subiendo";
  return String(ESCALONES[i]);
}

export default function () {
  const escalon = escalonActual();
  const res = http.get(`${URL}/health`, { tags: { escalon }, timeout: "15s" });
  errores.add(res.status !== 200, { escalon });
  sleep(1);
}
