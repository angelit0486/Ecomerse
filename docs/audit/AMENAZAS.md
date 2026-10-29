# Modelo de amenazas STRIDE (2026-10-29)

Alcance: la plataforma PRUVA tal como está en el commit de esta auditoría (tienda pública, panel, consola, base de datos con RPC, webhooks, cola de trabajos, Storage, Auth y correo). Registro de riesgos con dueño y fecha: `RIESGOS.md`. Informe: `docs/phases/AUDITORIA-AMENAZAS-2026-10-29.md`.

**STRIDE:** **S**uplantación · **T**ampering (alteración) · **R**epudio · **I**nformación expuesta · **D**enegación de servicio · **E**levación de privilegios.

Probabilidad (P) e impacto (I): Baja, Media o Alta, estimadas para una plataforma con pocas tiendas en México. Cada mitigación cita dónde vive o la prueba que la sostiene.

## 1. Tienda pública (storefront)

| STRIDE | Amenaza                                           | P     | I     | Mitigación (evidencia)                                                                                                                                         | Señal de alerta                                 |
| ------ | ------------------------------------------------- | ----- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| S      | Alguien sirve otra tienda con un `Host` falso     | Baja  | Alta  | El proxy firma la tienda resuelta (`STORE_ROUTE_HEADER`, HMAC); las páginas solo aceptan la firma (`verifyStoreRoute`)                                         | 404 inesperados en Vercel                       |
| T      | El navegador manda otro precio o total            | Media | Alta  | El total lo calcula la base (`app.calculate_cart`); `place_order` rechaza un total distinto (`price_changed`). Regla 8. E2E `checkout.spec` «total manipulado» | Errores `price_changed` en ráfaga               |
| T      | Doble clic o dos pestañas crean dos pedidos       | Media | Media | Clave de idempotencia del checkout; integración `checkout-concurrency` «doble envío simultáneo → un solo pedido»                                               | Pedidos duplicados del mismo correo en minutos  |
| T      | Sobreventa por compras simultáneas                | Media | Media | Inventario solo con `app.apply_inventory_movement` y bloqueo de fila (regla 10); pgTAP de inventario y concurrencia                                            | Existencias negativas (la base no las permite)  |
| I      | Ver el pedido de otro comprador                   | Baja  | Alta  | Enlace de invitado con token HMAC de 256 bits; la base solo guarda su hash. Sin vigencia (SEC-02, ver RIESGOS R-07)                                            | Accesos a `/pedido/` con tokens inválidos       |
| I      | El carrito recuperado deja ver datos de envío     | Baja  | Media | Enlace de un solo uso, 256 bits, solo al correo del comprador; se confirma con botón (ADR-048)                                                                 | —                                               |
| D      | Muchas peticiones al carrito, búsqueda o checkout | Media | Media | Límites por IP y correo en checkout, códigos y cuentas (`app.rate_limit_take`); para carrito y búsqueda falta el firewall de Vercel (R-09)                     | Picos en Vercel Observability; 429 en checkout  |
| E      | XSS en contenido de la tienda                     | Baja  | Alta  | Sin `dangerouslySetInnerHTML` salvo `SafeHtml` (sanitizado); CSP con nonce y `strict-dynamic`; sin CSS/JS del comerciante (regla 13)                           | Reportes de CSP (pendiente `report-to`, SEC-12) |

## 2. Panel de la tienda y consola de la plataforma

| STRIDE | Amenaza                                            | P     | I     | Mitigación (evidencia)                                                                                                                                      | Señal de alerta                           |
| ------ | -------------------------------------------------- | ----- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| S      | Robo de cuenta de personal                         | Media | Alta  | Código por correo o contraseña **y** TOTP obligatorio (`requireStaffSession`); límite de intentos de contraseña (`staff_password:*`)                        | `audit.security_events` con fallos de 2FA |
| S      | CSRF en acciones del panel                         | Baja  | Media | Server Actions de Next con verificación de Origin; `/salir` por POST (SEC F1.9); cookies `SameSite=Lax`                                                     | —                                         |
| T/E    | IDOR: tocar datos de otra tienda cambiando un id   | Media | Alta  | RLS forzado en toda tabla de tienda + `app.require_store_permission` en cada RPC; metatests 15–17 y `05_tenant_isolation` (toda tabla nueva queda cubierta) | `forbidden` repetidos de un mismo usuario |
| E      | Rol con menos permisos hace acciones de otro       | Baja  | Alta  | Permisos por rol en la base (no en el JWT, regla 7); pgTAP por permiso                                                                                      | —                                         |
| I      | Rol de solo lectura ve PII completa de compradores | Media | Media | **Abierto:** `viewer` e `inventory_manager` ven correo y dirección. Propuesto ADR-054 (R-04)                                                                | —                                         |
| R      | Alguien niega haber cambiado precios o reembolsado | Baja  | Media | `audit.audit_logs` en acciones sensibles (precios, reembolsos, permisos, soporte)                                                                           | —                                         |
| E      | Soporte de la plataforma accede sin motivo         | Baja  | Alta  | Acceso temporal con motivo, aviso al dueño y auditoría (GATE0 §7.7)                                                                                         | Correo «Acceso de soporte» inesperado     |

## 3. RPC / Data API (PostgREST)

