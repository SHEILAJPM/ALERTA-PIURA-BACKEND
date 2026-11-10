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
