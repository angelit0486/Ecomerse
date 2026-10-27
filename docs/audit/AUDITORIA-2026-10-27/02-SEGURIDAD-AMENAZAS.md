# 02 · Seguridad y modelo de amenazas (auditoría 2026-10-27)

Auditor: seguridad (solo lectura). Prefijo de hallazgos: **SEC-**.
Base revisada: HEAD `be5541d`, base local `pruva_dev` (PostgreSQL local, 120 migraciones), servidor local `localhost:3000` (build de producción: envía HSTS).

Términos usados:

- **RLS (Row Level Security):** filtro de filas que aplica PostgreSQL a cada consulta según quién la hace. `FORCE RLS` hace que también se aplique al dueño de la tabla.
- **SECURITY DEFINER:** función que corre con los permisos de quien la creó, no de quien la llama. Por eso debe validar ella misma quién la llama.
- **IDOR:** acceder a un objeto ajeno con solo cambiar su id en la petición.
- **AAL2:** sesión que ya pasó el segundo factor (TOTP). AAL1 es una sesión con un solo factor.
- **STRIDE:** las seis familias de amenazas: suplantación, alteración, repudio, fuga de información, denegación de servicio y escalada de privilegios.
- **SSRF:** hacer que el servidor descargue una URL interna (por ejemplo, la de metadatos de la nube).

## Resumen ejecutivo

No encontré ninguna vulnerabilidad **Crítica** ni **Alta**. El aislamiento entre tiendas es sólido en las tres capas que revisé:

1. **RLS:** forzado en las 109 tablas propias.
2. **Grants por columna:** las columnas de PII y de secretos no se otorgan.
3. **Funciones:** las 384 funciones SECURITY DEFINER fijan `search_path=''`, y todas las RPC públicas validan la membresía o la sesión del comprador.

Los webhooks, el runner de jobs, la vista previa, los enlaces de pedido y la descarga remota de fotos usan firmas HMAC (código de autenticación de mensaje con clave secreta), comparan en tiempo constante y rechazan peticiones viejas (anti-replay).

Los huecos están en **defensa en profundidad** y en **operación**:

- límites de tasa propios en el login del panel por código;
- enlaces de pedido de invitado sin caducidad;
- protección contra contraseñas filtradas apagada en staging;
- metatests que no cubren la lógica de autorización dentro de las RPC;
- detalles de redacción de logs.

## Hallazgos

| ID     | Sev.  | Título                                                                                                                  |
| ------ | ----- | ----------------------------------------------------------------------------------------------------------------------- |
| SEC-01 | Media | El login del panel por código no tiene límite de tasa propio; los límites de Auth son por la IP compartida del servidor |
| SEC-02 | Media | Enlace de pedido de invitado sin caducidad ni revocación, con PII y viajando en la URL                                  |
| SEC-03 | Media | Protección de contraseñas filtradas desactivada en Auth (staging), aunque ADR-031 permite contraseña al staff           |
| SEC-04 | Media | Los metatests no garantizan que cada RPC pública verifique permisos; todo comprador tiene JWT válido contra la Data API |
| SEC-05 | Baja  | Sin límite de tasa en carrito, búsqueda y listados de la tienda (DoS y crecimiento de `carts`)                          |
| SEC-06 | Baja  | La IP para límites sale del primer `x-forwarded-for`; solo es confiable detrás de Vercel                                |
| SEC-07 | Baja  | El límite de cuerpo de webhooks y del hook de email depende de `content-length`                                         |
| SEC-08 | Baja  | El metatest 5 acepta cualquier `search_path`, no exige `''`                                                             |
| SEC-09 | Baja  | El redactor de logs no cubre nombres, IP ni tokens dentro de URLs (`?t=`)                                               |
| SEC-10 | Baja  | `app.lock_media` bloquea la fila y distingue `not_found`/`forbidden` antes de verificar el permiso                      |
| SEC-11 | Baja  | Staging permite pagos simulados en la demo pública (`payments.allow_fake=true`)                                         |
| SEC-12 | Baja  | CSP sin `report-to`/`report-uri` y HSTS sin `preload`                                                                   |
| SEC-13 | Baja  | Reutilización de secretos para varios propósitos (`ORDER_LINK_SECRET`, `PREVIEW_HMAC_SECRET`)                           |

