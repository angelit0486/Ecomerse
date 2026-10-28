# Misión vendible · F1.9 · Revisión de seguridad (2026-10-28)

Punto de partida: los 13 hallazgos `SEC-` de `docs/audit/AUDITORIA-2026-10-27/02-SEGURIDAD-AMENAZAS.md`. Aquí está lo que se corrigió, cómo se probó y lo que sigue abierto (y por qué).

## Corregido en esta tanda

| ID     | Gravedad | Qué se hizo                                                                                                                                                                                                                      | Prueba                                                                                                                |
| ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| SEC-04 | Media    | Metatest nuevo: toda función SECURITY DEFINER de `public` (las 172 que ve la Data API) llama a una guarda de permisos o a un ayudante de `app` que la llama. Hoy: 0 sin guarda. Cubre automáticamente toda función nueva         | `00_schema_security` 15; los tests 16 y 17 demuestran que detecta una función sin guarda y que acepta la que delega   |
| SEC-08 | Baja     | El metatest 5 exige `search_path = ''` exacto, no solo que exista                                                                                                                                                                | `00_schema_security` 5 (las 384 funciones ya cumplían)                                                                |
| SEC-10 | Baja     | `app.lock_media` verifica algún permiso de medios en la tienda **antes** de buscar y bloquear la fila. Sin acceso, un id existente y uno inventado dan el mismo `forbidden`. Migración `20261028000500`                          | `17_media` +3; con la función anterior fallan 2 de ellas (rojo comprobado) y con la nueva pasan                       |
| SEC-07 | Baja     | Webhooks de Mercado Pago y Stripe y el hook de correo de Auth leen el cuerpo con un tope real de bytes (`readBodyLimited`): cortan aunque no venga `content-length`                                                              | `src/server/security/body.test.ts` (cuerpo por trozos que se pasa, encabezado que miente, tope exacto, UTF-8 partido) |
| SEC-09 | Baja     | El redactor de logs enmascara nombres de personas (`customer_name`, `recipient_name`…), IP (claves y textos: queda `203.0.x.x`), tokens en URLs (`?t=`, `code`, `state`…) y teléfonos internacionales. `name` a secas no se toca | `redact.test.ts` +2                                                                                                   |
| CSRF   | —        | `/salir` (cerrar sesión) exige el `Origin` del panel, como ya lo hacían importar y exportar                                                                                                                                      | E2E de la ronda completa (salida desde el panel)                                                                      |

## Revisado y ya cubierto

- **SEC-01** (código del panel sin límite propio): corregido el 2026-10-27 (paso 19).
- **SEC-11** (pagos simulados en staging): el adaptador `fake` no existe cuando `APP_ENV=production` (`src/server/payments/registry.ts`), aunque la base lo permitiera. En staging es intencional para la demo.
- **2FA obligatorio:** el personal entra con código por correo o contraseña **y** TOTP (`requireStaffSession`); el comprador no lo necesita.
- **CSP con nonce, HSTS en producción y cabeceras de seguridad:** en `src/proxy.ts` y `src/server/security/headers.ts`.
- **Webhooks:** firma verificada, re-consulta al proveedor e idempotencia (ADR-028, ADR-041).

## Abierto (con motivo)

| ID     | Por qué sigue abierto                                                                                                                                                                                                      | Quién                |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| SEC-02 | Vigencia o revocación del enlace de pedido de invitado: toca un contrato del checkout (GATE0 §16.5, §43). Requiere ADR. Los tokens `?t=` ya no quedan en los logs (SEC-09)                                                 | ADR + propietario    |
| SEC-03 | Protección de contraseñas filtradas: un interruptor en Supabase → Authentication → Sign In / Providers → Email                                                                                                             | Propietario (1 min)  |
| SEC-05 | Límite de tasa en carrito y búsqueda: la capa adecuada es el firewall de Vercel (reglas de rate limit por IP), que no puedo configurar sin acceso. Las funciones del carrito no reciben la IP; cambiarlas toca el checkout | Propietario (Vercel) |
| SEC-06 | La IP se toma del primer `x-forwarded-for`, que Vercel fija. Correcto mientras la app solo se sirva detrás de Vercel; documentado en `request-meta.ts`                                                                     | Aceptado             |
| SEC-12 | CSP sin `report-to` y HSTS sin `preload`: el preload solo tiene sentido con el dominio definitivo                                                                                                                          | Con el dominio       |
| SEC-13 | Separar secretos por propósito: requiere variables nuevas en Vercel y rotar enlaces ya enviados                                                                                                                            | Propietario          |

## Revisión adversarial de esta tanda

- **¿El metatest de guardas se puede engañar?** Sí, con texto: mira que la guarda esté en el cuerpo, no que su resultado se use. Lo segundo lo cubren las pruebas de cada función (aislamiento A→B en pgTAP). Se dejó escrito en el propio test.
- **¿`lock_media` cambia algo para quien sí tiene permiso?** No: con cualquier permiso de medios sigue `not_found` si no existe y el permiso exacto del tipo después. Las 65 pruebas anteriores de `17_media` y las de `96` y `102` siguen en verde.
- **¿El tope de cuerpo rompe webhooks legítimos?** Los mismos topes de antes (256 KB y 64 KB); solo se aplican también al leer. Las integraciones de webhooks siguen en verde.
- **¿El redactor borra datos útiles para depurar?** Se conservan ids, códigos de error, nombres de tiendas, productos y trabajos, y la red de la IP. Se probó que `pedido 1042 de la tienda 7f1c2a` no cambia.
