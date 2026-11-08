import { logger } from "../utilidades/logger.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// Modelo con visión: el único de Groq que mira la foto además del texto y
// acepta JSON mode con imágenes (ver console.groq.com/docs/vision). Antes se
// usaba openai/gpt-oss-20b, que es solo texto: la foto nunca se analizaba.
// Configurable porque Groq retira modelos seguido (Llama 4 Scout se dio de
// baja en julio de 2026) y cambiarlo no debería requerir un deploy de código.
const MODELO_VISION = process.env.GROQ_MODELO_VISION || "qwen/qwen3.8-27b";
// Respaldo solo texto: si el modelo de visión falla, al menos se califica la
// descripción (y la foto queda "sin analizar", ver más abajo).
const MODELO_TEXTO = process.env.GROQ_MODELO_TEXTO || "openai/gpt-oss-20b";
const TIMEOUT_MS = 10_000;

export const VEREDICTOS = ["apto", "revisar", "no_apto"];

const PROMPT_SISTEMA = `Eres el moderador de un sistema ciudadano de alertas de inundaciones en Piura, Perú.
Vas a recibir la descripción de una publicación enviada por un vecino y, casi siempre, la foto que adjuntó.
Califica si la publicación es APTA para mostrarse a la comunidad.

Responde SOLO con JSON, sin texto adicional, con este formato exacto:
{
  "veredicto": "apto" | "revisar" | "no_apto",
  "puntaje": número entero de 0 a 100 (qué tan útil y confiable es la publicación),
  "imagen": {"apta": boolean, "comentario": string corto en español describiendo qué se ve},
  "descripcion": {"apta": boolean, "comentario": string corto en español},
  "motivo": string corto en español que resuma la calificación
}

Criterios:
- "apto": la foto muestra algo relacionado con inundaciones, el río, lluvias, calles con agua, daños,
  desbordes, aniegos, defensas ribereñas, evacuaciones u otra emergencia urbana, y la descripción es
  coherente con la foto. Puntaje alto (70-100).
- "revisar": dudas razonables: la foto no coincide del todo con el texto, está muy oscura o borrosa, el
  texto es confuso o muy corto. Un operador humano decide. Puntaje medio (30-69).
- "no_apto": SOLO si estás seguro de que no tiene nada que ver con el tema: selfie, comida, mascota, meme,
  captura de pantalla, publicidad, contenido ofensivo o sexual. Esta publicación se archiva sin revisión
  humana, así que úsalo solo sin ninguna duda. Puntaje bajo (0-29).

Si podría ser una emergencia real (aunque esté mal escrita, informal o la foto sea de mala calidad), NUNCA
uses "no_apto": es preferible que un humano revise de más a ocultar una emergencia real.`;

function aBooleano(valor) {
  return typeof valor === "boolean" ? valor : null;
}

function aComentario(valor) {
  return typeof valor === "string" && valor.trim() ? valor.trim().slice(0, 160) : null;
}

// Valida y ajusta lo que devolvió el modelo. Exportado para las pruebas.
// - Puntaje fuera de rango o ausente: se recorta o se deduce del veredicto.
// - Si la foto no se pudo analizar, nunca se archiva solo por el texto
//   ("no_apto" baja a "revisar") ni se da por "apto" algo sin mirar la foto.
export function normalizarCalificacion(crudo, { imagenAnalizada, teniaFoto }) {
  if (!crudo || !VEREDICTOS.includes(crudo.veredicto)) return null;

  let veredicto = crudo.veredicto;
  if (teniaFoto && !imagenAnalizada && veredicto !== "revisar") veredicto = "revisar";

  const PUNTAJE_POR_VEREDICTO = { apto: 85, revisar: 50, no_apto: 10 };
  let puntaje = Number.isFinite(crudo.puntaje)
    ? Math.round(Math.min(100, Math.max(0, crudo.puntaje)))
    : PUNTAJE_POR_VEREDICTO[veredicto];
  // Que el número nunca contradiga al veredicto (ej. "no_apto" con 90).
  const RANGOS = { apto: [70, 100], revisar: [30, 69], no_apto: [0, 29] };
  const [min, max] = RANGOS[veredicto];
  puntaje = Math.min(max, Math.max(min, puntaje));

  const imagen = imagenAnalizada
    ? { apta: aBooleano(crudo.imagen?.apta), comentario: aComentario(crudo.imagen?.comentario) }
    : {
        apta: null,
        comentario: teniaFoto ? "No se pudo analizar la foto; la revisa un moderador." : null,
      };

  return {
    veredicto,
    puntaje,
    motivo: aComentario(crudo.motivo),
    imagen,
    descripcion: {
      apta: aBooleano(crudo.descripcion?.apta),
      comentario: aComentario(crudo.descripcion?.comentario),
    },
    // Campos de antes (columnas posible_spam / estado del reporte).
    es_sospechoso: veredicto === "revisar",
    fuera_de_tema: veredicto === "no_apto",
  };
}

async function consultarGroq({ apiKey, modelo, contenido }) {
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    const respuesta = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelo,
        temperature: 0,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PROMPT_SISTEMA },
          { role: "user", content: contenido },
        ],
      }),
      signal: controlador.signal,
    });
    if (!respuesta.ok) {
      const cuerpo = await respuesta.json().catch(() => ({}));
      logger.warn(
        { modelo, status: respuesta.status, error: cuerpo?.error?.message },
        "Groq rechazó la calificación de la publicación"
      );
      return null;
    }
    const data = await respuesta.json();
    const texto = data.choices?.[0]?.message?.content;
    return texto ? JSON.parse(texto) : null;
  } catch (err) {
    logger.warn({ modelo, err: err.message }, "No se pudo calificar la publicación con IA");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Best-effort: nunca lanza ni bloquea al llamador. Si falta la API key o las
// dos consultas fallan, devuelve null (= "no se pudo analizar") y la
// publicación sigue el flujo normal de moderación humana.
export async function analizarReporte({ descripcion, fotoUrl }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const texto = { type: "text", text: `Descripción del vecino: ${descripcion.slice(0, 2000)}` };

  if (fotoUrl) {
    const crudo = await consultarGroq({
      apiKey,
      modelo: MODELO_VISION,
      contenido: [texto, { type: "image_url", image_url: { url: fotoUrl } }],
    });
    const calificacion = normalizarCalificacion(crudo, { imagenAnalizada: true, teniaFoto: true });
    if (calificacion) return calificacion;
  }

  const crudo = await consultarGroq({ apiKey, modelo: MODELO_TEXTO, contenido: [texto] });
  return normalizarCalificacion(crudo, { imagenAnalizada: false, teniaFoto: Boolean(fotoUrl) });
}
