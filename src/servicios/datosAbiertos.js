// Piezas puras de los datos abiertos (ver rutas/datosAbiertos.routes.js):
// límites de rango por agregación y conversión a CSV. Separadas de la ruta
// para probarlas sin base de datos.

export const LICENCIA = {
  nombre: "Creative Commons Atribución 4.0 Internacional (CC BY 4.0)",
  url: "https://creativecommons.org/licenses/by/4.0/deed.es",
  atribucion: "Fuente: Piura Alerta, red ciudadana de monitoreo del río Piura.",
};

// Segundos por intervalo de cada agregación ("crudo" = cada lectura tal cual).
export const SEGUNDOS_AGREGACION = { "5min": 300, "15min": 900, "1h": 3600, "1d": 86400 };

// Rango máximo por descarga según la agregación: el ESP32 manda una lectura
// cada pocos segundos, así que lo crudo se limita a 2 días y lo agregado
// permite rangos más largos sin devolver demasiadas filas.
export const DIAS_MAXIMOS = { crudo: 2, "5min": 14, "15min": 31, "1h": 180, "1d": 3650 };

const DIA_MS = 86_400_000;

// Resuelve desde/hasta (por defecto: los últimos 7 días, o el máximo permitido
// si es menor) y valida el rango. Devuelve { desde, hasta } o { error }.
export function resolverRango({ desde, hasta, agregacion }, ahora = new Date()) {
  const maximo = DIAS_MAXIMOS[agregacion];
  const fin = hasta ?? ahora;
  const inicio = desde ?? new Date(fin.getTime() - Math.min(7, maximo) * DIA_MS);
  if (inicio >= fin) return { error: "desde debe ser anterior a hasta" };
  if (fin.getTime() - inicio.getTime() > maximo * DIA_MS) {
    return {
      error: `Con agregación "${agregacion}" el rango máximo es de ${maximo} días. Usa una agregación mayor o un rango más corto.`,
    };
  }
  return { desde: inicio, hasta: fin };
}

function celda(valor) {
  if (valor === null || valor === undefined) return "";
  const texto = valor instanceof Date ? valor.toISOString() : String(valor);
  // RFC 4180: comillas si hay coma, comilla o salto de línea.
  return /[",\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function aCSV(filas, columnas) {
  const lineas = [columnas.join(",")];
  for (const fila of filas) lineas.push(columnas.map((c) => celda(fila[c])).join(","));
  return `${lineas.join("\r\n")}\r\n`;
}
