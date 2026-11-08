import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocket } from "ws";
import { iniciarWebSocket, cerrarWebSocket } from "../src/servicios/websocket.js";
import {
  obtenerSimulacro,
  iniciarSimulacro,
  detenerSimulacro,
  MENSAJE_POR_DEFECTO,
} from "../src/servicios/simulacro.js";
import { simulacroSchema } from "../src/validacion/schemas.js";

function levantarServidor() {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// Conecta y devuelve una función que espera el próximo mensaje de cierto tipo.
function conectar(port) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const recibidos = [];
    const esperando = [];
    socket.on("message", (data) => {
      const mensaje = JSON.parse(data.toString());
      const i = esperando.findIndex((e) => e.tipo === mensaje.tipo);
      if (i >= 0) esperando.splice(i, 1)[0].resolve(mensaje);
      else recibidos.push(mensaje);
    });
    socket.esperar = (tipo) => {
      const i = recibidos.findIndex((m) => m.tipo === tipo);
      if (i >= 0) return Promise.resolve(recibidos.splice(i, 1)[0]);
      return new Promise((r) => esperando.push({ tipo, resolve: r }));
    };
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

test("simulacro: avisa a todos los conectados al iniciar y al detener", async (t) => {
  const server = await levantarServidor();
  iniciarWebSocket(server);
  const { port } = server.address();
  const a = await conectar(port);
  const b = await conectar(port);
  t.after(async () => {
    detenerSimulacro();
    a.close();
    b.close();
    await cerrarWebSocket();
    server.close();
  });

  const inicioA = a.esperar("simulacro");
  const inicioB = b.esperar("simulacro");
  const estado = iniciarSimulacro({ minutos: 3, iniciadoPor: "Defensa Civil" });

  assert.equal(estado.activo, true);
  assert.equal(estado.mensaje, MENSAJE_POR_DEFECTO);
  assert.equal(Date.parse(estado.termina_en) - Date.parse(estado.iniciado_en), 3 * 60_000);
  assert.deepEqual((await inicioA).payload, estado);
  assert.deepEqual((await inicioB).payload, estado);
  assert.deepEqual(obtenerSimulacro(), estado);

  const finA = a.esperar("simulacro");
  detenerSimulacro();
  assert.deepEqual((await finA).payload, { activo: false });
  assert.deepEqual(obtenerSimulacro(), { activo: false });
});

test("simulacro: usa el mensaje propio y vence solo", () => {
  const estado = iniciarSimulacro({ minutos: 1, mensaje: "  Simulacro escolar  " });
  assert.equal(estado.mensaje, "Simulacro escolar");

  const ahoraReal = Date.now;
  Date.now = () => ahoraReal() + 61_000;
  try {
    assert.deepEqual(obtenerSimulacro(), { activo: false });
  } finally {
    Date.now = ahoraReal;
    detenerSimulacro();
  }
});

test("simulacro: detener sin simulacro activo no transmite ni falla", () => {
  assert.deepEqual(detenerSimulacro(), { activo: false });
});

test("simulacroSchema: limita la duración entre 1 y 15 minutos", () => {
  assert.equal(simulacroSchema.safeParse({ minutos: 5, con_push: true }).success, true);
  assert.equal(simulacroSchema.safeParse({}).success, true);
  assert.equal(simulacroSchema.safeParse({ minutos: 0 }).success, false);
  assert.equal(simulacroSchema.safeParse({ minutos: 60 }).success, false);
  assert.equal(simulacroSchema.safeParse({ mensaje: "x".repeat(301) }).success, false);
});