### SEC-01 · Media · El login del panel por código no tiene límite de tasa propio [INFERIDO]

**Evidencia:**

- `src/app/(acceso)/actions.ts`: `requestLoginCode` (≈l.39-69) llama a `supabase.auth.signInWithOtp` sin límite propio, y `verifyLoginCode` (≈l.71-92) llama a `verifyOtp` igual, sin límite.
- En el mismo archivo, `signInWithPassword` (l.116-121) sí usa `system.take_staff_login_attempt` por email y por IP. Su comentario reconoce el problema: «los [límites] de Supabase Auth son por la IP del servidor, compartida por todos los inicios de sesión».
- La tienda sí tiene `storefront.take_code_attempt` y `record_login_intent` (`src/server/storefront/account.ts:69-76`).

**Impacto:**

- Un desconocido puede agotar la cuota compartida de Auth: envíos de email y verificaciones por IP del servidor. Así bloquea el acceso de todo el staff, y también de los compradores, porque las llamadas salen de las mismas IP de Vercel.
- También puede inundar con códigos el correo de un miembro del staff conocido. `shouldCreateUser:false` limita esto a emails que ya tienen cuenta.
- Adivinar el código no da acceso al panel, porque sigue haciendo falta el TOTP. Por eso no es Alta.

**Recomendación:** usar `system.take_staff_login_attempt` (o uno análogo) en `requestLoginCode` y `verifyLoginCode`, por email e IP, igual que en el inicio con contraseña. Agregar una prueba de integración.

### SEC-02 · Media · Enlace de pedido de invitado sin caducidad ni revocación [VERIFICADO por lectura de código y SQL]

**Evidencia:**

- `storefront.get_order_for_guest` (base local, `pg_proc`) filtra solo por `store_id`, `id` y `guest_access_token_hash`. No hay ninguna condición de tiempo.
- Devuelve `email`, `customer_name`, `shipping_address` y los productos.
- El token va en la query: `orderPath()` en `src/server/storefront/checkout.ts` arma `/pedido/{id}?t={token}`. Esa misma URL se manda como `back_urls` a la pasarela y aparece en los correos.
- `src/server/observability/redact.ts` no enmascara `t=` dentro de las URLs (ver SEC-09).

**Impacto:** si el enlace se filtra (historial compartido, reenvío del correo, logs de solicitudes de Vercel o de la pasarela), da acceso **permanente** a PII del comprador. El token tiene 256 bits (HMAC-SHA256), así que adivinarlo no es viable; el riesgo es solo la filtración.

**Recomendación:**

- Caducidad de la vista completa (p. ej., 90 días después de la entrega). Pasado ese tiempo, mostrar solo el estado y pedir verificar el email con un código.
- Enmascarar `?t=` en los logs.
- Valorar mover el token a un fragmento (`#`) o canjearlo por una cookie host-only, como ya se hace con la vista previa.

### SEC-03 · Media · Protección de contraseñas filtradas desactivada [VERIFICADO en la línea base del orquestador; advisors de staging]

**Evidencia:**

- El advisor de seguridad de Supabase (staging, hoy) marca «leaked password protection disabled».
- ADR-031 permite entrar con contraseña (`signInWithPassword`).
- `setPassword` en `src/app/(acceso)/actions.ts` ya prepara el mensaje para `weak_password` («…ya apareció en filtraciones»), pero hoy Auth no hace esa comprobación.

**Impacto:** el staff puede elegir una contraseña que ya apareció en filtraciones. El TOTP mitiga la toma de cuenta, pero se pierde una capa.

**Recomendación:** activarla en Auth (staging y producción) y agregarla al checklist de lanzamiento. Es un pendiente conocido del propietario.

### SEC-04 · Media · Los metatests no garantizan que cada RPC pública verifique permisos [VERIFICADO]

**Evidencia:**

