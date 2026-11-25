# Diagnóstico F-08: páginas y checkout colgados a través del pooler

Fecha: 2026-11-25. Rama `fix/checkout-validacion-rapida` sobre `62d4dc6`.

## 1. Síntoma

- Staging, 2026-11-17: tras un `validation_failed` de `place_order`, «Confirmar pedido» quedó colgado 300 s.
  Postgres registró «unexpected EOF … with an open transaction». Solo pasa con Supavisor (modo transacción);
  en local no se reproducía [issue #18].
- Auditoría 2026-11-24: 13 páginas colgadas 300 s en 7 días (inicio, categoría, marca y pago; 6 clientes), con
  `CONNECT_TIMEOUT` al pooler y `statement timeout` en racimos (5 en el mismo segundo). Las consultas tardan 3–4 ms
  [issue #18, `6405786`].
- Mitigación ya desplegada (`6405786`): `maxDuration = 30` en la tienda y 60 s en el pago. El comprador sigue
  esperando hasta 30–60 s y ve el error genérico de Vercel; la conexión atorada se queda en el pool del servidor
  caliente.

## 2. Causa (la más consistente con la evidencia; no confirmada en el pooler alojado)

- postgres.js 3.4.9 con `prepare: false` manda cada consulta con parámetros en **dos escrituras**:
  `Parse + Describe + Flush` (sin `Sync`) y, al recibir `ParameterDescription`, `Bind + Execute + Sync`
  (`node_modules/postgres/src/connection.js`, `describeFirst`).
- Supavisor en modo transacción tenía fallos con exactamente esa forma («un `Sync` mandado en otra escritura»):
  podía soltar el backend antes de tiempo o dejar al cliente esperando una respuesta que nunca llega. Se corrigió
  en Supavisor v2.10.0 (2026-11-06; PR supabase/supavisor#1079, #1176, #1205). No sabemos si el pooler compartido
  de `pruva-staging` ya corre esa versión.
- Encaja con todo lo observado: el backend queda a medias entre `Parse` y `Sync` (transacción implícita abierta →
  «unexpected EOF … with an open transaction» cuando Vercel mata la función), la base corta a los 5 s
  (`statement_timeout` de `storefront_gateway` → los `statement timeout` del log) pero la respuesta no llega al
  cliente, y el cliente espera hasta el límite de la función. La conexión atorada sigue en el pool (`max: 3`), por eso
  los errores vienen en racimos en el mismo servidor.

## 3. Arreglo (solo código, sin migraciones ni cambios de entorno)

`src/server/db/query-deadline.ts`, aplicado solo al cliente `storefront_gateway` (`gatewayDb()`):

- **Plazo de 15 s por consulta** (y por `begin` completo). La base ya corta a los 5 s y la conexión tiene 10 s para
  abrirse; una respuesta que no llegó en 15 s no va a llegar.
- **Pool nuevo al vencer el plazo.** El viejo se cierra con `end({ timeout: 5 })`: lo sano termina y la conexión
  atorada se destruye. Quien guardó `const db = gatewayDb()` sigue funcionando: el proxy apunta al pool vigente.
- **Checkout:** si el plazo vence al confirmar, el comprador ve «La tienda tardó en responder. Vuelve a tocar
  “Confirmar pedido”: si tu pedido ya había entrado, no se duplica.» Es cierto porque el formulario conserva su
  clave de idempotencia y `place_order` con la misma clave repite el pedido (`replayed`), cubierto por
  `tests/integration/checkout-concurrency.test.ts`.
- El cliente del worker (cola de trabajos e importaciones) no cambia: sus transacciones largas usan otro
  `statement_timeout`.

## 4. Pruebas

- `src/server/db/query-deadline.test.ts` (unit, 9): respuesta normal sin cambios, errores de la base intactos,
  rechazo exacto a los 15 s, pool reemplazado una sola vez, `catch`/`finally`, fragmentos y `db.json`, `begin`.
- `tests/integration/gateway-query-deadline.test.ts` (PostgreSQL real + postgres.js real + proxy TCP que pierde las
  respuestas de las conexiones abiertas, como Supavisor):
  - sin plazo, la consulta sigue esperando a los 3 s y el reintento en el mismo pool también (reproduce el fallo);
  - con plazo (1.5 s en la prueba), falla a los ~1.5 s y el reintento responde con un pool nuevo;
  - 20 consultas sanas en paralelo y una de 0.5 s: sin falsos positivos.

## 5. Qué queda y opciones del propietario

- El arreglo convierte un cuelgue largo en un error corto que se recupera solo; no evita que el pooler pierda una
  respuesta. Si se repite, el log dice `gateway: la base no respondió a tiempo; se reemplaza el pool`.
- Opciones de fondo (requieren decisión del propietario; no se tocaron):
  1. Pedir a Supabase que confirme la versión de Supavisor del pooler compartido de `pruva-staging` (≥ v2.10.0).
  2. Pasar `GATEWAY_DATABASE_URL` al pooler en **modo sesión** (puerto 5432), que no reparte el backend entre
     escrituras. Cambia una variable de Vercel y consume más conexiones: medir antes.
