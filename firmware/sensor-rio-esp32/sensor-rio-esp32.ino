// Nodo sensor de PIURA ALERTA: ESP32 + sensor ultrasónico (HC-SR04 para la
// maqueta, JSN-SR04T impermeable para el río).
//
// 1. Mide la distancia hasta el agua (mediana de 7 disparos, descarta ecos
//    perdidos).
// 2. La convierte en altura del agua: nivel = ALTURA_MONTAJE_CM - distancia.
// 3. La manda por WiFi a POST /api/lecturas con la API key del sensor.
// 4. También la imprime por USB como {"nivel_cm":12.3}: el backend puede
//    leerla por cable (SERIAL_PORT en el .env, ver servicios/serialIngest.js)
//    si no hay WiFi.
// 5. LED verde/amarillo/rojo y buzzer locales según los umbrales: el aviso en
//    el lugar funciona aunque se caiga el internet.
//
// Placa en Arduino IDE: "ESP32 Dev Module". Sin librerías extra: WiFi,
// HTTPClient y WiFiClientSecure vienen con el core de ESP32.

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "config.h"

// --- Pines (ver tabla de conexiones en README.md) ------------------------------
const int PIN_TRIG = 5;
const int PIN_ECHO = 18;  // ¡con divisor de voltaje! el ECHO sale a 5 V
const int PIN_LED_VERDE = 25;
const int PIN_LED_AMARILLO = 26;
const int PIN_LED_ROJO = 27;
const int PIN_BUZZER = 14;

const int MUESTRAS = 7;
const unsigned long TIMEOUT_ECO_US = 30000;  // ~5 m ida y vuelta
const float DISTANCIA_MIN_CM = 2.0;    // JSN-SR04T: zona ciega ~20 cm
const float DISTANCIA_MAX_CM = 450.0;

unsigned long ultimoEnvio = 0;

float velocidadSonidoCmPorUs() {
  // 331.3 m/s + 0.606 m/s por °C, pasado a cm/µs.
  return (331.3 + 0.606 * TEMPERATURA_AIRE_C) / 10000.0;
}

// Un disparo: devuelve la distancia en cm, o -1 si no volvió el eco.
float medirUnaVez() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(4);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(12);  // JSN-SR04T necesita >10 µs
  digitalWrite(PIN_TRIG, LOW);

  unsigned long duracion = pulseIn(PIN_ECHO, HIGH, TIMEOUT_ECO_US);
  if (duracion == 0) return -1;
  float distancia = duracion * velocidadSonidoCmPorUs() / 2.0;
  if (distancia < DISTANCIA_MIN_CM || distancia > DISTANCIA_MAX_CM) return -1;
  return distancia;
}

// Mediana de varios disparos: una ola, una hoja o un eco raro no mueve el
// resultado como lo haría un promedio.
float medirDistanciaCm() {
  float validas[MUESTRAS];
  int n = 0;
  for (int i = 0; i < MUESTRAS; i++) {
    float d = medirUnaVez();
    if (d > 0) validas[n++] = d;
    delay(60);  // deja morir el eco anterior
  }
  if (n < 3) return -1;  // muy pocas lecturas buenas: mejor no mandar nada

  for (int i = 1; i < n; i++) {  // insertion sort, n <= 7
    float x = validas[i];
    int j = i - 1;
    while (j >= 0 && validas[j] > x) {
      validas[j + 1] = validas[j];
      j--;
    }
    validas[j + 1] = x;
  }
  return validas[n / 2];
}

void mostrarEstadoLocal(float nivelCm) {
  bool roja = nivelCm >= UMBRAL_ALERTA_ROJA_CM;
  bool pre = !roja && nivelCm >= UMBRAL_PREALERTA_CM;
  digitalWrite(PIN_LED_VERDE, !roja && !pre);
  digitalWrite(PIN_LED_AMARILLO, pre);
  digitalWrite(PIN_LED_ROJO, roja);
  if (roja) {
    tone(PIN_BUZZER, 2000, 300);
  } else if (pre) {
    tone(PIN_BUZZER, 1200, 80);
  }
}

void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("# Conectando a WiFi \"%s\"", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 15000) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n# WiFi OK, IP %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n# Sin WiFi: sigo midiendo y mandando por USB");
  }
}

void enviarLectura(float nivelCm) {
  if (WiFi.status() != WL_CONNECTED) return;

  String url = URL_LECTURAS;
  HTTPClient http;
  WiFiClientSecure clienteSeguro;
  WiFiClient clienteSimple;

  if (url.startsWith("https://")) {
    // Para un proyecto académico alcanza con cifrar sin validar el
    // certificado. En producción real, cargar el certificado raíz con
    // clienteSeguro.setCACert(...).
    clienteSeguro.setInsecure();
    http.begin(clienteSeguro, url);
  } else {
    http.begin(clienteSimple, url);
  }
  // Render (plan gratis) tarda en despertar si estaba dormido.
  http.setTimeout(20000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", SENSOR_API_KEY);

  String cuerpo = String("{\"sensor_codigo\":\"") + SENSOR_CODIGO + "\",\"nivel_cm\":" + String(nivelCm, 1) + "}";
  int codigo = http.POST(cuerpo);
  if (codigo == 201) {
    Serial.printf("# Enviado OK (%d)\n", codigo);
  } else {
    Serial.printf("# Error al enviar: %d %s\n", codigo, http.getString().c_str());
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_LED_VERDE, OUTPUT);
  pinMode(PIN_LED_AMARILLO, OUTPUT);
  pinMode(PIN_LED_ROJO, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  delay(500);
  Serial.println("# PIURA ALERTA - nodo sensor " SENSOR_CODIGO);
  conectarWiFi();
}

void loop() {
  if (millis() - ultimoEnvio < INTERVALO_ENVIO_MS) return;
  ultimoEnvio = millis();

  float distancia = medirDistanciaCm();
  if (distancia < 0) {
    // Las líneas con "#" el backend las ignora (no son un número válido).
    Serial.println("# Sin eco válido: revisa conexiones o que nada tape el sensor");
    return;
  }

  float nivel = ALTURA_MONTAJE_CM - distancia;
  if (nivel < 0) nivel = 0;

  // Formato que entiende serialIngest.js del backend.
  Serial.printf("{\"nivel_cm\":%.1f}\n", nivel);
  mostrarEstadoLocal(nivel);

  conectarWiFi();
  enviarLectura(nivel);
}