- `authenticated` puede ejecutar 164 funciones del esquema `public`. Consulté `has_function_privilege` en `pruva_dev`.
- Los compradores de **todas** las tiendas son usuarios de la misma instancia de Auth. Su JWT es válido contra PostgREST, y además pueden enrolar un TOTP por la API de Auth y llegar a AAL2.
- Revisé a mano las funciones que no llaman a un ayudante de permisos reconocible:
  - `access_accept_invitation`: exige que el email coincida y que el token esté vigente.
  - `account_*`: usan `app.require_account`, con sesión por código y cliente de esa tienda.
  - `storefront_link_customer`: exige email confirmado y probado en esta sesión.
  - `access_platform_role`, `app_schema_version`.
- Todas las RPC que reciben `store_id` validan la membresía con `app.has_store_permission`, que también exige AAL2 (`app.has_aal2`). **No encontré IDOR.**
- Pero `supabase/tests/database/00_schema_security.test.sql` solo verifica propiedades estructurales: RLS, grants, `search_path`, FK compuestas. No verifica que cada RPC autorice.

**Impacto:** si a una sola RPC futura le falta su verificación, cualquier comprador de cualquier tienda podría leer o escribir datos de otra tienda.

**Recomendación:** agregar un metatest genérico con dos reglas:

- toda función SECURITY DEFINER de `public` debe llamar a una lista blanca de guardas (`app.require_store_permission`, `app.require_org_permission`, `app.require_platform_role`, `app.require_account`, …) o estar en una lista explícita de excepciones revisadas;
- una prueba pgTAP «comprador con AAL2 de la tienda A» recorre todas las RPC con el `store_id` de B y espera `42501`, `not_found` o `null`.

### SEC-05 · Baja · Sin límite de tasa en carrito, búsqueda y listados [VERIFICADO]

**Evidencia:** las únicas funciones que llaman a `app.rate_limit_take` son estas:

- `cart_set_details`, `checkout_guard`, `discount_guard`, `place_order`, `record_login_intent`, `submit_review`, `take_code_attempt`, `take_staff_login_attempt`, `record_webhook_rejection`.

No lo llaman `storefront.cart_add_item`, que crea carritos, ni `list_products`/`list_facets`/`search_suggestions`, que reciben texto libre.

**Impacto:** un bot puede crear carritos sin límite (crecimiento de `carts`) o lanzar búsquedas costosas (denegación de servicio). El firewall o WAF de Vercel podría mitigarlo: [NO VERIFICADO], porque el conector responde 403.

**Recomendación:** limitar por IP la creación de carrito y la búsqueda, o activar reglas de tasa en el firewall de Vercel. Confirmar que existe una purga de carritos vencidos.

### SEC-06 · Baja · La IP para límites viene del primer `x-forwarded-for` [INFERIDO]

**Evidencia:** `clientIpHash()` en `src/server/storefront/cart.ts:212-217` y `getRequestMeta()` en `src/server/auth/request-meta.ts` toman el primer valor de `x-forwarded-for`.

**Impacto:** Vercel reescribe esa cabecera, así que hoy es confiable. Si la app se sirve detrás de otro proxy o en otro hosting, el cliente puede falsificar su IP y saltarse los límites por IP (no los límites por email).

**Recomendación:** documentar la dependencia en el runbook de despliegue y preferir la IP que entrega la plataforma (`x-real-ip`/`x-vercel-forwarded-for`), con una variable que declare el proxy de confianza.

### SEC-07 · Baja · El límite de cuerpo depende de `content-length` [INFERIDO]

**Evidencia:**

- `src/app/api/webhooks/payments/{mercadopago,stripe}/route.ts:25` y `src/app/api/auth/email-hook/route.ts` comparan `content-length` y después llaman a `request.text()`.
- `handleMercadoPagoWebhook` vuelve a comparar `rawBody.length > 262_144`, pero cuando el cuerpo ya está en memoria.

**Impacto:** una petición _chunked_ (enviada en trozos, sin `content-length`) se lee completa antes de rechazarse. Vercel corta en 4.5 MB, así que el impacto es menor.

**Recomendación:** leer el stream con un tope de bytes.

### SEC-08 · Baja · El metatest 5 no exige `search_path=''` [VERIFICADO]