| STRIDE | Amenaza                                            | P    | I     | Mitigación (evidencia)                                                                                        | Señal de alerta              |
| ------ | -------------------------------------------------- | ---- | ----- | ------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| E      | Función `SECURITY DEFINER` sin control de permisos | Baja | Alta  | Metatest 15: toda función definer de `public` llega a una guarda; `search_path = ''` exacto (metatest 5)      | Advisor de Supabase          |
| I      | Esquemas internos expuestos                        | Baja | Alta  | `app`, `audit`, `private`, `storefront`, `system` fuera de la Data API (regla 6); `anon` sin grants (regla 3) | Advisor «exposed schema»     |
| D      | Consultas caras a propósito                        | Baja | Media | Límites de página (máx. 100), topes en funciones (`least(...)`), índices                                      | Supabase → Query performance |

## 4. Webhooks (Mercado Pago, Stripe, Resend)

| STRIDE | Amenaza                            | P     | I     | Mitigación (evidencia)                                                                                                           | Señal de alerta                    |
| ------ | ---------------------------------- | ----- | ----- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| S      | Aviso de pago falso                | Media | Alta  | Firma verificada y **re-consulta** del cobro al proveedor (monto, moneda, referencia, cuenta); integración `mercadopago-webhook` | Consola → Salud: rechazos de firma |
| T      | Reenvío de un aviso viejo (replay) | Baja  | Media | Ventana de tiempo de la firma; idempotencia por id de evento                                                                     | Mismo id de evento rechazado       |
| D      | Cuerpos enormes                    | Baja  | Baja  | `readBodyLimited` con tope real de bytes (SEC-07)                                                                                | 413 en logs                        |

## 5. Cola de trabajos (jobs)

| STRIDE | Amenaza                                    | P     | I     | Mitigación (evidencia)                                                                                | Señal de alerta                   |
| ------ | ------------------------------------------ | ----- | ----- | ----------------------------------------------------------------------------------------------------- | --------------------------------- |
| S      | Disparar la cola desde fuera               | Baja  | Media | `CRON_SECRET` y `JOBS_HMAC_SECRET`; el rol `system_worker` solo ejecuta `system.*` (regla 4)          | 401 en `/api/jobs/run`            |
| D      | Una tienda satura la cola (vecino ruidoso) | Media | Media | **Corregido AUD-03:** 30 importaciones por hora por tienda; 50 subidas pendientes; trabajos por lotes | Consola → Trabajos: cola atrasada |
| T      | Un trabajo repetido duplica efectos        | Baja  | Media | Handlers idempotentes (GATE0 §43); claves de dedupe en correos                                        | —                                 |

## 6. Storage (fotos)

| STRIDE | Amenaza                                | P     | I     | Mitigación (evidencia)                                                                                                   | Señal de alerta                      |
| ------ | -------------------------------------- | ----- | ----- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| T      | Subir un archivo malicioso (SVG, HTML) | Media | Alta  | Ruta generada por el servidor; el worker valida los magic bytes y decodifica con sharp; sin SVG (regla 13); quita EXIF   | Medios `rejected`                    |
| D      | Llenar el almacenamiento               | Media | Media | Cuota `storage_mb` por plan; máx. 50 subidas pendientes por tienda; tamaño máximo por tipo                               | Uso cerca del límite en «Plan y uso» |
| I      | Leer fotos privadas                    | Baja  | Baja  | Bucket privado de origen; solo las variantes públicas se sirven                                                          | —                                    |
| S      | SSRF con «foto desde enlace» (ADR-033) | Media | Alta  | Descargador que bloquea IP privadas, link-local y metadata (169.254.169.254), con tope de tamaño; `remote-fetch.test.ts` | Descargas rechazadas                 |

## 7. Auth (Supabase)

| STRIDE | Amenaza                 | P     | I     | Mitigación (evidencia)                                                                                     | Señal de alerta                           |
| ------ | ----------------------- | ----- | ----- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| S      | Contraseñas filtradas   | Media | Media | TOTP obligatorio para personal; falta activar «leaked password protection» en Supabase (R-12, propietario) | Advisor `auth_leaked_password_protection` |
| S      | Fuerza bruta de códigos | Media | Media | Límites de Supabase Auth + límites propios por correo e IP para compradores (`buyer_otp:*`)                | `rate_limited` en ráfaga                  |
| E      | Permisos en el JWT      | Baja  | Alta  | Nunca (regla 7): la base consulta membresía y rol en cada llamada                                          | —                                         |
| I      | Sesiones eternas        | Baja  | Media | JWT de 1 hora con refresh rotativo; vida máxima de sesión configurable en Supabase (R-13)                  | —                                         |

## 8. Correo

| STRIDE | Amenaza                                | P     | I     | Mitigación (evidencia)                                                                                                             | Señal de alerta                            |
| ------ | -------------------------------------- | ----- | ----- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| S      | Suplantación del remitente             | Media | Alta  | SPF, DKIM y DMARC del dominio (runbook `correo-resend.md`); falta que el propietario configure el dominio (R-10)                   | Reportes DMARC                             |
| T      | Inyección en asuntos o nombres         | Baja  | Media | `safeDisplayName` y escape de todo dato (`escapeHtml`); pruebas de plantillas                                                      | —                                          |
| D      | Reputación dañada por quejas o rebotes | Media | Alta  | **Corregido AUD-05:** baja en un clic (RFC 8058) en recordatorios; supresión de rebotes y quejas; un solo recordatorio por carrito | Tasa de quejas en Postmaster Tools > 0.1 % |
| I      | PII en logs                            | Baja  | Media | Logger que enmascara correo, nombres, IP y tokens (SEC-09)                                                                         | —                                          |
