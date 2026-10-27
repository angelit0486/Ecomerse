# 13 · Hoja de ruta — 2026-10-27

**Cómo leerla:**

- Las fechas son relativas a hoy (día 0 = 2026-10-27).
- Suponen que el propietario resuelve sus pendientes a tiempo. Si no, el bloque que depende de él se recorre.
- Cada hito tiene criterios de aceptación medibles.
- Los IDs remiten a `12-BACKLOG-PRIORIZADO.md`.

## Días 0–30: «sin riesgos para vender» (primera venta real controlada)

| Semana | Hito                                   | Tareas                                                                        | Criterio de aceptación                                                                                                                                                                                    |
| ------ | -------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | Riesgo legal y de plataforma contenido | BL-01, SG-01 (borrador de política), BL-03 (perfil a `pending` en producción) | Ningún producto asociado con THC o vapeadores visible en ninguna tienda (SELECT y lectura web). Política de uso aceptable escrita. Perfil MX en `pending` en producción                                   |
| 1      | CI confiable                           | BL-10, DT-01                                                                  | CI en verde en HEAD; rama protegida con 4 checks; PROGRESS sin bloqueos falsos; README raíz                                                                                                               |
| 1–2    | Cola que sí corre                      | BL-02, CF-04                                                                  | En staging, `system.jobs` muestra `orders.expire` y `payments.reconcile` al menos cada 5 minutos durante 24 h. Prueba E2E «la reserva vence y el stock vuelve» en verde                                   |
| 2      | Hosting y respaldos                    | BL-05, BL-06                                                                  | Vercel Pro y Supabase Pro con PITR activos. Restauración ensayada en un proyecto aparte, con su tiempo medido (RTO) y anotado en el runbook                                                               |
| 2      | Monitoreo                              | BL-07, CF-06                                                                  | Un error forzado llega a Sentry. Una cola detenida durante 10 min produce una alerta en el celular del propietario                                                                                        |
| 2–3    | Pagos reales en modo prueba            | BL-04, CF-01, CF-02, BL-11                                                    | Con credenciales de prueba de MP: pago aprobado, pago rechazado, webhook duplicado, pago tardío, reembolso y contracargo simulado, cada uno con el resultado esperado. `allow_fake = false` en producción |
| 3      | Correos entregados                     | BL-08                                                                         | SPF, DKIM y DMARC en verde (herramienta de verificación). Correo de pedido recibido en Gmail y Outlook fuera de spam. Un solo correo por pedido pagado                                                    |
| 3–4    | Cumplimiento y legal                   | BL-03 (firma), BL-09, BL-12                                                   | Perfil MX `active` con `reviewed_by` = asesor real. Aviso de privacidad enlazado en el checkout. Domicilio y teléfono visibles. Proceso de CFDI escrito                                                   |
| 4      | Catálogo real y fotos                  | CR-01                                                                         | Catálogo real cargado con variantes de imagen. LCP móvil de la ficha ≤ 2.5 s (Lighthouse en producción)                                                                                                   |
| 4      | **Go/No-Go**                           | `14-GO-NO-GO.md`                                                              | Todos los criterios de `14` en verde → primera venta real a un grupo pequeño                                                                                                                              |

## Días 31–60: «vender mejor»

| Hito                    | Tareas                     | Criterio de aceptación                                                                                    |
| ----------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| Envíos con costo real   | CR-03                      | La cotización real aparece en el checkout; la guía se genera desde el panel; el margen por pedido se mide |
| Recuperación y recompra | CR-04, CR-05, CR-12        | Correos de carrito abandonado y de recompra con consentimiento; tasa de recuperación medida               |
| Analítica               | CR-06                      | Embudo vista → carrito → checkout → pago visible en el panel                                              |
| Meses sin intereses     | CR-07                      | Opción visible y probada en el checkout                                                                   |
| Seguridad pendiente     | SG-02, SG-03, SG-06, SG-07 | Metatest de guardas en CI; límites de intentos probados                                                   |
| Operación               | CF-07, CF-08               | 8 runbooks escritos; segundo administrador con acceso probado                                             |

## Días 61–90: «preparar el SaaS»

| Hito                     | Tareas                                                          | Criterio de aceptación                                                                               |
| ------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Decisiones de plataforma | ADR de OAuth de MP por tienda y de cobro de suscripción (CR-08) | ADR aprobado por el propietario                                                                      |
| Moderación               | SG-01 completo                                                  | Cada tienda nueva acepta la política; la lista de bloqueo detiene términos prohibidos (prueba pgTAP) |
| Datos y retención        | CF-05, DT-02                                                    | Anonimización completa probada; índices de FKs calientes aplicados                                   |
| Piloto                   | 2 a 3 comercios regulados invitados (demanda: MER-12)           | Entrevistas registradas; al menos 1 comercio piloto con su propia tienda                             |

## 12 meses (objetivos, no promesas)

| Trimestre        | Objetivo                                   | Indicador                                                                                          |
| ---------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| T1 (meses 1–3)   | PRUVA vendiendo con margen positivo medido | Margen por pedido > 0 durante 4 semanas seguidas; menos de 1 incidente sin detectar                |
| T2 (meses 4–6)   | Recompra y contenido                       | Tasa de recompra a 60 días medida y en mejora; tráfico orgánico creciendo                          |
| T3 (meses 7–9)   | SaaS cobrando a sus primeras tiendas       | Primeras suscripciones pagadas; Mercado Pago por tienda en producción                              |
| T4 (meses 10–12) | Escala y eficiencia                        | Costo de infraestructura por pedido medido frente a los supuestos de `05` y `10`; pruebas de carga |

Las proyecciones de ingresos y costos son supuestos editables en `10-OPORTUNIDADES-Y-ECONOMIA.md`. No son pronósticos.

## KPIs desde el día 1

Para cada uno: qué medir, de dónde sale hoy o qué falta, y una meta inicial que se ajusta con datos reales.

| KPI                     | Definición                                            | Fuente                                         | Meta inicial                             |
| ----------------------- | ----------------------------------------------------- | ---------------------------------------------- | ---------------------------------------- |
| Conversión              | Pedidos pagados ÷ sesiones                            | Falta analítica de embudo (CR-06)              | Medir 4 semanas antes de fijarla         |
| Abandono de checkout    | Checkouts iniciados sin pago ÷ checkouts iniciados    | Tablas `carts` y `orders` (existen)            | Medir; bajar mes a mes                   |
| Pagos fallidos          | Intentos rechazados o vencidos ÷ intentos             | `payments` y `payment_events`                  | Menos de 10 % (revisar con datos reales) |
| Tiempo de entrega       | Pagado → entregado (días)                             | `order_events` con estado entregado            | ≤ lo prometido en la ficha (2–5 días)    |
| Tasa de reembolso       | Reembolsos ÷ pedidos pagados                          | `refunds`                                      | Menos de 3 % (supuesto)                  |
| LCP móvil (p75)         | Largest Contentful Paint en celulares reales          | Vercel Speed Insights o CrUX (falta activarlo) | ≤ 2.5 s                                  |
| Errores por mil pedidos | Errores 5xx o excepciones ÷ pedidos × 1000            | Sentry (BL-07)                                 | Tendencia a la baja                      |
| Margen por pedido       | Precio − costo − comisión − envío − empaque           | `10` (supuestos), luego datos reales           | > 0 en el escenario base                 |
| Salud de la cola        | Antigüedad del job pendiente más viejo y jobs muertos | `system.jobs` (BL-02, BL-07)                   | Menos de 5 min y 0 jobs muertos          |