**Evidencia:** `00_schema_security.test.sql:54-63` solo comprueba `cfg like 'search_path=%'`. Hoy las 384 funciones SECURITY DEFINER tienen `search_path=""`: una consulta a `pg_proc` que busca valores distintos regresó 0 filas.

**Impacto:** una regresión con `search_path=public` pasaría la CI. Eso contradice la regla 5 de CLAUDE.md.

**Recomendación:** que el metatest exija `search_path=""`.

### SEC-09 · Baja · El redactor de logs tiene huecos [VERIFICADO por lectura]

**Evidencia:** en `src/server/observability/redact.ts:6-19`:

- `SENSITIVE_KEY` no incluye `name`/`customer_name`/`recipient_name`/`full_name`, ni `ip`;
- los patrones de texto no cubren el token de pedido (`t=[A-Za-z0-9_-]{43}`) ni los tokens de invitación (64 hex).

**Impacto:** puede quedar PII parcial o un enlace de pedido en los logs si alguien registra una URL o un objeto con esas claves.

**Recomendación:** agregar esas claves y patrones, con pruebas en `redact.test.ts`.

### SEC-10 · Baja · `app.lock_media` revela si un id existe antes de verificar el permiso [VERIFICADO por lectura de `pg_proc`]

**Evidencia:** `app.lock_media` hace `select … for update` por `(id, store_id)` y responde `not_found` **antes** de llamar a `require_store_permission`. La usan `media_delete`, `media_finalize` y `media_set_alt_text`.

**Impacto:**

- Cualquier usuario con AAL2 (incluido un comprador, ver SEC-04) puede saber si un `media_id` existe en otra tienda, por la diferencia entre `not_found` y `forbidden`.
- También puede bloquear esa fila durante su transacción. Los ids son UUID, así que el oráculo es casi inútil.

**Recomendación:** verificar el permiso sobre `p_store_id` antes del `select … for update`.

### SEC-11 · Baja · Pagos simulados activos en la demo de staging [VERIFICADO en la línea base del orquestador]

**Evidencia:**

- En staging, `platform_settings.payments.allow_fake = {"enabled": true}`; en local también (consulta SELECT).
- `system.fake_payment_result` confirma el pedido como pagado.
- Barreras ya presentes: en TS, `fakePaymentResult` y la página `pago-simulado` devuelven 404 cuando `APP_ENV=production`; además, la página exige una firma HMAC del enlace.

**Impacto:** en staging cualquier visitante crea pedidos «pagados»: descuenta stock y ensucia métricas. En producción hay dos barreras (variable de entorno y ajuste en la base), pero ningún control impide activar `allow_fake` en la base de producción.

**Recomendación:**

- Checklist de lanzamiento: `allow_fake=false` en producción, y que `/api/health/ready` falle si está en `true` con `APP_ENV=production`.
- Que la consola de plataforma muestre el estado.

### SEC-12 · Baja · CSP sin reportes y HSTS sin `preload` [VERIFICADO con curl]

**Evidencia:** `curl -D - http://localhost:3000/ingresar` devuelve una CSP con nonce y `strict-dynamic`, pero sin `report-to`/`report-uri`. HSTS es `max-age=63072000; includeSubDomains`, sin `preload` (`src/server/security/headers.ts`).

**Impacto:** no hay visibilidad de las violaciones de CSP en producción, que serían una señal temprana de XSS o de errores de despliegue.

**Recomendación:** endpoint de reportes (aunque sea con muestreo) y, cuando exista el dominio propio, valorar `preload`.

### SEC-13 · Baja · Un mismo secreto sirve para varios propósitos [VERIFICADO por lectura]

**Evidencia:**

- `ORDER_LINK_SECRET` firma los tokens de invitado (`order-guest:`), firma el pago simulado (`fake-payment:`) y sala el hash de IP (`sha256(secret:ip)`, en `cart.ts:216`).
- `PREVIEW_HMAC_SECRET` firma los tokens de vista previa y la firma interna de ruta (`store-route:`). Esa firma es estática por tienda: no tiene nonce ni caducidad (`src/server/storefront/route-signature.ts`).

