import rateLimit from "express-rate-limit";

function respuestaLimite(_req, res) {
  res.status(429).json({ error: "Demasiadas solicitudes, intenta de nuevo más tarde" });
}

function crearLimitador(windowMs, limit) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: respuestaLimite,
  });
}

// Aplica a todo /api/*: protección general contra scraping/abuso básico.
export const limitadorGeneral = crearLimitador(5 * 60 * 1000, 300);

// Ingesta de lecturas: el simulador/ESP32 envía ~1 lectura cada pocos
// segundos, así que el límite deja bastante margen sobre el uso normal.
export const limitadorLecturas = crearLimitador(60 * 1000, 60);

// Escritura pública (reportes ciudadanos, albergues): tráfico humano, no de
// sensores, así que el límite es mucho más estricto.
export const limitadorEscrituraPublica = crearLimitador(10 * 60 * 1000, 20);

// Botón de pánico: comparte IP con quien lo manda (una emergencia real puede
// venir de un colegio, un edificio, una red WiFi compartida), así que un
// límite pensado para tráfico humano normal (20/10min) bloquearía justo el
// escenario de emergencia masiva para el que existe este botón. Mucho más
// alto a propósito, sigue acotado porque cada envío igual escribe una fila.
export const limitadorSOS = crearLimitador(10 * 60 * 1000, 100);

// Asistente con IA: cada pregunta le cuesta plata real a la cuenta de Groq,
// a diferencia de las demás escrituras públicas que solo cuestan una fila en
// la base. Límite más chico a propósito para que nadie pueda vaciar la cuota
// gratuita de la cuenta mandando preguntas en loop.
export const limitadorAsistente = crearLimitador(10 * 60 * 1000, 15);

// Login: mucho más estricto que el límite general (300/5min compartido por
// todo /api/*), para frenar fuerza bruta de contraseñas por IP sin depender
// de un bloqueo por cuenta (que además abriría la puerta a bloquear a otro
// usuario a propósito con solo su correo).
export const limitadorLogin = crearLimitador(15 * 60 * 1000, 10);
