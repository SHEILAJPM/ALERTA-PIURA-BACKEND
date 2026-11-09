# Nodo sensor ESP32 + ultrasonido

Mide la altura del agua con un sensor ultrasónico y la manda al backend de PIURA ALERTA por WiFi
(`POST /api/lecturas`) o por cable USB (`SERIAL_PORT`). Además prende un LED verde, amarillo o rojo y
suena un buzzer en el mismo lugar, aunque se caiga el internet.

## Cómo mide

El sensor se monta **arriba, mirando hacia abajo**. Mide la distancia hasta la superficie del agua, y el
ESP32 la convierte en altura del agua:

```
   [sensor]  ─┬─
              │  distancia medida (ultrasonido)
   ~~~~agua~~~┼─
              │  nivel_cm = ALTURA_MONTAJE_CM − distancia   ← lo que recibe el backend
   ───fondo───┴─
```

## Materiales

Precios referenciales en soles (Perú, 2026), según tiendas de electrónica (Paruro en Lima, Naylamp,
Mercado Libre). Verifícalos antes de comprar.

### Maqueta para la exposición (~S/ 85)

| #   | Material                                                                | Para qué                                  | Precio aprox. |
| --- | ----------------------------------------------------------------------- | ----------------------------------------- | ------------- |
| 1   | ESP32 DevKit V1 (30 pines, con cable micro USB / USB-C)                 | Cerebro + WiFi                            | S/ 30 – 40    |
| 1   | Sensor ultrasónico **HC-SR04**                                          | Mide la distancia al agua (2–400 cm)      | S/ 6 – 10     |
| 1   | Protoboard de 830 puntos                                                | Armar sin soldar                          | S/ 8 – 12     |
| 1   | Juego de cables jumper macho-macho y macho-hembra                       | Conexiones                                | S/ 6 – 10     |
| 3   | LED 5 mm: verde, amarillo y rojo                                        | Estado local                              | S/ 1          |
| 3   | Resistencias de 220 Ω                                                   | Una por LED                               | S/ 0.50       |
| 1   | Resistencia de 1 kΩ y una de 2 kΩ                                       | Divisor de voltaje del ECHO (5 V → 3.3 V) | S/ 0.50       |
| 1   | Buzzer activo de 5 V                                                    | Alarma sonora local                       | S/ 2 – 4      |
| 1   | Balde o recipiente transparente (~35 cm de alto) + regla                | El "río" de la maqueta                    | S/ 10 – 15    |
| 1   | Soporte para el sensor (palito de madera, cartón grueso o impresión 3D) | Fijarlo arriba del balde                  | S/ 0 – 5      |

Con la maqueta se puede usar el sensor de prueba `RIO-PIURA-01` (prealerta a **10 cm**, alerta roja a
**16 cm**): basta con echar agua al balde para que la app pase de normal a prealerta y a alerta roja.

### Instalación real en el río (agrega ~S/ 140)

| #   | Material                                                                       | Para qué                                                          | Precio aprox. |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------- |
| 1   | Sensor ultrasónico **impermeable JSN-SR04T** (o AJ-SR04M) en lugar del HC-SR04 | Aguanta humedad y salpicaduras. Ojo: no mide a menos de ~20–25 cm | S/ 30 – 45    |
| 1   | Caja estanca IP65 (~15×10×7 cm) + prensaestopas                                | Proteger el ESP32 de la lluvia                                    | S/ 15 – 25    |
| 1   | Panel solar de 6 V, 2–3 W                                                      | Energía sin enchufe                                               | S/ 25 – 40    |
| 1   | Módulo cargador TP4056 (con protección)                                        | Cargar la batería con el panel                                    | S/ 4 – 6      |
| 1   | Batería 18650 de 3.7 V + porta-pila                                            | Funcionar de noche                                                | S/ 15 – 25    |
| 1   | Elevador MT3608 (3.7 V → 5 V)                                                  | El sensor necesita 5 V                                            | S/ 4 – 6      |
| 1   | Placa perforada + soldadura (en lugar de la protoboard)                        | Que no se suelten los cables                                      | S/ 5 – 10     |
| —   | Tubo PVC, abrazaderas y pernos                                                 | Montar el sensor en el puente, sobre el agua                      | S/ 15 – 25    |