**Impacto:** no es explotable, porque los mensajes llevan un prefijo distinto por propósito y la firma de ruta nunca sale al cliente (el proxy borra `x-store-route` de la entrada). Pero rotar un secreto afecta a varios mecanismos a la vez.

**Recomendación:** derivar subclaves por propósito (HKDF) y documentar la rotación en un runbook.

## Modelo de amenazas STRIDE por componente

Leyenda de riesgo residual: **B** = bajo, **M** = medio.

### Storefront (tienda pública, `src/app/%5Fstore/[storeId]`, rol `storefront_gateway`)

| Amenaza                                                                                           | Control existente (ruta)                                                                                                                                                                                                                                                              | Riesgo residual |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| S: falsificar la tienda con la cabecera `x-store-id`/`x-store-route` o entrando por `/_store/...` | El proxy borra las cabeceras internas y responde 404 en `/_store` (`src/proxy.ts`, `INTERNAL_HEADERS`). `getStorefront` verifica la firma HMAC de la ruta (`src/server/storefront/context.ts`, `route-signature.ts`). Probado: `/_store/x` → 404, también con la cabecera falsificada | B               |
| T: alterar precio, total, descuento o stock desde el cliente                                      | `place_order` recalcula todo en la base; `expected_total` solo sirve para detectar cambios (`price_changed`); el stock pasa por reservas                                                                                                                                              | B               |
| T: activar la vista previa de un borrador                                                         | Token HMAC de 15 min (`preview.ts`) canjeado por una cookie host-only; la firma de ruta incluye el modo                                                                                                                                                                               | B               |
| I: IDOR de pedido o pago de invitado                                                              | `get_order_for_guest`, `retry_payment`, `order_reviewables` y `submit_review` exigen el hash del token. `payment_for_checkout`/`record_checkout_result`/`fake_payment_result` filtran por `store_id`, se llaman solo desde el servidor y el pago simulado exige una firma             | M (SEC-02)      |
| I: XSS con HTML del comerciante o JSON-LD                                                         | `SafeHtml` + `sanitize-html` con lista blanca (`src/server/security/sanitize.ts`), filtro en la RPC `content_save_page_blocks`, JSON-LD con `<` escapado; un único `dangerouslySetInnerHTML` (`src/ui/safe-html.tsx`); CSP con nonce                                                  | B               |
| D: abuso de carrito, búsqueda o checkout                                                          | `checkout_guard` (IP + email), `discount_guard`, `place_order` (20 pedidos por email al día)                                                                                                                                                                                          | M (SEC-05)      |
| R: negar haber hecho un pedido                                                                    | Pedido inmutable con snapshot, `order_events`, auditoría                                                                                                                                                                                                                              | B               |
| E: comprador → staff                                                                              | El staff exige AAL2 + membresía (`app.has_store_permission`)                                                                                                                                                                                                                          | B               |

### Panel (`src/app/admin`) y consola de plataforma (`src/app/platform`)

| Amenaza                                                  | Control existente (ruta)                                                                                                                                                                           | Riesgo residual    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| S: robo o adivinación de credenciales                    | Código por email o contraseña de 12 a 72 caracteres + TOTP obligatorio (`src/app/(acceso)/actions.ts`); `requireStaffSession` (`src/server/auth/guards.ts`); `getClaims()` valida la firma del JWT | M (SEC-01, SEC-03) |
| E: miembro de la tienda A actúa sobre la tienda B (IDOR) | RLS `has_store_permission(store_id, …)` en todas las tablas; las RPC validan permiso y AAL2; FK compuestas `(store_id, …)`; trigger `prevent_tenant_change`                                        | B                  |
| E: escalar de rol o aceptar una invitación ajena         | `access_accept_invitation` exige el email exacto, un token de 64 hex (hash), sin caducar ni revocar, y no deja tomar la propiedad si ya hay dueño                                                  | B                  |
| E: soporte de plataforma entra sin permiso               | `support_access_grants` con AAL2, caducidad y revocación del dueño (`app.revoke_support_grant`); auditoría `support_session.*`                                                                     | B                  |
| T: CSRF en Server Actions                                | Next verifica Origin contra Host en las Server Actions (comportamiento por defecto; `next.config.ts` no agrega `allowedOrigins`), cookies `SameSite=Lax`, `form-action 'self'`                     | B [INFERIDO]       |
| R: acciones sensibles sin rastro                         | `audit.record(...)` en las RPC; `audit.audit_logs` es append-only (trigger `audit_logs_append_only` en cada partición); `security_events`                                                          | B                  |
| I: PII visible para roles sin permiso                    | Grants por columna: `orders.email/phone/customer_name/shipping_address` no se otorgan; los costos están detrás de `products.cost.read`; `payment_accounts.secret_ref` no se otorga                 | B                  |
| D: clickjacking                                          | `frame-ancestors 'none'` + `X-Frame-Options: DENY`                                                                                                                                                 | B                  |

