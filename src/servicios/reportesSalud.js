// Piezas puras de los avisos anónimos de enfermedad (ver
// rutas/salud.routes.js). Separadas para probarlas sin base de datos.

// 0,005° ≈ 550 m en Piura: suficiente para ver en qué zona aumentan los casos
// sin poder ubicar una vivienda puntual.
export const PASO_GRADOS = 0.005;

export function redondearUbicacion({ lon, lat }) {
  const redondear = (v) => Number((Math.round(v / PASO_GRADOS) * PASO_GRADOS).toFixed(4));
  return { lon: redondear(lon), lat: redondear(lat) };
}

// Agrupa las filas ({ enfermedad, personas, lon, lat }) en totales por
// enfermedad y por zona, ordenadas de mayor a menor.
export function resumirReportesSalud(filas) {
  const porEnfermedad = {};
  const zonas = new Map();
  let personas = 0;
  for (const f of filas) {
    personas += f.personas;
    porEnfermedad[f.enfermedad] = (porEnfermedad[f.enfermedad] ?? 0) + f.personas;
    const clave = `${f.lat},${f.lon}`;
    const zona = zonas.get(clave) ?? { lat: f.lat, lon: f.lon, avisos: 0, personas: 0, enfermedades: {} };
    zona.avisos += 1;
    zona.personas += f.personas;
    zona.enfermedades[f.enfermedad] = (zona.enfermedades[f.enfermedad] ?? 0) + f.personas;
    zonas.set(clave, zona);
  }
  return {
    avisos: filas.length,
    personas,
    por_enfermedad: porEnfermedad,
    zonas: [...zonas.values()].sort((a, b) => b.personas - a.personas),
  };
}
