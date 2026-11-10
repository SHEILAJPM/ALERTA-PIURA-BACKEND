// Prueba de carga con k6 (https://k6.io): solo consultas, no guarda nada en la
// base de datos. Uso:
//
//   k6 run pruebas-carga/k6-consultas.js
//   k6 run -e URL=http://localhost:4000 pruebas-carga/k6-consultas.js
//
// Dos escenarios en paralelo:
//
// 1. "servidor": hasta 100 usuarios simultáneos pidiendo /health, que no
//    pasa por el limitador de peticiones y consulta Postgres en cada llamada.
//    Mide cuánto aguanta el servidor + la base de datos.
//
// 2. "app": usuarios que hacen lo mismo que la app al abrir Inicio (estado de
//    los sensores, última lectura, albergues, simulacro). Como todo sale de
//    una sola IP, después de 300 peticiones en 5 minutos el backend responde
//    429 (ver src/intermediarios/rateLimit.js): eso es la protección contra
//    abusos funcionando, no un error, y se cuenta aparte.
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Counter } from "k6/metrics";

const URL = __ENV.URL || "https://alerta-piura-backend-fk56.onrender.com";

const erroresReales = new Rate("errores_reales");
const bloqueadas = new Counter("bloqueadas_por_limite_429");

// 429 es una respuesta esperada (limitador): que k6 no la cuente como fallo.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

export const options = {
  scenarios: {
    servidor: {
      executor: "ramping-vus",
      exec: "servidor",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 10 },
        { duration: "30s", target: 50 },
        { duration: "45s", target: 100 },
        { duration: "30s", target: 100 },
        { duration: "15s", target: 0 },
      ],
    },
    app: {
      executor: "constant-vus",
      exec: "app",
      vus: 10,
      duration: "2m30s",
    },
  },
  thresholds: {
    "http_req_duration{escenario:servidor}": ["p(95)<3000"],
    "http_req_duration{escenario:app}": ["p(95)<3000"],
    errores_reales: ["rate<0.01"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "max"],
};

function registrar(res) {
  if (res.status === 429) bloqueadas.add(1);
  // Error real: caída, timeout (status 0) o 5xx. 429 no cuenta.
  erroresReales.add(res.status === 0 || res.status >= 500);
}

export function servidor() {
  const res = http.get(`${URL}/health`, { tags: { escenario: "servidor" } });
  registrar(res);
  check(res, { "health 200": (r) => r.status === 200 });
  sleep(1);
}

export function app() {
  const params = { tags: { escenario: "app" } };
  const respuestas = http.batch([
    ["GET", `${URL}/api/sensores/estado`, null, params],
    ["GET", `${URL}/api/lecturas/ultima?sensor_codigo=RIO-PIURA-01`, null, params],
    ["GET", `${URL}/api/albergues`, null, params],
    ["GET", `${URL}/api/simulacro`, null, params],
  ]);
  for (const res of respuestas) {
    registrar(res);
    check(res, { "app 200 o 429": (r) => r.status === 200 || r.status === 429 });
  }
  // Un usuario real no recarga sin parar: la app refresca cada ~10-30 s.
  sleep(5);
}