### API/RPC (PostgREST + funciones)

| Amenaza                                             | Control existente                                                                                                                                                                                                                                  | Riesgo residual |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| E: llamada directa a PostgREST con JWT de comprador | `anon` sin grants ni USAGE en los esquemas internos (metatests 2, 3, 6); RPC con guardas; esquemas `app/audit/private/storefront/system` no expuestos                                                                                              | M (SEC-04)      |
| T: escritura directa a tablas                       | `authenticated` solo tiene UPDATE por columna en `customers(first_name,last_name,phone)`, `profiles(locale,full_name,avatar_path)` y `stores(nombre, contacto, fiscal…)`, siempre bajo RLS; ningún INSERT/DELETE (consulta a `information_schema`) | B               |
| E: secuestro de `search_path`                       | Las 384 funciones SECURITY DEFINER tienen `search_path=""`                                                                                                                                                                                         | B (SEC-08)      |
| I: secretos en las respuestas                       | `payment_events.payload` y `payment_accounts.*secret_ref` sin grant                                                                                                                                                                                | B               |

### Webhooks de pago (Mercado Pago y Stripe)

| Amenaza                               | Control existente                                                                                                                                                                                                                                                                                         | Riesgo residual |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| S: webhook falso que confirma un pago | MP: firma `x-signature` (±5 min) que cubre `data.id` + `x-request-id`; **se vuelve a consultar el cobro a MP** y se valida el collector, la referencia, el monto y la moneda (`mercadopago-webhook.ts`). Stripe: `verifyStripeSignature` (±300 s, tiempo constante). Probado: un POST sin firma → 404/401 | B               |
| T/R: replay o eventos duplicados      | `record_payment_event` deduplica por `(cuenta, event_id)`; idempotencia en `apply_*`                                                                                                                                                                                                                      | B               |
| D: cuerpos grandes                    | 256 KB por `content-length`                                                                                                                                                                                                                                                                               | B (SEC-07)      |
| I: PII en el payload                  | `sanitize()` guarda solo id, tipo, acción, user_id y data.id                                                                                                                                                                                                                                              | B               |

### Jobs (`/api/jobs/run`, Vercel Cron, pg_cron + pg_net)

| Amenaza                                | Control existente                                                                                                                                    | Riesgo residual |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| S: ejecutar el runner sin autorización | Bearer `CRON_SECRET` (≥32) o HMAC `JOBS_HMAC_SECRET` con ±60 s, tiempo constante (`src/server/jobs/authorize.ts`). Probado: GET sin credencial → 401 | B               |
| E: el worker toca tablas               | `system_worker` sin grants de tabla (metatest 8), solo `EXECUTE system.*`                                                                            | B               |
| D: disparos repetidos                  | Claim con lock y timeout (`system.claim_jobs`), `maxDuration` 60 s                                                                                   | B               |

### Storage (subidas y buckets)

