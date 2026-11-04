# Revisión de seguridad de la misión «mejoras» (2026-11-04)

Alcance: los cambios de `255fa7f..mejoras/2026-11` en `src/` y `supabase/migrations/` (64 archivos). La tienda `demo` quedó fuera.

## Dependencias

- **Producción:** `pnpm audit --prod` → **sin vulnerabilidades conocidas** [VERIFICADO].
- **Desarrollo:** 1 aviso moderado en `minimatch` (ReDoS), dentro de la cadena del lint (`eslint-config-next`). No llega al sitio. Corregirlo exige actualizar `eslint-config-next`, una actualización mayor que la misión no permite sin pedirlo. Queda registrado.

## Superficies nuevas revisadas

| Superficie                                                         | Riesgo buscado                                            | Resultado                                                                                                                                                                              |
| ------------------------------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portada de imágenes: enlaces de cada imagen                        | `javascript:`, `//otro-sitio`, barras codificadas         | Solo rutas de la tienda (`/…`, sin `//`, `%2F` ni `%5C`) o `https://` con dominio válido, validado en Zod y en `app.theme_link_valid`. La tienda vuelve a validar el tema al mostrarlo |
| Portada de imágenes: imágenes                                      | Usar imágenes de otra tienda                              | La base exige banners listos de la misma tienda (pgTAP 122)                                                                                                                            |
| Portada de imágenes: estilos                                       | CSS del comerciante y `style=` (regla 13, CSP)            | Punto focal en un `<style>` con nonce; sin `dangerouslySetInnerHTML`                                                                                                                   |
| Ajustes → Funciones (`store_set_feature`)                          | Encender funciones de pago o de plan, o tocar otra tienda | Lista cerrada (`store_toggle`), permiso `store.update`, solo alcance `store` de esa tienda, auditoría y kill switch de la plataforma (pgTAP 124)                                       |
| Correo «pendiente de pago» (`request_payment_pending_notice`)      | Que alguien lo dispare o lo repita                        | Solo `system_worker`; una vez por cobro (clave única); solo pedido sin pagar y medio diferido (pgTAP 123)                                                                              |
| Webhook de Mercado Pago                                            | Debilitar la firma, los montos o la idempotencia          | Sin cambios en la verificación: el aviso nuevo va después de aplicar el cobro ya re-consultado. La E2E prueba la firma inválida (401) y el monto alterado (no pagado)                  |
| Mantenimiento con la actividad (`processQueueSoon`, `resumeQueue`) | Abuso para cargar la base                                 | Como mucho una vez por minuto por instancia (mantenimiento) y cada 10 s (lista de pedidos, que exige `orders.read`). Las tareas son idempotentes                                       |
| Teléfono normalizado                                               | Saltarse la regla de la base                              | La base conserva su expresión regular; la normalización solo produce valores que la cumplen (prueba unitaria)                                                                          |
| Adaptador de Skydropx                                              | Fuga de llaves o del cuerpo de error                      | Sin uso todavía. El cuerpo de error no sale del adaptador (prueba unitaria)                                                                                                            |
| Mercado Pago simulado (`tests/e2e/fake-mercadopago.ts`)            | Que llegue a producción                                   | Solo vive en `tests/`. `MERCADOPAGO_API_BASE` es solo de pruebas; en producción no se define                                                                                           |

## Pendiente

- **Incidente del 2026-11-03:** la cuenta se desbloqueó por pedido del propietario. Siguen pendientes las rotaciones recomendadas (`PENDIENTES-DEL-PROPIETARIO.md`, A).
