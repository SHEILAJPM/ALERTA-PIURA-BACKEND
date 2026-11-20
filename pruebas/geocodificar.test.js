import { test } from "node:test";
import assert from "node:assert/strict";
import {
  geocodificar,
  normalizarConsulta,
  resumirResultados,
  ZONA_PIURA,
} from "../src/servicios/geocodificar.js";

const feature = (properties, lon, lat) => ({ properties, geometry: { coordinates: [lon, lat] } });

test("normalizarConsulta recorta espacios y largo", () => {
  assert.equal(normalizarConsulta("  Av.   Grau  450 "), "Av. Grau 450");
  assert.equal(normalizarConsulta("x".repeat(200)).length, 120);
  assert.equal(normalizarConsulta(undefined), "");
});

test("resumirResultados arma nombres legibles, redondea y quita repetidos", () => {
  const r = resumirResultados({
    features: [
      feature({ name: "Avenida Grau", locality: "Talarita", district: "Castilla" }, -80.6201379, -5.1999556),
      feature({ name: "Avenida Grau", locality: "Talarita", district: "Castilla" }, -80.62, -5.2),
      feature({ street: "Calle Lima", housenumber: "450", city: "Piura" }, -80.63, -5.19),
      feature({ name: "Sin coordenadas" }, "x", "y"),
      feature({}, -80.6, -5.2),
    ],
  });
  assert.deepEqual(r, [
    { nombre: "Avenida Grau, Talarita, Castilla", lat: -5.19996, lon: -80.62014 },
    { nombre: "Calle Lima 450, Piura", lat: -5.19, lon: -80.63 },
  ]);
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
      json: async () => ({ features: [feature({ name: "Plaza de Armas", city: "Piura" }, -80.626, -5.197)] }),
    };
  };
  const primera = await geocodificar("Plaza de Armas prueba-cache", { fetchImpl: fetchFalso });
  const segunda = await geocodificar("plaza de armas  prueba-cache", { fetchImpl: fetchFalso });
  assert.deepEqual(primera, [{ nombre: "Plaza de Armas, Piura", lat: -5.197, lon: -80.626 }]);
  assert.deepEqual(segunda, primera);
  assert.equal(llamadas, 1);
  assert.equal(
    urlPedida.searchParams.get("bbox"),
    `${ZONA_PIURA.oeste},${ZONA_PIURA.sur},${ZONA_PIURA.este},${ZONA_PIURA.norte}`
  );
  assert.match(cabeceras["User-Agent"], /^PiuraAlerta\//);
});

test("geocodificar devuelve null si el servicio falla", async () => {
  const r = await geocodificar("direccion que falla", {
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(r, null);
});