## Conexiones

| Componente                         | Pin del componente | Pin del ESP32                                |
| ---------------------------------- | ------------------ | -------------------------------------------- |
| Ultrasónico                        | VCC                | **VIN (5 V)**                                |
| Ultrasónico                        | GND                | GND                                          |
| Ultrasónico                        | TRIG               | GPIO 5                                       |
| Ultrasónico                        | ECHO               | GPIO 18 **a través del divisor** (ver abajo) |
| LED verde (+ resistencia 220 Ω)    | ánodo (pata larga) | GPIO 25                                      |
| LED amarillo (+ resistencia 220 Ω) | ánodo              | GPIO 26                                      |
| LED rojo (+ resistencia 220 Ω)     | ánodo              | GPIO 27                                      |
| Buzzer activo                      | +                  | GPIO 14                                      |
| LEDs y buzzer                      | − / cátodo         | GND                                          |

**Divisor de voltaje del ECHO (obligatorio).** El sensor responde con 5 V y el ESP32 solo tolera 3.3 V
en sus pines: sin esto, con el tiempo se daña el GPIO.

```
ECHO del sensor ──[ 1 kΩ ]──┬── GPIO 18 del ESP32
                            │
                         [ 2 kΩ ]
                            │
                           GND
```

## Cargar el programa

1. Instala **Arduino IDE 2**. En _Preferencias → URLs adicionales de gestor de tarjetas_ agrega
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`. Después, en el _Gestor de
   tarjetas_, instala **esp32 by Espressif Systems**.
2. Copia `config.example.h` como `config.h` en esta misma carpeta y completa estos datos:
   - el WiFi, que tiene que ser de 2.4 GHz (el hotspot del celular sirve);
   - `SENSOR_API_KEY`, el mismo valor que en el `.env` / Render del backend;
   - `ALTURA_MONTAJE_CM`, que mides con una regla desde el sensor hasta el fondo.
3. Abre `sensor-rio-esp32.ino`, elige la placa **ESP32 Dev Module** y el puerto COM, y presiona
   **Subir**. Si no aparece el puerto, instala el driver **CP210x** o **CH340** (depende del chip USB de
   tu placa).
4. Abre el _Monitor serie_ a **115200** baudios. Tienes que ver `# WiFi OK` y, cada 5 segundos,
   `{"nivel_cm":...}` y `# Enviado OK (201)`.

### Modo cable USB (sin WiFi)

Si el WiFi falla en la exposición, deja el ESP32 conectado por USB a la PC donde corre el backend y
agrega al `.env`:

```
SERIAL_PORT=COM3        # el mismo puerto que ves en Arduino IDE (cierra el Monitor serie)
BAUD_RATE=115200
```

El backend lee las líneas `{"nivel_cm":...}` directamente (`src/servicios/serialIngest.js`).

## Problemas comunes

| Síntoma                        | Causa probable                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `# Sin eco válido`             | TRIG y ECHO cruzados, falta 5 V en VCC o el divisor está mal armado                            |
| Lecturas que saltan            | Algo se mueve frente al sensor, o hay paredes del recipiente dentro del cono del sensor (~15°) |
| `Error al enviar: 401`         | `SENSOR_API_KEY` distinta a la del backend                                                     |
| `Error al enviar: 404` / `500` | `SENSOR_CODIGO` no existe en el panel (Catálogo de Nodos)                                      |
| `Error al enviar: -1` o `-11`  | Sin internet, o Render estaba dormido: el siguiente envío suele funcionar                      |
| Nunca conecta al WiFi          | La red es de 5 GHz o la contraseña tiene un error                                              |
