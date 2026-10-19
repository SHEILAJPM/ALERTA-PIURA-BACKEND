// Preload para `node --test` (ver package.json: "test": "node --import ./pruebas/env-setup.js --test").
//
// No sirve poner `process.env.JWT_SECRET ??= "..."` como primera línea de cada
// archivo de test: en ES modules los `import` se evalúan antes que cualquier
// otra sentencia del propio módulo (incluida una que esté escrita antes en el
// archivo), así que src/servicios/auth.js ya habría lanzado su error de
// "falta JWT_SECRET" antes de llegar a ejecutar esa línea. Un --import previo
// sí corre (y termina) antes de que se evalúe ningún archivo de test.
process.env.JWT_SECRET ??= "test-secret-not-for-production";
// Mismo motivo con bd/pool.js, que lanza al importarse si falta DATABASE_URL:
// cualquier test que importe un servicio con acceso a la base (aunque solo
// pruebe una función pura) reventaba antes de correr, también en CI. `pg` no
// abre ninguna conexión hasta la primera consulta, así que una URL ficticia
// alcanza; los tests que tocan la base mockean pool.query/pool.connect.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
