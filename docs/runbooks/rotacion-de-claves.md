# Rotación de claves (2026-10-29)

Qué clave hay, dónde vive, cada cuánto se cambia y qué hacer si se filtra. **Nunca** se pegan claves en el chat, en el código ni en un issue: solo en Vercel, Supabase o el proveedor. La revisión de secretos del historial de git corre en cada push (gitleaks en CI). El 2026-10-29, una búsqueda de patrones en los 278 commits del repositorio solo encontró valores de ejemplo (`APP_USR-0000…`, `TEST-1234…`).

## Inventario

| Clave                                                 | Dónde vive                     | Rotación sugerida                  | Efecto de rotarla                                                                                                                                                           |
| ----------------------------------------------------- | ------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contraseña de `postgres` (Supabase)                   | Supabase → Database → Settings | Al salir alguien con acceso; anual | Hay que actualizar `MIGRATION_DATABASE_URL` en Vercel                                                                                                                       |
| Contraseñas de `storefront_gateway` y `system_worker` | Base (rol) + Vercel            | Anual o si se filtran              | Cambiar el rol y la variable al mismo tiempo (`GATEWAY_DATABASE_URL`, `WORKER_DATABASE_URL`); sin downtime si se hace en este orden: nueva contraseña → variable → redeploy |
| `SUPABASE_SERVICE_ROLE_KEY`                           | Supabase → API + Vercel        | Si se filtra (salta RLS: crítica)  | Supabase → Settings → API Keys: crear una clave secreta nueva, ponerla en Vercel, redeploy y revocar la anterior                                                            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                       | Público por diseño             | Junto con la anterior              | `anon` no tiene permisos de tabla (regla 3)                                                                                                                                 |
| `CRON_SECRET`, `JOBS_HMAC_SECRET`                     | Vercel                         | Anual                              | Solo afecta a la ejecución de trabajos; rotar y redeploy                                                                                                                    |
| `PREVIEW_HMAC_SECRET`                                 | Vercel                         | Anual                              | Invalida las vistas previas abiertas (se vuelven a abrir)                                                                                                                   |
| `ORDER_LINK_SECRET`                                   | Vercel                         | Solo si se filtra                  | **Invalida** los enlaces de pedido de invitado y los de baja de recordatorios ya enviados. Avisar antes                                                                     |
| `PAYMENT_CREDENTIALS_KEY`                             | Vercel                         | Solo si se filtra                  | Cifra las llaves de Mercado Pago de cada comercio: rotarla obliga a re-cifrar (pendiente de script) o a que cada comercio reconecte                                         |
| `STRIPE_SECRET_KEY`, `STRIPE_*_WEBHOOK_SECRET`        | Stripe + Vercel                | Anual o si se filtra               | Stripe permite una clave nueva con la vieja vigente unas horas («roll key»)                                                                                                 |
| `MERCADOPAGO_*`                                       | Mercado Pago + Vercel          | Anual o si se filtra               | Regenerar en la aplicación de Mercado Pago                                                                                                                                  |
| `RESEND_API_KEY`                                      | Resend + Vercel                | Anual o si se filtra               | Crear la nueva, cambiar Vercel, redeploy, borrar la vieja                                                                                                                   |
| `SEND_EMAIL_HOOK_SECRET`                              | Supabase Auth Hooks + Vercel   | Anual                              | Regenerar en el hook y actualizar Vercel en el mismo minuto: mientras no coincidan no salen códigos de acceso                                                               |
| `VERCEL_DOMAINS_TOKEN`                                | Vercel → Account → Tokens      | Con caducidad de 1 año             | Solo afecta a los dominios propios                                                                                                                                          |

## Si una clave se filtra

1. **Rotarla primero, investigar después.** Usar el paso de la tabla.
2. Redesplegar en Vercel para que tome el valor nuevo.
3. Revisar la actividad:
   - Supabase → Logs (accesos raros);
   - Consola → Salud (rechazos de firma);
   - el panel del proveedor (cobros o reembolsos no reconocidos).
4. Si el valor llegó a git: rotarlo ya. Reescribir el historial **no** basta, porque un repositorio público pudo haberse copiado.
5. Anotar en `docs/DECISIONS.md` qué pasó, cuándo y qué se rotó.

## Pendiente

- Script para re-cifrar las llaves de Mercado Pago al rotar `PAYMENT_CREDENTIALS_KEY`, para que los comercios no tengan que reconectar.
- El repositorio `angelit0486/Ecomerse` es **público**: cualquiera puede leer el código. No contiene secretos, pero conviene hacerlo privado antes de vender. Si se hace privado, el método manual de migraciones con `pg_net` deja de funcionar y hay que configurar `MIGRATION_DATABASE_URL` en Vercel.
