# Pruebas de carga (k6)

Requiere [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/). Solo hace consultas: no guarda
nada en la base de datos.

```
k6 run pruebas-carga/k6-consultas.js                                  # contra Render
k6 run -e URL=http://localhost:4000 pruebas-carga/k6-consultas.js     # contra tu PC
```

Mientras corre (y hasta 5 minutos después), la web abierta desde la misma red puede recibir
"demasiadas peticiones" (429): el limitador cuenta por IP.

## Resultado contra Render (plan gratis), 10/11/2026

| Métrica | Valor |
| --- | --- |
| Usuarios simultáneos (máximo) | 110 (100 en `/health` + 10 usando la app) |
| Duración | 2 min 30 s |
| Peticiones totales | 7 487 (48 por segundo) |
| Tiempo de respuesta promedio | 295 ms |
| Tiempo de respuesta p95 (95 % de las peticiones) | 567 ms |
| Peor tiempo | 1,79 s |
| Errores reales (caídas, timeouts, 5xx) | 0 % |
| Bloqueadas por el limitador (429, esperado) | 202 |

Los ~230 ms mínimos son la distancia de red entre Perú y el servidor de Render, no procesamiento.

## Prueba de estrés: punto de quiebre (`k6-estres.js`), 10/11/2026

```
k6 run pruebas-carga/k6-estres.js                              # 100 → 1000 usuarios
k6 run -e ESCALONES=400,600,800,1000 pruebas-carga/k6-estres.js
```

Cada usuario pide `/health` (consulta Postgres) una vez por segundo. **Puede dejar el backend lento
unos minutos y hacer que Cloudflare (delante de Render) bloquee tu IP un rato.**

| Usuarios simultáneos | Peticiones/s | Tiempo promedio | Errores |
| --- | --- | --- | --- |
| 100 | 60 | 0,3 s | 0 % |
| 200 | 118 | 0,4 s | 0 % |
| 400 | 155 | 1,6 s | 0 % |
| 600 | 162 | 2,7 s | 0 % |
| 800 | 140 | 4,3 s | 22 % (timeouts de 15 s) |
| ~890 | — | — | Cloudflare bloquea la IP (429 "Just a moment...") |

- **Capacidad máxima del plan gratis de Render: ~165 peticiones por segundo.** A partir de ~400
  usuarios intensivos el servidor está saturado: no atiende más, solo responde más lento.
- **Sin errores hasta 600 usuarios intensivos**; desde 800 empiezan los timeouts.
- Un usuario real de la app hace ~8 peticiones por minuto (no 60), así que ese tope equivale a
  **más de 1000 personas con la app abierta a la vez** (estimación).
- Cerca de 900 usuarios desde una misma IP, **Cloudflare corta el tráfico**: segunda capa de
  protección contra ataques, además del limitador por IP del backend.
