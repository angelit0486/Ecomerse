# Auditoría de autorización y aislamiento multi-tenant (17-nov-2026)

Estado: **hallazgos confirmados; 2 corregidos en este PR, 3 como seguimiento (requieren migración o decisión de infraestructura)**.

Alcance: todos los route handlers y archivos `"use server"` (excepto `src/server/imports/**`, en PR #20/#21), siguiendo cada ruta hasta las funciones SQL que llama (última migración). Auditoría de solo lectura hecha con Claude Code (opus, effort high); correcciones revisadas y verificadas a mano.

**Resultado principal: no se encontró ningún cruce entre tiendas/organizaciones ni salto de permisos.** Todos los hallazgos son límites de intentos o de carga.

## Corregidos en este PR

| #   | Severidad | Dónde                                                | Arreglo                                                                                                                                               |
| --- | --------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | Baja      | `src/app/api/jobs/run/route.ts`                      | El runner leía el cuerpo completo antes de autenticar. Ahora usa `readBodyLimited` (8 KB; pg_cron envía `{}`) y responde 413 sin llegar a autenticar. |
| 5   | Baja      | `src/app/(acceso)/actions.ts` `startInvitationLogin` | Ahora aplica `takeLoginAttempt` como el resto de los logins (Auth solo limita por la IP del servidor, compartida).                                    |

## Seguimiento (no incluidos: necesitan migración + pgTAP o decisión)

| #   | Severidad | Dónde                                                  | Propuesta                                                                                                                                                                                                                                                                                       |
| --- | --------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Media** | `verifyTotp` en `src/app/(acceso)/actions.ts`          | Sin límite propio de intentos del segundo factor (TOTP). Quien ya tiene el primer factor puede adivinar códigos hasta el límite global de Auth y agotar ese presupuesto para todo el staff. Propuesta: `system.take_staff_mfa_attempt(uid, ip_hash)` con `app.rate_limit_take('staff_mfa:user:' |     | uid, 5, 900)`+ límite por IP; migración, pgTAP y`EXECUTE`a`system_worker`. |
| 3   | Baja      | `src/app/_store/[storeId]/buscar/sugerencias/route.ts` | Sugerencias públicas sin límite ni caché compartida; un cliente puede ocupar el pool de la tienda (3 conexiones). Propuesta: límite por `clientIpHash()` en la función SQL o regla de rate limit en Vercel WAF.                                                                                 |
| 4   | Baja      | `src/app/api/health/ready/route.ts`                    | Readiness público consulta la base en cada hit. Propuesta: cachear el último resultado ~5 s en memoria o exigir `HEALTHCHECK_TOKEN` (dejar `/api/health` público).                                                                                                                              |

Estado de los hallazgos 3 y 4: corregidos sin migración en la rama `fix/sugerencias-salud-limites` (freno por instancia en sugerencias: 30 por IP cada 10 s y una consulta en curso; readiness reutiliza su último resultado 5 s y comparte la consulta en curso). El límite global por IP de las sugerencias sigue siendo una regla del WAF de Vercel, pendiente de aprobación.
**Estado del hallazgo 1:** Corregido en la rama fix/totp-rate-limit (migración 20261117000300, pendiente de aprobación)

## Sospechas descartadas (verificadas)

Reset de MFA con service role (lo aprueba `access_authorize_mfa_reset`), cliente admin de Storage (solo el worker de media, rutas validadas), `storeHandle/storeId/organizationId` del cliente (re-chequeados con `getStoreContext` y `has_store_permission`), parámetro `[storeId]` del storefront (firmado por el proxy), `?ruta=` de vista previa, redirecciones abiertas, OAuth de Mercado Pago, webhooks (HMAC en tiempo constante, ventana ±5 min, cuerpo limitado), autenticación del runner, baja de un clic, pagos falsos (rechazados en producción), fugas en errores y PII en logs (redacción por campo y patrón).