| Amenaza                           | Control existente                                                                                                                                                                                                                                                                                            | Riesgo residual |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| T/I: subir SVG o HTML ejecutable  | Buckets limitados a jpeg/png/webp/avif y 10 MB; política `media_upload_insert` con `app.media_upload_allowed(name)`; validación por _magic bytes_ (los primeros bytes del archivo) + decodificador de sharp + `limitInputPixels`, y recodificación (`src/server/media/image.ts`)                             | B               |
| I: leer originales de otra tienda | `store-uploads` es privado; solo `store-media` (ya procesado) es público                                                                                                                                                                                                                                     | B               |
| SSRF al importar fotos remotas    | Solo https:443; bloqueo de IP privada, loopback, link-local, metadatos, NAT64, 6to4 y Teredo; conexión a la IP ya validada (evita DNS rebinding); 3 redirecciones al mismo host; tope de bytes y de tiempo (`src/server/media/remote-fetch.ts`); el origen de pruebas está prohibido en preview y producción | B               |

### Auth (Supabase Auth, 2FA, sesiones, códigos)

| Amenaza                                      | Control existente                                                                                                                                | Riesgo residual |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| S: enumerar cuentas                          | La misma respuesta exista o no la cuenta (`requestLoginCode`, `signInWithPassword`)                                                              | B               |
| S: fuerza bruta de código o contraseña       | Contraseña: límite propio por email e IP. Código del panel: solo el límite de Auth. Código de la tienda: `take_code_attempt`                     | M (SEC-01)      |
| E: el comprador usa la sesión de otra tienda | Cookies host-only por tienda; `account_customer` exige un cliente de ESA tienda, email igual al de la cuenta y una sesión por código (`amr` otp) | B               |
| I: permisos en el JWT                        | No hay: los permisos se calculan en la base en cada llamada                                                                                      | B               |

### Correos (Resend, Send Email Hook)

| Amenaza                                         | Control existente                                                                                                         | Riesgo residual |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------- |
| S: hook falso                                   | Sin `SEND_EMAIL_HOOK_SECRET` → 404 (probado); con secreto, Standard Webhooks (`src/server/security/standard-webhooks.ts`) | B               |
| I: correos a destinatarios reales desde la demo | `EMAIL_PROVIDER=fake` solo se permite en preview; producción exige Resend (`src/config/env.ts`)                           | B               |
| Spoofing del remitente                          | SPF/DKIM/DMARC pendientes del propietario                                                                                 | [NO VERIFICADO] |

## Controles verificados (lo que está bien, con evidencia)

1. **RLS forzado en todas las tablas propias**: public 77/77, audit 28/28 y system 4/4 tienen `relrowsecurity` y `relforcerowsecurity`. Hay 73 políticas en `public`, ninguna `USING (true)`. Las 9 tablas de `public` sin política (carts, cart_items, compliance__, feature_flag_, notification_deliveries, platform_settings, store_counters) quedan cerradas por defecto (_deny-all_) y solo se accede a ellas por funciones. [VERIFICADO, `pg_class`/`pg_policies` en `pruva_dev`]
2. **Grants mínimos**: `anon` no tiene grants en los esquemas propios; `service_role`, `storefront_gateway` y `system_worker` tampoco tienen grants de tabla. Cada rol solo tiene USAGE en su esquema. [VERIFICADO, `information_schema.role_table_grants` y `has_schema_privilege`]
3. **PII y secretos excluidos por columna**: los grants de SELECT no incluyen `orders.email/phone/customer_name/shipping_address/billing_address/guest_access_token_hash`, ni `payment_accounts.secret_ref/webhook_secret_ref`, ni `payment_events.payload`, ni `customers.note`. [VERIFICADO]
4. **SECURITY DEFINER**: 384 funciones, todas con `search_path=""`; ninguna ejecutable por PUBLIC (metatest 4). [VERIFICADO]
5. **Autorización en las RPC**: revisé a mano las RPC públicas que no usan una guarda reconocible: `access_*`, `account_*`, `content_*_page_blocks`, `media_*`, `storefront_link_customer`, `platform_revoke_support_access`. Todas validan permiso, propiedad o sesión. `app.has_store_permission` exige AAL2, membresía activa, tienda no suspendida y modo de organización. [VERIFICADO, `pg_proc`]
6. **Tokens**:
   - invitado: HMAC-SHA256 de 256 bits; la base guarda solo el SHA-256;
   - vista previa: 15 min, nonce, HMAC, tiempo constante;
   - jobs: HMAC ±60 s;
   - Stripe: ±300 s; MP: ±5 min.

   Todos comparan con `constantTimeEqual`, que compara los SHA-256 para no filtrar la longitud del valor (`src/server/security/hmac.ts`). Los secretos exigen ≥32 caracteres (`src/config/env.ts`). [VERIFICADO]

