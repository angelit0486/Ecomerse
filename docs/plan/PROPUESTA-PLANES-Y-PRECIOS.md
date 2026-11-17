# Planes, precio y paso de prueba a pago

**Estado: APROBADO por el propietario el 2026-11-17 — opción B** («Apruebo los precios recomendados: Tienda $699 y Tienda Plus
$1,299 al mes, anual con 2 meses gratis, cuota de arranque y prueba de 14 días sin tarjeta»). Registrado como **ADR-068** en
`docs/DECISIONS.md` (extiende ADR-044). Captura en la consola: `docs/runbooks/precios-aprobados-2026-11.md`.

## 0. Decisión aprobada (2026-11-17)

Cifras en MXN, **más IVA**.

| Plan        | Mensual | Anual (2 meses gratis) | Cuota única de arranque | Prueba               |
| ----------- | ------- | ---------------------- | ----------------------- | -------------------- |
| Tienda      | $699    | $6,990                 | $2,900                  | 14 días, sin tarjeta |
| Tienda Plus | $1,299  | $12,990                | $5,900                  | 14 días, sin tarjeta |

Límites (opción B del análisis de mercado del 2026-11-17): Tienda 1 tienda, 1,000 productos, 3 personas, 1 almacén, 1 dominio
propio, 2 GB de fotos; Tienda Plus 2 tiendas, 10,000 productos, 10 personas, 3 almacenes, sin marca PRUVA, estadísticas
avanzadas, carritos abandonados, roles a la medida, 20 GB. Tabla completa, con los valores que el análisis no fijó marcados como
propuesta, en el runbook §2.

Lo que esto necesitó de código (cuota de arranque, IVA en Stripe, días de prueba del plan al dar de alta) está en la rama
`feat/precios-aprobados`; el resto es configuración. Las secciones 1 a 5 siguientes son la propuesta original, sin cambios,
como historial.

---

_Propuesta original (2026-11-17, antes de la aprobación):_

~~**Estado: PROPUESTO**~~ (superado: APROBADO el 2026-11-17, ver arriba y ADR-068).
Complementa ADR-044 (cobro con Stripe Billing; **pendientes del propietario: precios de cada plan y días de prueba**) y respeta
ADR-045 (alta autoservicio **no aprobada**: la plataforma sigue dando de alta las tiendas). Fecha: 2026-11-17.

## 1. Qué existe hoy (con evidencia en el código)

| Pieza                                                                                                    | Dónde                                                                                       |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Planes con 7 límites (tiendas, productos, presentaciones, equipo, almacenes, dominios, MB) y 6 funciones | `src/lib/billing/entitlements.ts` (`LIMIT_KEYS`, `FEATURE_KEYS`)                            |
| Precio mensual/anual y días de prueba por plan, editables desde la consola (hoy pueden estar vacíos)     | `supabase/migrations/20261029000400_plan_pricing.sql`, `src/app/platform/planes/page.tsx`   |
| Alta de comercio con prueba (14 días por defecto) y sin cobro automático: la plataforma la crea          | `20261006000500_tenancy_rpc.sql` (`p_trial_days default 14`), ADR-045                       |
| Prueba vencida ⇒ solo lectura (la tienda sigue vendiendo; no se pierde nada); gracia de 7 días por pago  | `20261028000100_plans_subscriptions.sql`, aviso en `src/app/admin/[storeHandle]/layout.tsx` |
| Pago con tarjeta (Stripe Checkout), cambio de plan con prorrateo, webhooks firmados                      | `src/app/admin/[storeHandle]/ajustes/plan/page.tsx`, `src/server/billing/stripe-billing.ts` |
| «Plan y uso» con barras de uso en vivo (tiendas, productos, equipo, espacio) y funciones incluidas/no    | `src/ui/billing/plan-usage.tsx`                                                             |
| «Configura tu tienda»: checklist de lanzamiento con bloqueos, plantilla por giro, pago manual, publicar  | `configuracion/page.tsx`, `20261014000400_store_launch.sql`                                 |
| Guía hacia la primera venta                                                                              | `docs/plan/PRIMER-PEDIDO.md`                                                                |

