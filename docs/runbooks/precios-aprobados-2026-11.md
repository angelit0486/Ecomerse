# Capturar los precios aprobados y empezar a cobrar (ADR-068)

Estado: **PREPARADO, NO APLICADO.** Nada de esto se ha hecho en staging ni en producción. Cada paso que toca datos reales,
Stripe, Vercel o Supabase requiere la autorización expresa del propietario.

Precios aprobados por el propietario el 2026-11-17 (MXN, más IVA): **Tienda** $699/mes o $6,990/año, cuota de arranque
$2,900; **Tienda Plus** $1,299/mes o $12,990/año, cuota de arranque $5,900; prueba de 14 días sin tarjeta.

## 1. Requisitos antes de capturar

1. Migraciones aplicadas hasta `20261117000500_plan_setup_fee.sql` (paquete en `despliegue-migraciones-2026-11.md`, anexo E)
   y el código de esta rama desplegado. Sin la migración, la consola no muestra el campo «Cuota de arranque».
2. Entrar a **Consola** con una cuenta de plataforma (dueña o administración) y verificación en dos pasos.
3. **No editar el plan de las tiendas demo** (`demo_plan`) ni ningún plan que ya usen organizaciones reales: los planes nuevos se
   crean aparte. Las tiendas demo no cambian de plan.

## 2. Crear los dos planes (Consola → Planes → «Nuevo plan»)

| Campo de la consola           | Tienda   | Tienda Plus   | Origen                                                                                                                |
| ----------------------------- | -------- | ------------- | --------------------------------------------------------------------------------------------------------------------- |
| Clave                         | `tienda` | `tienda_plus` | sugerida (minúsculas, sin espacios)                                                                                   |
| Nombre                        | Tienda   | Tienda Plus   | aprobado                                                                                                              |
| Estado                        | Activo   | Activo        | —                                                                                                                     |
| Orden en la lista             | 10       | 20            | —                                                                                                                     |
| Tiendas                       | 1        | 2             | análisis, opción B                                                                                                    |
| Productos                     | 1000     | 10000         | análisis, opción B                                                                                                    |
| Presentaciones por producto   | 100      | 100           | **propuesta** (el análisis no lo fija; 100 es el valor por omisión de la base)                                        |
| Personas del equipo           | 3        | 10            | análisis, opción B                                                                                                    |
| Almacenes                     | 1        | 3             | análisis, opción B                                                                                                    |
| Dominios propios              | 1        | 2             | Tienda: análisis; Plus: **propuesta** (uno por tienda)                                                                |
| Espacio para fotos (MB)       | 2048     | 20480         | análisis (2 GB / 20 GB)                                                                                               |
| Promociones activas           | 5        | 1000          | **decidido 2026-11-25 (ADR-070)**: Tienda hasta 5; Plus sin tope práctico. Sin este valor no se puede activar ninguna |
| Dominio propio (función)      | sí       | sí            | análisis                                                                                                              |
| Sin la marca de la plataforma | no       | sí            | análisis                                                                                                              |
| Estadísticas avanzadas        | no       | sí            | análisis                                                                                                              |
| Carritos abandonados          | no       | sí            | análisis                                                                                                              |
| Roles a la medida             | no       | sí            | análisis                                                                                                              |
| Acceso por API                | no       | no            | **propuesta** (no se vende ni se anuncia hoy)                                                                         |
| Reporte de promociones        | no       | sí            | **decidido 2026-11-25 (ADR-070)**; el reporte llega en la fase 4                                                      |

Guardar cada plan con «Guardar plan».

## 3. Precios (Consola → Planes → «Precios de …»)

| Campo             | Tienda | Tienda Plus |
| ----------------- | ------ | ----------- |
| Precio mensual    | 699    | 1299        |
| Precio anual      | 6990   | 12990       |
| Días de prueba    | 14     | 14          |
| Cuota de arranque | 2900   | 5900        |