7. **Cabeceras** medidas con curl en el panel y en `demo.localhost`: CSP con nonce por request + `strict-dynamic`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy, COOP, HSTS 2 años, `Cache-Control: no-store` en páginas dinámicas, y `x-request-id` generado por el servidor. [VERIFICADO]
8. **Rutas internas inaccesibles**: `/_store/...` → 404, incluso con la cabecera `x-store-route` falsificada. `/api/jobs/run` sin credencial → 401 con un error `AppError` uniforme. [VERIFICADO con curl]
9. **XSS**: un único `dangerouslySetInnerHTML` (`src/ui/safe-html.tsx`), que sanitiza siempre al renderizar. JSON-LD sin `dangerouslySetInnerHTML`. [VERIFICADO con grep]
10. **SSRF**: la descarga remota es robusta (ver la tabla de Storage). [VERIFICADO por lectura; hay pruebas en `remote-fetch.test.ts`]
11. **Dependencias**: `pnpm audit --prod` → «No known vulnerabilities found». [VERIFICADO hoy]
12. **Secretos**:
    - ningún patrón de clave (`sk_live_`, `whsec_`, `APP_USR-`, `re_…`, claves privadas, `AKIA`, `ghp_`) en el árbol fuera de pruebas y documentación;
    - ningún nombre de secreto ni JWT en `.next/static`;
    - en el cliente solo existen `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`, ambos públicos por diseño.

    [VERIFICADO con grep. El escaneo del historial de git es de la línea base: en este árbol `git log` solo dio los encabezados.]

13. **Auditoría inmutable**: trigger `audit_logs_append_only` en cada partición de `audit.audit_logs`; también hay `security_events`. [VERIFICADO]
14. **Webhook MP**: no confía en el cuerpo. Vuelve a consultar el cobro y compara el collector. Una cuenta desconocida queda registrada como evento de seguridad. [VERIFICADO por lectura]

## Tareas propuestas (priorizadas)

1. **(SEC-01)** Límite propio por email e IP en `requestLoginCode` y `verifyLoginCode` del panel, con prueba de integración. _Esfuerzo bajo._
2. **(SEC-03)** Activar la protección de contraseñas filtradas en Auth (staging y producción) y agregarla al checklist de lanzamiento. _Configuración._
3. **(SEC-04)** Metatest «toda SECURITY DEFINER de `public` llama a una guarda o está en la lista de excepciones» y una prueba pgTAP de cruce A→B para todas las RPC con un comprador AAL2. _Esfuerzo medio, alto valor._
4. **(SEC-02)** Política de caducidad del enlace de invitado y redacción de `?t=` en los logs. _Requiere decisión (ADR), porque toca un contrato del checkout (§43)._
5. **(SEC-11)** Comprobación en `/api/health/ready` y en el checklist: `allow_fake=false` en producción.
6. **(SEC-05)** Límites de tasa en `cart_add_item`/búsqueda, o reglas de firewall en Vercel.
7. **(SEC-08, SEC-09, SEC-10)** Endurecer el metatest 5, el redactor y el orden de verificación en `lock_media`.
8. **(SEC-06, SEC-07, SEC-12, SEC-13)** Higiene: IP de plataforma, tope de stream, reportes de CSP y subclaves por propósito.

## No verificado

- **Vercel** (firewall, variables, logs, que reescriba `x-forwarded-for`): el conector responde 403. [NO VERIFICADO]
- **Límites reales de Supabase Auth hospedado** (OTP y verificaciones por IP), **SPF/DKIM/DMARC**, **Mercado Pago y Stripe reales**: no hay servicios ni credenciales reales.
- **Server Actions con un Origin ajeno**: no lo probé con curl, porque hace falta el id de la acción compilada. El control es el de Next por defecto. [INFERIDO]
- **Escaneo de `git log -p`**: este árbol de trabajo no expone el historial completo; me apoyé en el escaneo de la línea base (0 hallazgos).
