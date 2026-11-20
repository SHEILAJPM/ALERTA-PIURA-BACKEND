// Indicadores del sistema alineados a los Objetivos de Desarrollo Sostenible
// (Agenda 2030) y a la Meta G del Marco de Sendai (sistemas de alerta
// temprana). Función pura: recibe las filas ya consultadas (ver
// rutas/impacto.routes.js, GET /ods) y arma el JSON del panel, así la lógica
// se prueba sin base de datos.
//
// Un valor null significa "todavía no hay datos para calcularlo" (por ejemplo,
// tiempo de anticipación sin ninguna alerta roja registrada): el panel lo
// muestra como "sin datos", nunca como 0, para no inventar un resultado.

const HORAS_VENTANA_RED = 30 * 24; // ventana de disponibilidad: últimos 30 días

function redondear(valor, decimales = 1) {
  if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) return null;
  const f = 10 ** decimales;
  return Math.round(Number(valor) * f) / f;
}

function porcentaje(parte, total) {
  if (!total) return null;
  return redondear((parte / total) * 100, 1);
}

function mediana(valores) {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const medio = Math.floor(v.length / 2);
  return v.length % 2 ? v[medio] : (v[medio - 1] + v[medio]) / 2;
}

// Tiempo de anticipación: para cada alerta roja, minutos desde la prealerta
// que la precedió en el mismo sensor (null si saltó directo de normal a roja).
export function resumirAnticipacion(alertasRojas) {
  const conPrealerta = alertasRojas.map((a) => a.minutos_desde_prealerta).filter((m) => m !== null);
  const minutos = conPrealerta.map(Number).filter((m) => Number.isFinite(m) && m >= 0);
  return {
    alertas_rojas: alertasRojas.length,
    con_prealerta_previa: minutos.length,
    porcentaje_con_prealerta: porcentaje(minutos.length, alertasRojas.length),
    mediana_minutos: redondear(mediana(minutos), 0),
  };
}

export function disponibilidadRed(sensoresActivos, horasCaida30d) {
  if (!sensoresActivos) return null;
  const horasPosibles = sensoresActivos * HORAS_VENTANA_RED;
  const disponible = Math.max(0, horasPosibles - Math.max(0, Number(horasCaida30d) || 0));
  return redondear((disponible / horasPosibles) * 100, 1);
}

function indicador(clave, etiqueta, valor, { unidad = "", meta, ayuda, sendai = false } = {}) {
  return { clave, etiqueta, valor, unidad, meta, ayuda, sendai };
}

