import { test } from "node:test";
import assert from "node:assert/strict";
import {
  geocodificar,
  normalizarConsulta,
  resumirResultados,
  ZONA_PIURA,
} from "../src/servicios/geocodificar.js";

test("normalizarConsulta recorta espacios y largo", () => {
  assert.equal(normalizarConsulta("  Av.   Grau  450 "), "Av. Grau 450");
  assert.equal(normalizarConsulta("x".repeat(200)).length, 120);
  assert.equal(normalizarConsulta(undefined), "");
});

test("resumirResultados deja nombre corto y coordenadas con 5 decimales", () => {
  const r = resumirResultados([
    {
      display_name: "Avenida Grau, Piura, Provincia de Piura, Piura, Perú",
      lat: "-5.1945123",
      lon: "-80.6327891",
    },
    { display_name: "", lat: "1", lon: "2" },
    { display_name: "Sin coordenadas", lat: "x", lon: "y" },
  ]);
  assert.deepEqual(r, [{ nombre: "Avenida Grau, Piura, Provincia de Piura", lat: -5.19451, lon: -80.63279 }]);
  assert.deepEqual(resumirResultados(null), []);
});

test("geocodificar limita la búsqueda a Piura, se identifica y guarda en caché", async () => {
  let llamadas = 0;
  let urlPedida;
  let cabeceras;
  const fetchFalso = async (url, opciones) => {
    llamadas++;
    urlPedida = new URL(url);
    cabeceras = opciones.headers;
    return {
      ok: true,
      json: async () => [{ display_name: "Plaza de Armas, Piura", lat: "-5.197", lon: "-80.626" }],
    };
  };
  const primera = await geocodificar("Plaza de Armas prueba-cache", { fetchImpl: fetchFalso });
  const segunda = await geocodificar("plaza de armas  prueba-cache", { fetchImpl: fetchFalso });
  assert.deepEqual(primera, [{ nombre: "Plaza de Armas, Piura", lat: -5.197, lon: -80.626 }]);
  assert.deepEqual(segunda, primera);
  assert.equal(llamadas, 1);
  assert.equal(urlPedida.searchParams.get("bounded"), "1");
  assert.equal(
    urlPedida.searchParams.get("viewbox"),
    `${ZONA_PIURA.oeste},${ZONA_PIURA.norte},${ZONA_PIURA.este},${ZONA_PIURA.sur}`
  );
  assert.match(cabeceras["User-Agent"], /^PiuraAlerta\//);
});

test("geocodificar devuelve null si el servicio falla", async () => {
  const r = await geocodificar("direccion que falla", {
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(r, null);
});
