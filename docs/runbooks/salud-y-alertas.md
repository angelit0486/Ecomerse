# Salud de la plataforma y alertas

Misión vendible F1.6. Qué se revisa, quién recibe los avisos y qué hacer con cada uno.

## Dónde se ve

- **Consola → Salud** (`/platform/salud`): dueño, administración y soporte de la plataforma. Las tiendas no la ven.
- Solo muestra **conteos**: nunca el contenido de los trabajos, correos de compradores ni datos de pedidos.

## Cómo funciona

1. El mantenimiento encola `platform.health_check` cada 15 minutos.
2. El trabajo lee `system.platform_health()` (migración `20261028000400`).
3. Si hay problemas, manda **un correo por problema y destinatario, una vez por hora** mientras siga.
4. Destinatarios: personal de la plataforma **activo** con rol dueño o administración. Soporte no recibe correos.
5. Los correos salen por el mismo canal que los de pedidos (Resend). Sin `RESEND_API_KEY` no sale ninguno [NO VERIFICADO con Resend real].

## Problemas y qué hacer

| Código              | Gravedad | Cuándo aparece                                                       | Qué hacer                                                                                                          |
| ------------------- | -------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `queue_stalled`     | Urgente  | Un trabajo listo lleva más de 10 min sin tomarse                     | Revisa en Vercel que el cron de trabajos corra (`CRON_SECRET`) y que la base responda.                             |
| `jobs_stuck`        | Urgente  | Un trabajo lleva más de 15 min «en curso»                            | Suele ser un despliegue cortado; se libera solo. Si sigue, revisa los logs de Vercel.                              |
| `payment_events`    | Urgente  | Avisos de pago con error en las últimas 24 h                         | Revisa los pedidos en atención; la reconciliación reintenta cada 10 min.                                           |
| `jobs_dead`         | Aviso    | Trabajos que agotaron sus intentos en 24 h                           | Consola → Trabajos: corrige la causa (p. ej., llave de Resend) y toca «Reintentar».                                |
| `webhook_rejected`  | Aviso    | 5 o más avisos de pago rechazados por firma en 24 h                  | Comprueba que la clave secreta del webhook en Vercel sea la del panel de Mercado Pago. Puede ser alguien probando. |
| `payment_reversals` | Aviso    | Contracargos o reembolsos hechos en el panel de Mercado Pago en 24 h | Los pedidos quedaron en atención y la tienda recibió aviso; revisa el caso en Mercado Pago.                        |
| `payments_stale`    | Aviso    | Pagos abiertos más de 2 h                                            | Normal si el comprador no terminó; si son muchos, revisa que lleguen los webhooks.                                 |

### `audit_partitions` (desde 20261105000100)

- **Aviso:** quedan menos de 3 meses de particiones de auditoría. El mantenimiento las crea solo cada mes (siempre 24 meses por delante). Si aparece, la cola no está corriendo: revisa `queue_stalled`.
- **Urgente:** hay registros en `audit.audit_logs_default`, es decir, con fecha sin partición. Mientras estén ahí, crear la partición de ese mes falla. Desde una conexión de dueño del esquema:
  1. Crea la partición que falta como tabla suelta: `create table audit.audit_logs_AAAAMM (like audit.audit_logs including all)`.
  2. Mueve las filas: `insert into audit.audit_logs_AAAAMM select * from audit.audit_logs_default where occurred_at >= … and occurred_at < …`. El borrado de `default` necesita desactivar por un momento el trigger que impide borrar la auditoría; deja constancia en un ADR.
  3. Adjúntala: `alter table audit.audit_logs attach partition audit.audit_logs_AAAAMM for values from (…) to (…)`.
  4. Aplica RLS forzado y quita los grants, igual que `audit.ensure_partitions`.

Los umbrales viven en la migración; cambiarlos requiere una migración nueva.

## Probarlo en local

```bash
pnpm exec vitest run src/server/platform            # unitarias
pnpm db:test                                        # pgTAP 105 e integración platform-health
pnpm exec playwright test tests/e2e/platform.spec.ts  # Consola → Salud con axe
```

## Lo que falta (depende del propietario)

- Configurar Resend y el dominio de envío para que los avisos lleguen de verdad.
- Opcional: Sentry para errores de la app (necesita un DSN).