Conclusión de la investigación: **la mecánica de cobro ya está construida; lo que falta para vender es la decisión comercial**
(qué planes, cuánto, cuántos días de prueba) y pequeños puntos de claridad hacia el comerciante.

## 2. Brechas, por valor

1. **Sin precios ni paquetes decididos (bloquea ingresos).** `price_monthly`, `price_annual` y `trial_days` son opcionales y la
   consola avisa de «suscripciones de pago sin precio» (`paying_without_price`). Sin precio, el botón «Pagar con tarjeta» no
   puede ofrecer planes. _Necesita decisión de Angel; ver §3._
2. **El límite se explicaba con un aviso genérico.** «Alcanzaste el límite de tu plan.» no decía cuál ni qué hacer. _Resuelto en
   esta PR sin migración:_ el mensaje ahora nombra el límite y a quién avisar (`src/server/db/errors.ts`). Solo aplica a los
   límites que la base ya reporta con `{key, limit}`; el resto conserva el mensaje anterior.
3. **Prueba → pago.** Hoy el comerciante ve «Tu prueba gratis termina el …» solo en los últimos 7 días y el pago solo aparece
   en «Plan y uso» (visible para la dueña). Propuesta (sin construir): un solo mensaje con precio del plan y un botón «Pagar» al
   inicio de esa franja. _Depende de la brecha 1_ (sin precio no hay qué mostrar).
4. **Empleados sin acceso a «Plan y uso»** ven que tocaron un límite pero no pueden ver el plan: el nuevo mensaje les dice
   que avisen a la dueña.
5. **Alta autoservicio:** fuera de alcance (ADR-045 no aprobado). Mientras tanto la plataforma da de alta y el 1.er pedido se guía con `PRIMER-PEDIDO.md`.

## 3. Opciones de precio y paquetes (todas son PROPUESTAS; sin cifras de mercado)

No se investigaron precios de competidores en esta propuesta, así que **no hay montos sugeridos**: los `$X` los fija Angel.
Principio indicado por Angel: precio premium justificado por calidad; construir solo lo necesario.

- **Opción A — Un plan único («PRUVA») con límites generosos.** Un precio mensual y uno anual. Pro: mensaje simple y premium,
  menos soporte y cero decisiones del comerciante; Contra: no captura a tiendas grandes ni ofrece entrada barata.
- **Opción B — Dos planes (Tienda / Tienda Plus).** Se distinguen por límites ya existentes (productos, equipo, almacenes) y
  funciones ya existentes (dominio propio, sin marca de la plataforma, estadísticas avanzadas, carritos abandonados).
  Pro: ruta natural de ascenso con los límites que el panel ya muestra; Contra: hay que justificar cada diferencia.
- **Opción C — Tres planes.** Lo anterior más un nivel de entrada. Pro: cobertura amplia; Contra: más superficie de soporte y más
  fricción de elección, menos coherente con «premium».

Parámetros a decidir en cualquiera: precio mensual `$X`, precio anual `$Y` (descuento por pago anual: sí/no), **días de prueba**
(la base admite 0–90; hoy el alta usa 14 por omisión) y si la prueba pide tarjeta (hoy no).

### Recomendación de PRUVA (a validar por Angel)

Opción B con límites que ya mide el panel, anual con descuento y prueba **sin tarjeta** (menos fricción para una tienda local; el
paso a solo lectura al vencer protege sus datos y mantiene la venta abierta). Los precios los fija Angel con sus propios datos de
mercado; después se capturan en la consola de plataforma (`platform_set_plan_pricing`), **sin migración ni código nuevo**.

## 4. Siguiente trabajo cuando Angel decida

1. Capturar planes, precios y días de prueba en «Planes» de la consola (acción de Angel/plataforma; toca datos reales).
2. Prueba real en modo de pruebas de Stripe (spike S-4 pendiente en `PLAN-LANZAMIENTO.md`).
3. Mensaje único de prueba→pago con precio (brecha 3), con prueba E2E; sin migración.

## 5. Qué no se hizo

Sin migraciones, cobros reales, cambios en Stripe/Vercel/Supabase remotos ni datos reales. Esta propuesta no modifica `docs/DECISIONS.md`:
si Angel aprueba una opción, se registra allí como ADR nuevo (a numerar por quien lo apruebe; extiende ADR-044).