Se escriben en pesos (sin IVA); la base los guarda en centavos (69900, 699000, 290000…). Guardar con «Guardar precios».
Cada cambio queda en la auditoría (`plan.pricing_saved`).

**Comprobar** (solo lectura, SQL Editor de Supabase):

```sql
select p.key, p.name, p.status, p.price_monthly, p.price_annual, p.trial_days, p.setup_fee, p.currency
  from public.plans p where p.key in ('tienda', 'tienda_plus') order by p.sort;
-- Esperado: tienda 69900 / 699000 / 14 / 290000 / MXN; tienda_plus 129900 / 1299000 / 14 / 590000 / MXN.
select p.key, e.key, e.value_int, e.value_bool
  from public.plan_entitlements e join public.plans p on p.id = e.plan_id
 where p.key in ('tienda', 'tienda_plus') order by p.key, e.key;
```

## 4. Qué falta para cobrar de verdad, del más sencillo al más difícil

1. **Términos del servicio y página de precios.** Publicar precios «más IVA», qué incluye cada plan, que la cuota de arranque
   es un pago único y no reembolsable (o lo que decida el propietario), la prueba de 14 días sin tarjeta, y qué pasa al vencer
   (solo lectura, la tienda sigue vendiendo). Revisión del abogado [PENDIENTE].
2. **Cuenta Stripe México de PRUVA** (`stripe-billing.md`, pasos 1 a 4): llaves `sk_test_…`/`whsec_…` en Vercel, primero en
   modo de prueba. Sin ellas, «Pagar con tarjeta» no aparece.
3. **IVA en Stripe.** En Stripe → Productos → Tasas de impuesto, crear «IVA 16 %», **no incluido en el precio**, México. Poner su
   id (`txr_…`) en `STRIPE_BILLING_TAX_RATE_ID` en Vercel. Sin esta variable Stripe cobra $699 exactos y PRUVA absorbe el IVA.
   Confirmar con el contador si conviene usar Stripe Tax en lugar de una tasa fija [NO VERIFICADO].
4. **Prueba completa en modo de prueba de Stripe** con una organización que **no sea demo**: pagar con la tarjeta de prueba,
   ver «Activa» en Plan y uso, ver en Stripe la primera factura con la cuota de arranque y el IVA, y la segunda sin cuota.
5. **Facturación CFDI.** PRUVA no emite CFDI todavía y Stripe no los emite en México. Los negocios la pedirán para deducir.
   Hace falta contratar un proveedor de facturación (PAC) y decidir si la factura se emite a mano al principio o se integra.
   Es un ADR nuevo y un gasto: requiere aprobación [BLOQUEANTE para clientes que facturan].
6. **Modo live** (`sk_live_…`, su webhook y su tasa de IVA live) y despliegue a producción: con autorización.

## 5. Qué hace el sistema con estos precios

- **Alta:** la plataforma crea la tienda con el plan elegido; la prueba dura los días del plan (14). No pide tarjeta.
- **Pagar:** la dueña entra a Ajustes → Plan y uso → Pagar con tarjeta, elige mensual o anual y ve el precio «más IVA» y, si
  aplica, «El primer pago incluye la cuota única de arranque de $2,900.00». Stripe cobra plan + cuota (+ IVA) en la primera
  factura; las siguientes solo el plan.
- **Cuota pagada por fuera:** Consola → Organización → «Cuota de arranque» → «Marcar como cobrada por fuera o condonada», con
  motivo. Después, su primer pago con tarjeta ya no la incluye.
- **Ya pagó con tarjeta antes** (por ejemplo canceló y volvió): no se le cobra otra vez.
- **Cambiar de plan** (Tienda → Plus): prorrateo de Stripe; no se cobra diferencia de cuota de arranque.
- **Pago por transferencia:** sigue el cobro manual de la consola («Registrar pago (activar por N días)»; anual = 365 días).
