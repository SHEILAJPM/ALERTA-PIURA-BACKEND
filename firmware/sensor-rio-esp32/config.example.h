// Copia este archivo como "config.h" (en la misma carpeta) y completa tus
// datos. config.h está en .gitignore: nunca subas tu WiFi ni tu API key.

#pragma once

// --- WiFi -------------------------------------------------------------------
// El ESP32 solo se conecta a redes de 2.4 GHz (no 5 GHz). Sirve el hotspot
// del celular para la demo.
#define WIFI_SSID "NombreDeTuWiFi"
#define WIFI_PASSWORD "ContraseñaDeTuWiFi"

// --- Backend ------------------------------------------------------------------
// Producción (Render) o tu PC en la misma red, por ejemplo
// "http://192.168.1.50:4000/api/lecturas" (no uses "localhost": para el ESP32
// localhost es él mismo).
#define URL_LECTURAS "https://piura-alerta-backend.onrender.com/api/lecturas"

// El mismo valor que SENSOR_API_KEY en el .env / Render del backend.
#define SENSOR_API_KEY "pega-aqui-la-api-key-del-sensor"

// Código del sensor tal como está registrado en el panel admin
// (Catálogo de Nodos). El de prueba que crea `npm run db:seed` es RIO-PIURA-01.
#define SENSOR_CODIGO "RIO-PIURA-01"

// --- Montaje del sensor ---------------------------------------------------------
// Distancia en cm desde la cara del sensor hasta el FONDO (nivel 0 del agua).
// Mídela con una wincha una vez instalado. Ejemplo maqueta: balde de 35 cm con
// el sensor 5 cm por encima del borde -> 40.
#define ALTURA_MONTAJE_CM 40.0

// Cada cuánto se manda una lectura. El backend acepta hasta 60 por minuto.
#define INTERVALO_ENVIO_MS 5000

// Temperatura del aire aproximada (°C). El sonido viaja más rápido con calor:
// en Piura (~28 °C) ignorar esto da ~1.5 % de error en la distancia.
#define TEMPERATURA_AIRE_C 28.0

// Umbrales locales para el LED y el buzzer: avisan en el mismo lugar aunque se
// caiga el internet. Ponlos iguales a los del sensor en el panel admin.
#define UMBRAL_PREALERTA_CM 10.0
#define UMBRAL_ALERTA_ROJA_CM 16.0