export function construirIndicadoresODS({
  alertasRojas = [],
  eventosPorEstado = [],
  cobertura = {},
  albergues = {},
  sos = {},
  red = {},
  reportes = {},
  polizasVigentes = 0,
  avisosLluvia = 0,
  chequeosSeguridad = 0,
  apoyo = {},
  avisosSalud = {},
  usoContenido = [],
  ahora = new Date(),
}) {
  const anticipacion = resumirAnticipacion(alertasRojas);
  // Uso anónimo de contenidos educativos (ODS 2.4 y 4.7), una vez por sesión.
  const uso = (recurso, accion) => {
    const fila = usoContenido.find((u) => u.recurso === recurso && u.accion === accion);
    return { ultimos_30d: fila?.ultimos_30d ?? 0, total: fila?.total ?? 0 };
  };
  const eventos = Object.fromEntries(eventosPorEstado.map((e) => [e.estado_nuevo, e.cantidad]));
  const suscripciones = (cobertura.telegram ?? 0) + (cobertura.push ?? 0) + (cobertura.sms ?? 0);

  return {
    generado_en: ahora.toISOString(),
    ods: [
      {
        numero: 11,
        titulo: "Ciudades y comunidades sostenibles",
        indicadores: [
          indicador("prealertas_emitidas", "Prealertas emitidas", eventos.prealerta ?? 0, {
            meta: "11.5",
            ayuda: "Cambios de estado del río a prealerta registrados por los sensores.",
            sendai: true,
          }),
          indicador("alertas_rojas_emitidas", "Alertas rojas emitidas", anticipacion.alertas_rojas, {
            meta: "11.5",
            ayuda: "Veces que un sensor pasó a alerta roja.",
            sendai: true,
          }),
          indicador(
            "anticipacion_mediana",
            "Tiempo de anticipación (mediana)",
            anticipacion.mediana_minutos,
            {
              unidad: "min",
              meta: "11.5",
              ayuda:
                "Minutos entre la prealerta y la alerta roja del mismo sensor: el margen que tuvo la población para prepararse.",
              sendai: true,
            }
          ),
          indicador(
            "alertas_rojas_con_aviso",
            "Alertas rojas con prealerta previa",
            anticipacion.porcentaje_con_prealerta,
            {
              unidad: "%",
              meta: "11.5",
              ayuda: "Porcentaje de alertas rojas que la población recibió con un aviso previo.",
              sendai: true,
            }
          ),
          indicador("sos_recibidos", "Pedidos de auxilio (SOS) recibidos", sos.total ?? 0, {
            meta: "11.5",
            ayuda: "SOS con ubicación enviados desde la app a Defensa Civil.",
          }),
          indicador("sos_atendidos", "SOS atendidos", porcentaje(sos.atendidos ?? 0, sos.total ?? 0), {
            unidad: "%",
            meta: "11.5",
            ayuda: "Porcentaje de SOS que Despacho marcó como atendidos.",
          }),
          indicador(
            "sos_tiempo_atencion",
            "Tiempo de atención de SOS (mediana)",
            redondear(sos.mediana_minutos, 0),
            {
              unidad: "min",
              meta: "11.5",
              ayuda: "Minutos desde que llega el SOS hasta que se marca como atendido.",
            }
          ),
          indicador("albergues_capacidad", "Plazas en albergues activos", albergues.capacidad ?? 0, {
            unidad: "personas",
            meta: "11.5",
            ayuda: `${albergues.cantidad ?? 0} albergues activos registrados.`,
          }),
          indicador(
            "albergues_ocupacion",
            "Ocupación actual de albergues",
            porcentaje(albergues.ocupacion ?? 0, albergues.capacidad ?? 0),
            { unidad: "%", meta: "11.5", ayuda: "Personas alojadas ahora sobre la capacidad total." }
          ),
          indicador("reportes_ciudadanos", "Reportes ciudadanos", reportes.total ?? 0, {
            meta: "11.3",
            ayuda: "Participación de la comunidad en el monitoreo de su zona.",
          }),
          indicador(
            "reportes_verificados",
            "Reportes verificados",
            porcentaje(reportes.verificados ?? 0, reportes.total ?? 0),
            { unidad: "%", meta: "11.3", ayuda: "Reportes que un moderador confirmó como reales." }
          ),
        ],
      },
      {
        numero: 13,
        titulo: "Acción por el clima",
        indicadores: [
          indicador("suscripciones_alerta", "Suscripciones a alertas tempranas", suscripciones, {
            meta: "13.1",
            ayuda: `Telegram: ${cobertura.telegram ?? 0} · Notificaciones push: ${cobertura.push ?? 0} · SMS: ${
              cobertura.sms ?? 0
            }. Una persona puede estar suscrita por más de una vía.`,
            sendai: true,
          }),
          indicador("avisos_lluvia", "Avisos preventivos por lluvia fuerte", avisosLluvia, {
            meta: "13.1",
            ayuda: "Avisos enviados antes de que suba el río, a partir del pronóstico de lluvia.",
            sendai: true,
          }),
          indicador("chequeos_seguridad", "Chequeos de seguridad respondidos", chequeosSeguridad, {
            meta: "13.3",
            ayuda: 'Respuestas de la población al chequeo "¿estás bien?" durante un evento.',
          }),
        ],
      },
      {
        numero: 9,
        titulo: "Industria, innovación e infraestructura",
        indicadores: [
          indicador("sensores_activos", "Sensores del río en operación", red.sensores_activos ?? 0, {
            meta: "9.1",
            ayuda: "Nodos ESP32 activos que miden el nivel del río.",
          }),
          indicador(
            "disponibilidad_red",
            "Disponibilidad de la red (30 días)",
            disponibilidadRed(red.sensores_activos ?? 0, red.horas_caida_30d ?? 0),
            {
              unidad: "%",
              meta: "9.1",
              ayuda: `Tiempo en que los sensores reportaron sin cortes. Caídas en 30 días: ${red.caidas_30d ?? 0}.`,
            }
          ),
        ],
      },
      {
        numero: 10,
        titulo: "Reducción de las desigualdades",
        indicadores: [
          indicador(
            "personas_con_apoyo",
            "Personas registradas que necesitan apoyo para evacuar",
            apoyo.personas ?? 0,
            {
              meta: "10.2",
              ayuda:
                "Registro voluntario y con consentimiento (adultos mayores, personas con discapacidad, gestantes...). Despacho las prioriza si piden SOS.",
            }
          ),
          indicador("sos_con_apoyo", "SOS de personas con apoyo registrado", apoyo.sos ?? 0, {
            meta: "10.2",
            ayuda: "Pedidos de auxilio que llegaron marcados como prioritarios.",
          }),
        ],
      },
      {
        numero: 3,
        titulo: "Salud y bienestar",
        indicadores: [
          indicador(
            "personas_con_sintomas",
            "Personas con síntomas avisadas (30 días)",
            avisosSalud.personas_30d ?? 0,
            {
              meta: "3.3",
              ayuda: `Avisos anónimos de vecinos sobre casos de dengue, diarrea, leptospirosis y otras enfermedades tras el fenómeno: ${
                avisosSalud.avisos_30d ?? 0
              } avisos en 30 días.`,
            }
          ),
          indicador(
            "focos_agua_estancada",
            "Focos de agua estancada reportados",
            reportes.agua_estancada ?? 0,
            {
              meta: "3.3",
              ayuda: `Posibles criaderos del zancudo del dengue tras las lluvias. Últimos 30 días: ${
                reportes.agua_estancada_30d ?? 0
              }.`,
            }
          ),
        ],
      },
      {
        numero: 1,
        titulo: "Fin de la pobreza",
        indicadores: [
          indicador("polizas_vigentes", "Familias con seguro contra inundaciones", polizasVigentes, {
            meta: "1.5",
            ayuda: "Pólizas vigentes: protección económica ante la pérdida por desastres.",
          }),
        ],
      },
      {
        numero: 2,
        titulo: "Hambre cero",
        indicadores: [
          indicador(
            "consultas_agricultura",
            "Consultas de recomendaciones para agricultores (30 días)",
            uso("agricultura", "visita").ultimos_30d,
            {
              meta: "2.4",
              ayuda: `Personas que revisaron qué hacer con su chacra y sus animales ante lluvias y desbordes. Desde el inicio: ${
                uso("agricultura", "visita").total
              }.`,
            }
          ),
        ],
      },
      {
        numero: 4,
        titulo: "Educación de calidad",
        indicadores: [
          indicador(
            "sesiones_laboratorio",
            "Sesiones del Laboratorio de simulación (30 días)",
            uso("laboratorio", "visita").ultimos_30d,
            {
              meta: "4.7",
              ayuda: `Personas que exploraron cómo una lluvia se convierte en crecida; ${
                uso("laboratorio", "simulacion").ultimos_30d
              } reprodujeron o crearon un escenario. Desde el inicio: ${uso("laboratorio", "visita").total} sesiones.`,
            }
          ),
        ],
      },
      {
        numero: 17,
        titulo: "Alianzas para lograr los objetivos",
        indicadores: [
          indicador("sensores_datos_abiertos", "Sensores con datos abiertos", red.sensores_activos ?? 0, {
            meta: "17.18",
            ayuda: "Lecturas publicadas con licencia CC BY 4.0 en /api/datos-abiertos.",
          }),
        ],
      },
    ],
  };
}
