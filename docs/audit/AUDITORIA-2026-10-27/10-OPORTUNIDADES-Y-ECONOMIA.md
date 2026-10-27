# 10 · Oportunidades, dependencia de terceros y unit economics

Auditoría 2026-10-27 · Área: oportunidades (OPO-), dependencias (DEP-) y economía por unidad.
Solo lectura: no se cambió código, datos ni configuración.

> **Advertencia.** Todas las proyecciones de este documento son **supuestos editables, no hechos**.
> PRUVA tiene 0 pedidos reales (staging, SELECT del 2026-10-27), así que no hay datos propios de ticket, conversión ni costo de envío.
> Los precios de terceros tienen fuente, URL y fecha de consulta (2026-10-27). Cambian seguido: confírmalos antes de decidir.
> Lo legal es orientación informativa: valídalo con un abogado o asesor regulatorio.

**Términos usados**

- **Unit economics** (economía por unidad): lo que gana o pierde el negocio en cada pedido o en cada tienda.
- **Margen de contribución:** lo que queda del pedido después de los costos variables (producto, pasarela, envío y empaque). Todavía no descuenta costos fijos ni la publicidad.
- **AUP** (Acceptable Use Policy): la política de uso aceptable de un proveedor. Si la violas, el proveedor puede suspender la cuenta.
- **PAC:** proveedor autorizado por el SAT para timbrar CFDI.
- **BSP:** proveedor que da acceso a la API de WhatsApp Business.

---

## 0. Supuestos editables

Cambia los valores de esta tabla y vuelve a aplicar las fórmulas de la §3. Etiquetas:

- **[Fuente]**: precio público con su referencia en la §5.
- **[Supuesto]**: valor del analista, sin fuente; reemplázalo por un dato real.

### 0.1 Generales

| # | Supuesto | Conservador | Base | Optimista | Tipo |
|---|---|---|---|---|---|
| G1 | Tipo de cambio USD→MXN | 18.5 | 18.5 | 18.5 | [Supuesto]: usa el FIX de Banxico del día |
| G2 | IVA sobre comisiones | 16 % | 16 % | 16 % | [Fuente F1] (las comisiones de MP son «+IVA») |
| G3 | Comisión MP, tarjeta o saldo, dinero al instante | 3.49 % + $4.00 | 3.49 % + $4.00 | 3.49 % + $4.00 | [Fuente F1/F2] |
| G4 | Correos transaccionales por pedido | 4 | 4 | 4 | [Supuesto]: confirmación, pago, envío y entrega |
| G5 | Costo por correo (Resend Pro: USD 20 por 50,000) | USD 0.0004 | USD 0.0004 | USD 0.0004 | [Fuente F5] |
| G6 | Infraestructura fija al mes: Supabase Pro + PITR 7 días + Vercel Pro (1 asiento) + Resend Pro | USD 165 | USD 165 | USD 165 | [Fuente F4, F6, F5] (25 + 100 + 20 + 20) |

### 0.2 Tienda PRUVA

| # | Supuesto | Conservador | Base | Optimista | Tipo |
|---|---|---|---|---|---|
| P1 | Ticket promedio, neto | $600 | $900 | $1,200 | [Supuesto] |
| P2 | Margen bruto del producto (% del ticket) | 30 % | 40 % | 50 % | [Supuesto]: depende del costo del proveedor |
| P3 | Pedidos al mes | 30 | 150 | 500 | [Supuesto] |
| P4 | Costo de la guía (1 kg, nacional, económico) | $160 | $120 | $90 | [Fuente F8], rango de $75 a $204 del 2026-10-16 |
| P5 | Parte del envío que absorbe la tienda | 100 % | 60 % | 40 % | [Supuesto]: depende del umbral de envío gratis |
| P6 | Empaque por pedido | $25 | $20 | $15 | [Supuesto]: sin cotización |

### 0.3 SaaS

| # | Supuesto | Conservador | Base | Optimista | Tipo |
|---|---|---|---|---|---|
| S1 | Precio por tienda al mes, neto | $299 | $499 | $799 | [Supuesto]: el repo no tiene precios (la tabla `plans` existe sin datos de precio) |
| S2 | Tiendas de pago | 5 | 25 | 100 | [Supuesto] |
| S3 | Infraestructura al mes | USD 165 (Micro) | USD 170 (Small: +USD 5) | USD 280 (Medium USD 60 + Vercel por uso USD 50 + Resend USD 35) | [Fuente F4–F6] + [Supuesto] para el uso variable |
| S4 | Horas de soporte por tienda al mes | 1.0 | 0.75 | 0.5 | [Supuesto] |
| S5 | Costo de la hora de soporte | $200 | $200 | $200 | [Supuesto] |
| S6 | Cobro de la suscripción con Stripe, tarjeta nacional | 3.6 % + $3 + IVA | igual | igual | [Fuente F3] |

---

## 1. Dependencia de terceros (DEP-)

### Resumen

| ID | Riesgo | Proveedor | Qué tan aislado está en el código | Costo de cambiar (estimado) |
|---|---|---|---|---|
| DEP-01 | **Alto** | Todos (MP, Stripe, Vercel, Supabase) | No aplica: es un riesgo de contenido y de cuenta | Bajo en código; alto si llega la suspensión |
| DEP-02 | **Alto** | Mercado Pago | Alto: interfaz `PaymentProvider` (GATE0 §18.2) | 2–3 semanas por adaptador nuevo |
| DEP-03 | Medio | Vercel | Medio: `DomainProvider` aislado; cron en `vercel.json` | 1–3 semanas |
| DEP-04 | Medio | Supabase | Bajo en Auth y Storage; alto en Postgres (portable) | 4–8 semanas |
| DEP-05 | Medio | Resend | Alto: `EmailChannel`, HTTP sin SDK | 1–3 días |
| DEP-06 | Bajo | Paqueterías | Sin integración (todo manual) | No aplica hoy |
| DEP-07 | Bajo | WhatsApp (si se adopta) | No existe la integración | No aplica hoy |

---

### DEP-01 · Riesgo Alto · Productos con nombres comúnmente asociados con THC o vapeadores en una tienda pública de staging: riesgo de suspender las cuentas de toda la plataforma

**Etiqueta.** Datos de staging: [VERIFICADO por el orquestador hoy]. Políticas de Stripe, Vercel y Supabase: [VERIFICADO], leídas en las páginas oficiales. Página oficial de Mercado Pago: [NO VERIFICADO], porque no cargó (ver la evidencia). Naturaleza real de los productos: [INFERIDO].

**Evidencia**

1. **Lo que hay en staging.**
   - La tienda «demo» de staging, pública en `pruva-tienda-demo.vercel.app` y en 3 alias `vercel.app`, muestra 19 productos.
   - Sus nombres se asocian comúnmente con concentrados o vapeadores de THC: categorías «Plumas» y «preroll», y marcas como Muha Meds, ELFTHC, Melt y Fryd. Cuestan de $1,399 a $1,650 MXN.
   - No se afirma qué contienen en realidad.
2. **Stripe.**
   - Fuente: «Prohibited and Restricted Businesses», https://stripe.com/legal/restricted-businesses (actualizada el 2026-09-22; consultada el 2026-10-27).
   - Prohibido: «Cannabis products; Cannabis dispensaries and related businesses; CBD products with THC levels greater than the applicable local jurisdiction's legal limit». También: «Pseudo-pharmaceuticals or nutraceuticals that are not safe or make harmful claims».
   - Restringido: «Tobacco products, including e-cigarettes… and e-liquid sold in accordance with applicable law».
3. **Vercel, AUP.**
   - Fuente: https://vercel.com/legal/acceptable-use-policy (actualizada el 2026-04-21).
   - Prohíbe la «Sale, promotion or facilitation of illegal goods and services». Ante una violación, Vercel puede «restrict, suspend, or terminate your access to Services immediately upon notice».
4. **Vercel, plan Hobby.**
   - Fuente: Terms of Service §4, https://vercel.com/legal/terms (2026-10-19).
   - Vercel puede «shut down and terminate projects or deployments using the Hobby plan without notice for any reason or no reason».
   - Staging corre en Hobby (`docs/DECISIONS.md` D-F9-17).
5. **Supabase, AUP.**
   - Fuente: https://supabase.com/aup (versión 1, 2026-06-01).
   - §1.2 prohíbe «Any activity that violates applicable laws or regulations». Una violación «may result in the immediate suspension or termination of your Accounts».
6. **Mercado Pago.**
   - La página oficial «Estupefacientes y sustancias prohibidas» (https://www.mercadopago.com.mx/ayuda/Estupefacientes-y-sustancias-p_1033) y la de «Actividades Prohibidas» (https://www.mercadopago.com.mx/ayuda/actividades-prohibidas-politicas_18572) **no cargaron su contenido** en la consulta del 2026-10-27.
   - Fuente secundaria: El Planteo, 2025-06-12, https://elplanteo.com/mercado-pago-productos-prohibidos-cannabis/. Según ella, la política incluye «cannabis y derivados… cáñamo o CBD en cualquier forma» y medidas como el bloqueo de la cuenta y la cancelación definitiva, sin poder volver a registrarse.
   - Los términos para desarrolladores de MP (https://www.mercadopago.com.mx/developers/es/docs/resources/legal/terms-and-conditions, §7.2 G e I-iii) prohíben crear una aplicación que «pueda ser utilizada para violar… cualquier ley aplicable».
7. **Ley mexicana.**
   - Reforma a los artículos 4o. y 5o. de la Constitución, publicada en el DOF el 17-ene-2025 (https://www.diariooficial.gob.mx/nota_detalle.php?codigo=5747305&fecha=17%2F01%2F2025).
   - El artículo 5o. dice: «Queda prohibida la profesión, industria, comercio interior o exterior… relacionada con» cigarrillos electrónicos, vapeadores y dispositivos análogos.
   - Esto es orientación informativa: valídalo con un abogado.
8. **Radio de impacto en el código.**
   - Todas las tiendas comparten un proyecto de Vercel, un proyecto de Supabase y **una sola credencial de Mercado Pago de la plataforma** (ADR-028 punto 1: `MERCADOPAGO_ACCESS_TOKEN` en el entorno).
   - Si suspenden cualquiera de esas cuentas, se caen PRUVA (suplementos) y cualquier tienda futura del SaaS.
9. **Controles existentes.**
   - La consola de plataforma puede suspender organizaciones (`src/app/platform/actions.ts:133`).
   - El módulo de cumplimiento tiene «términos prohibidos» configurables (`src/app/platform/cumplimiento/page.tsx:39`), pensados para frases de salud en suplementos.
   - **No hay** una política de categorías prohibidas para comerciantes ni una revisión de catálogo al dar de alta una tienda.

**Impacto.**

- Que suspendan la cuenta de Vercel, Supabase o Mercado Pago de la plataforma completa, con retención de fondos en MP.
- Daño a la reputación ante MP justo cuando el propietario va a solicitar sus credenciales reales.
- Posible responsabilidad legal por promover productos cuyo comercio prohíbe la Constitución, si el contenido fuera el que sugieren los nombres.

**Recomendación** (tareas propuestas; no se implementaron):

1. **Hoy, decisión del propietario:** despublicar o archivar esos 19 productos en staging y reemplazarlos por catálogo de demostración neutral.
2. Agregar a los Términos para comerciantes una lista de categorías prohibidas. Debe ser la unión de las listas de MP, Stripe, Vercel y Supabase más la ley mexicana.
3. Extender los «términos prohibidos» de la plataforma al nivel de catálogo (alta, importación por CSV y edición). Que bloqueen la publicación y avisen a la consola de plataforma.
4. Revisar manualmente cada tienda nueva antes de activar cobros reales (KYC ligero: verificar la identidad y el giro del comerciante).
5. A mediano plazo: una credencial de MP por tienda (OAuth, ver DEP-02), para que el riesgo de un comerciante no contamine al resto.

---

### DEP-02 · Riesgo Alto · Concentración en Mercado Pago: una sola credencial de plataforma, retención de fondos y riesgo por categoría de suplementos

**Etiqueta.** Código: [VERIFICADO]. Comportamiento real de MP: [NO VERIFICADO] (sin credenciales).

**Evidencia**

- **Una sola cuenta.** ADR-028 punto 1 y la «Limitación conocida»: «con una sola credencial de plataforma solo **una** tienda puede conectar Mercado Pago. Para más tiendas hace falta OAuth (marketplace)». El código está en `src/server/payments/registry.ts:27-35`.
- **Plazo de liberación.** Mercado Pago dice: «El dinero de algunas ventas se recibe en 7 días cuando los vendedores acaban de registrarse» (Link de pago, https://www.mercadopago.com.mx/herramientas-para-vender/link-de-pago, consultado el 2026-10-27).
- **Revisión manual.** El blog de MP (https://www.mercadopago.com.mx/blog/checkout-pro-mercado-pago, 2026-09-03) dice: «la acreditación puede demorarse más si Mercado Pago decide aplicar revisión manual por riesgo».
- **Categoría.** Los suplementos con frases de salud son una categoría vigilada: Stripe prohíbe los «nutraceuticals that… make harmful claims» (F3b). Para MP no se pudo leer la página oficial (DEP-01).
- **Aislamiento en el código.** El aislamiento es bueno:
  - `PaymentProvider` (`src/server/payments/provider.ts`, contrato crítico §43).
  - Adaptadores `stripe.ts` (392 líneas, Connect, ya implementado; ADR-024 OXXO/MSI), `mercadopago.ts` (381) + `mercadopago-webhook.ts` (145) y la función `system.apply_mercadopago_payment`.
  - Un adaptador nuevo (Openpay, Conekta o Clip) cuesta más o menos lo mismo que MP: adaptador, webhook, función `system.apply_*_payment`, pgTAP e integración. Estimado: **2–3 semanas**. Requiere un ADR, porque agrega un valor a `PaymentProviderKey`, que es contrato crítico.

**Señales tempranas.**

- Pagos que se quedan en `in_process` o «en revisión».
- Liberación a 7 días que no baja a «al instante».
- MP pide documentos.
- Aumento de rechazos, contracargos o reclamos.
- Correo de «actividad restringida».

**Alternativas.**

- **Stripe:** ya está implementado. Cuesta 3.6 % + $3 + IVA con tarjeta y 4 % + $3 con OXXO (F3).
- **Openpay, Conekta y Clip:** no se consultaron sus precios: [NO VERIFICADO].

**Recomendación.**

1. Tener Stripe activado y probado como segunda pasarela antes del lanzamiento. Así un bloqueo de MP no detiene las ventas: solo se cambia el método de pago disponible en el checkout.
2. Antes de la segunda tienda del SaaS: implementar OAuth de MP marketplace (ADR nuevo).
3. Documentar en un runbook qué hacer si MP retiene fondos.

---

### DEP-03 · Riesgo Medio · Vercel: Hobby prohíbe el uso comercial; producción requiere Pro; acoplamientos en dominios y cron

**Etiqueta.** Repo: [VERIFICADO]. Plan real de producción: [NO VERIFICADO] (403 en el conector).

**Evidencia**

- Fair Use Guidelines (https://vercel.com/docs/limits/fair-use-guidelines, 2026-09-14): «Hobby teams are restricted to non-commercial personal use only». Cuenta como comercial «Any method of requesting or processing payment from visitors of the site».
- `vercel.json` programa el cron una vez al día (`0 12 * * *`) por la limitación de Hobby (`docs/runbooks/database-roles.md:93`, nota N-4).
- Los dominios propios pasan por la interfaz `DomainProvider` (`src/server/domains/provider.ts`, 89 líneas). Hoy la implementa Vercel (`api.vercel.com`).

**Impacto.** Si hay cobros reales en un proyecto Hobby, se violan los términos y Vercel puede apagarlo sin aviso.

**Alternativas.** Netlify, Cloudflare (con OpenNext), Railway, Fly o un contenedor propio. Next.js 16 con `proxy.ts` y Server Actions es portable, pero la caché y el ISR (regenerar páginas en segundo plano) cambian según el hosting. Hay que reimplementar `DomainProvider` (dominio + TLS) y el cron (`pg_cron` ya existe como respaldo). Estimado: **1–3 semanas**.

**Señales tempranas.** Avisos de uso fuera de rango, proyecto pausado o facturas por uso que crecen.

**Recomendación.** Pasar el proyecto que tendrá cobros reales a **Pro** (USD 20 por asiento al mes, F6) antes del primer cobro real. Confirmarlo cuando haya acceso al equipo.

---

### DEP-04 · Riesgo Medio · Supabase: núcleo de datos, Auth y Storage; staging en el plan gratuito

**Etiqueta.** [VERIFICADO] en repo y precios.

**Evidencia**

- El plan gratuito pausa el proyecto tras 1 semana sin actividad y no tiene respaldos automáticos (https://supabase.com/pricing, consultado el 2026-10-27).
- Staging está en el plan gratuito (D-F9-17).
- Con Pro hay respaldos diarios de 7 días. PITR (recuperar la base a un punto exacto en el tiempo) cuesta USD 100 al mes por 7 días de retención.
- **Acoplamiento.**
  - El esquema, RLS, roles y funciones son **Postgres estándar**: portables a Neon o RDS.
  - `service_role` solo vive en `src/server/privileged/` (2 archivos, 95 líneas).
  - `supabase-js` y `@supabase/ssr` aparecen en 10 archivos de `src`.
  - Auth (GoTrue, con códigos por email y contraseña) y Storage (rutas `{store_id}/…`, contrato §43) son lo caro de reemplazar.

**Alternativas y costo.**

- Neon o RDS para la base: 1–2 semanas, migrando `pg_cron` y `pg_net`.
- Auth y Storage: 3–6 semanas (S3 o R2, y otro proveedor de Auth).
- Total: **4–8 semanas**.

**Señales tempranas.** Proyecto pausado, conexiones agotadas en Micro (60 directas y 200 por pooler), disco cerca de 8 GB o caídas del Auth hospedado.

**Recomendación.** Producción en Pro con PITR antes del primer cliente de pago, como ya fija GATE0 (§ riesgos, línea 1993). No migrar de proveedor: el riesgo es aceptable con el plan correcto.

---

### DEP-05 · Riesgo Medio · Resend: barato y fácil de cambiar, pero el acceso al panel y los avisos de pedido dependen de él

**Etiqueta.** [VERIFICADO] en código y precios.

**Evidencia**

- `src/server/notifications/channel.ts` elige entre `resend`, `mailpit` y `fake`.
- `channels.ts` (92 líneas) llama a `https://api.resend.com/emails` sin SDK.
- También existe `auth-hook.ts`: los correos de Auth pasan por el mismo canal.
- El plan gratuito de Resend permite 100 correos al día. Pro cuesta USD 20 al mes por 50,000, con USD 0.90 por cada 1,000 adicionales (F5).

**Impacto.**

- Si cae Resend o la reputación del dominio, no llegan los códigos de acceso. Lo mitiga la contraseña de ADR-031.
- Tampoco llegan las confirmaciones de pedido.

**Alternativas.** Postmark, Amazon SES o Brevo, con otro `EmailChannel` (precios [NO VERIFICADO]). Estimado: **1–3 días**, más configurar SPF, DKIM y DMARC (registros DNS que autentican al remitente).

**Señales tempranas.** Rebotes mayores al 2 %, quejas de spam o correos de Auth en la carpeta de spam. Estos umbrales son [Supuesto] del analista.

**Recomendación.** Usar Resend Pro desde el lanzamiento; con el gratuito, 100 correos al día no alcanzan para campañas. Usar un subdominio de envío separado y monitorear los webhooks de rebote.

---

### DEP-06 · Riesgo Bajo · Paqueterías: sin integración; el riesgo es de costo y de operación

**Etiqueta.** Repo: [VERIFICADO]. Precios: fuentes secundarias.

**Evidencia**

- `shipping_rates` solo tiene tarifas fijas, por peso, con envío gratis desde un monto o recolección (`supabase/migrations/20261013000100_checkout_tables.sql:61-86`).
- El despacho al proveedor es manual (ADR-025, `SupplierProvider` con adaptador `manual`).
- `supplier_orders` guarda `tracking_number` y `tracking_url`.
- Cubbo (https://www.cubbo.com/posts/precios-skydropx, 2026-04-28) reporta que los cargos por auditoría de peso hacen variar el costo medio por guía «15-30%».
- Skydropx cobra una «tarifa de gestión» del 2.5 % del envío, que se evita con un plan de $199 MXN + IVA al mes (https://help.skydropx.com/subcategorias-cda/api, consultado el 2026-10-27).

**Impacto.** Con tarifas fijas mal calibradas, la tienda absorbe la diferencia (ver la §3: el escenario conservador pierde dinero por pedido, sobre todo por el envío).

**Recomendación.** Ver OPO-01.

---

### DEP-07 · Riesgo Bajo · WhatsApp Business Platform: precios cambiantes

**Etiqueta.** [VERIFICADO] con fuente secundaria que cita la tabla oficial de Meta.

**Evidencia**

- Desde el 2026-10-01, en México cuestan MXN 0.7298 por mensaje de marketing y MXN 0.1565 por plantilla de utilidad o autenticación.
- Las plantillas de utilidad dentro de la ventana de 24 h, antes gratis, ahora se cobran. Los mensajes de servicio arriba de 1,000 al mes por número también.
- Fuente: goeva.ai, que cita las tablas de Meta descargadas el 2026-09-17 (https://www.goeva.ai/en/resources/whatsapp-business-api-pricing-mexico, 2026-09-18). PDF de la tabla en MXN: https://www.fiscoclic.mx/asistencia/meta-precios-whatsapp-mxn-2026-10-01.pdf.
- La página oficial de Meta (https://developers.facebook.com/docs/whatsapp/pricing) no se leyó directamente: [NO VERIFICADO].

**Recomendación.** Si se adopta (OPO-03): usar solo plantillas de utilidad para el estado del pedido, presupuestar por mensaje y poner un tope mensual por tienda.

---

## 2. Oportunidades (OPO-)

### 2.1 Tabla de prioridad: impacto contra esfuerzo

Las ★ marcan las **5 mejores**. El orden combina tres cosas: que destrabe ingresos, lo que ya existe en el repo y el riesgo.

| ID | Oportunidad | Impacto | Esfuerzo (semanas) | Prioridad | ¿ADR? | Ya existe en el repo |
|---|---|---|---|---|---|---|
| ★ OPO-14 | Cobro de la suscripción SaaS y OAuth de MP por tienda | Muy alto: sin esto el SaaS no cobra ni admite una 2.ª tienda con MP | 3–5 | **Alta** | Sí | `plans`, `plan_entitlements`, `subscriptions`, overrides (GATE0 §19); `AccessMode` |
| ★ OPO-01 | Envíos con cotización en vivo y guías (Skydropx o Envía) | Alto: costo por pedido y conversión | 3–5 | **Alta** | Sí (cálculo del checkout, §43) | `shipping_rates`, peso de envío en el catálogo, `supplier_orders.tracking_*`, cola de jobs, patrón de adaptador |
| ★ OPO-04 | Recuperación de carritos abandonados | Alto | 2–3 | **Alta** | Sí (datos de contacto y consentimiento) | Entitlement `abandoned_cart` (GATE0 §19.2); `carts.status='abandoned'`; job de expiración; `marketing_consent` |
| ★ OPO-05a | Recordatorio de recompra por porciones | Alto en suplementos | 1–2 | **Alta** | Probable (job y plantilla nuevos; sin tablas, quizá no) | ADR-026 porciones por variante; plantillas de pedido; jobs |
| ★ OPO-12 | Analítica de conversión propia (embudo) | Alto: sin medir no se priorizan las demás | 2–3 | **Alta** | Sí si agrega una tabla de eventos | Entitlement `advanced_analytics`; `request_id`; inicio del panel |
| OPO-03 | WhatsApp con estado del pedido | Medio-alto | 2–3 | Media | Sí (canal nuevo, consentimiento, teléfono = PII) | Abstracción `EmailChannel`; plantillas de pedido; WhatsApp solo como enlace de contacto |
| OPO-02 | CFDI automático | Medio: lo piden los clientes con RFC | 3–4 | Media | Sí (datos fiscales = PII, tablas nuevas) | Nada específico; jobs y patrón de adaptador |
| OPO-07 | Reseñas: recordatorio por correo y fotos | Medio | 1 (recordatorio) | Media | No (está fuera del alcance v1 de ADR-029, que ya lo anticipa) | ADR-029 completo: verificadas y moderadas |
| OPO-11 | Más plantillas por giro | Medio para la venta del SaaS | 0.5–1 por giro | Media | No (ADR-034 lo cubre) | 6 plantillas: suplementos, ropa, belleza, abarrotes, genérica, blanco (`src/lib/templates/store-templates.ts:519`) |
| OPO-13 | SEO de contenido (guías y blog) | Medio a largo plazo | 2–3 | Media | Probable (tipo de contenido nuevo) | Páginas por bloques (ADR-034); Lighthouse SEO 100; JSON-LD |
| OPO-10 | Segunda tienda con inventario sincronizado | Medio | 3–5 | Media | Sí (inventario §43; ADR-038 está propuesto) | ADR-025: el proveedor es una ubicación de inventario con `supplier_sync` |
| OPO-05b | Suscripción con cobro recurrente | Alto, pero caro | 6–10 | Baja (por ahora) | Sí (pagos y pedidos §43) | Nada de cobro recurrente |
| OPO-06 | Programa de lealtad | Medio | 4–6 | Baja | Sí (afecta descuentos y totales) | Motor de descuentos D-F6-02 |
| OPO-08 | Afiliados | Bajo-medio | 4–6 | Baja | Sí | Nada |
| OPO-09 | Marketplace de marcas | Incierto | 10+ | Baja | Sí (cambia el modelo de tenencia y los pagos divididos) | Nada |

### 2.2 Detalle por oportunidad

En los ingresos potenciales, las letras son supuestos con nombre que debes llenar. Nada se presenta como resultado esperado.

#### OPO-14 · Prioridad Alta · Cobro de la suscripción SaaS y OAuth de Mercado Pago por tienda

- **Qué es.**
  - Cobrar el plan de cada organización: Stripe Billing o una suscripción de MP; precio [NO VERIFICADO] por proveedor.
  - Que cada tienda conecte **su propia** cuenta de MP por OAuth.
- **Ingreso potencial.** MRR (ingreso mensual recurrente) = S1 × S2. En la §3.2 da de $1,495 a $79,900 MXN al mes según el escenario.
- **Costo.** Comisión por cobro (S6). Desarrollo de 3–5 semanas.
- **Riesgo.** Errores de facturación (cobro doble). Estado de `AccessMode` al no pagar.
- **Dependencias.** Registrar la aplicación de marketplace en MP. Términos del SaaS.
- **ADR.** Sí: toca Subscription/AccessMode y PaymentProvider (§43).
- **Lo que acelera.** El modelo de datos de §19 ya existe, con límites aplicados en la base de datos.

#### OPO-01 · Prioridad Alta · Envíos con cotización y guías

- **Qué es.**
  - En el checkout, cotizar con una API multipaquetería y guardar la tarifa cotizada en la base. El cliente nunca es autoridad del precio (regla 8).
  - Después del pago, un job genera la guía y guarda el rastreo.
- **Precios y API públicos.**
  - Skydropx tiene API documentada (https://pro.skydropx.com/es-MX/api-docs): `POST /api/v1/quotations`, `POST /api/v1/shipments`, tarifas válidas 24 h, 2 solicitudes por segundo y webhooks. Cobra 2.5 % de tarifa de gestión o un plan de $199 + IVA al mes.
  - Envía.com dice cotizar con «100+ paqueterías» (https://envia.com/es-MX/costos-de-paqueteria). Su precio no se consultó: [NO VERIFICADO].
- **Ingreso o ahorro potencial.** Ahorro mensual = P3 × (P4 actual − P4 cotizado) × P5. Ejemplo con el escenario base: si la cotización baja la guía de $120 a $90, ahorra 150 × 30 × 0.6 = **$2,700 al mes**. Es un supuesto, no una medición.
- **Ingreso para el SaaS (opcional).** Margen por guía M × guías al mes; M es [Supuesto].
- **Costo.** 3–5 semanas, más la tarifa del agregador.
- **Riesgo.**
  - La llamada de red en el checkout tiene que ir **fuera** de la transacción de `place_order` (regla 10).
  - Cotizaciones vencidas.
  - Cargos por auditoría de peso (DEP-06).
- **ADR.** Sí: cambia cómo se calcula el envío en `app.calculate_cart` y el contrato de Checkout (§43).
- **Lo que acelera.** Peso de envío en el catálogo (D-SP-07), `supplier_orders.tracking_*`, cola de jobs y patrón de adaptador (`SupplierProvider`, `DomainProvider`).

#### OPO-04 · Prioridad Alta · Recuperación de carritos

- **Qué es.** Si el comprador dejó su correo y dio consentimiento, enviarle 1 o 2 recordatorios con un enlace de regreso a su carrito.
- **Ingreso potencial.** Ventas recuperadas al mes = A (carritos abandonados con correo al mes) × r (tasa de recuperación) × P1. Margen = eso × P2. A y r son [Supuesto], a medir con OPO-12. No se citan benchmarks de la industria porque no se verificaron.
- **Costo.** Correo despreciable (G5). 2–3 semanas.
- **Riesgo.** Consentimiento LFPDPPP (ley mexicana de protección de datos personales en posesión de particulares); que no se perciba como spam. Validar con abogado.
- **ADR.** Sí: guardar el contacto antes del pedido es PII nueva. Hoy el consentimiento vive en el pedido (D-F6-08).
- **Lo que acelera.** La clave `abandoned_cart` ya está en el registro de entitlements; los carritos tienen el estado `abandoned` y hay un job de expiración (§17.6).

#### OPO-05a · Prioridad Alta · Recordatorio de recompra (suplementos)

- **Qué es.** Calcular cuándo se acaba el producto (porciones de la variante ÷ porciones al día) y avisar unos días antes, por correo y luego por WhatsApp.
- **Ingreso potencial.** Recompras al mes = B (pedidos elegibles) × q (tasa de recompra atribuible) × P1 × P2. B y q son [Supuesto].
- **Costo.** 1–2 semanas, sin dependencias nuevas.
- **Riesgo.** «Porciones al día» no puede sugerir dosis ni prometer beneficios (COFEPRIS): usar solo la porción declarada en la etiqueta. Validar con el asesor regulatorio.
- **ADR.** Probable si agrega una preferencia del cliente.
- **Lo que acelera.** ADR-026 (contenido neto y porciones por variante).

#### OPO-12 · Prioridad Alta · Analítica de conversión

- **Qué es.**
  - Un embudo del lado del servidor: vista de producto → carrito → checkout → pedido → pago.
  - Usa eventos propios por tienda, sin cookies de terceros y compatible con la CSP con nonce.
  - Es una métrica de plataforma que también se puede vender como el entitlement `advanced_analytics`.
- **Ingreso potencial.** Indirecto: es la base para medir A, r, B y q. Para el SaaS, sirve como diferenciador de plan.
- **Costo.** 2–3 semanas.
- **Riesgo.** Volumen de escrituras en Micro (DEP-04). PII en los eventos: no guardarla.
- **ADR.** Sí si agrega una tabla de tienda (regla 2).

#### OPO-03 · Prioridad Media · WhatsApp con estado del pedido y recompra

- **Costo por pedido.** 3 plantillas de utilidad por pedido × MXN 0.1565 = **MXN 0.47** (DEP-07). Una campaña de recompra cuesta MXN 0.7298 por mensaje (marketing). A eso se suma lo que cobre el BSP: [NO VERIFICADO].
- **Ingreso potencial.** Similar a OPO-05a, con otra tasa q′. Es [Supuesto].
- **Esfuerzo.** 2–3 semanas: un `NotificationChannel` nuevo, plantillas aprobadas por Meta y consentimiento.
- **ADR.** Sí. Hoy WhatsApp es solo un enlace de contacto (`trust-bar.tsx`, `header.tsx`).

#### OPO-02 · Prioridad Media · CFDI automático

- **Precios públicos.** Facturapi (https://www.facturapi.io/pricing, consultado el 2026-10-27): licencia API **$299 MXN al mes, IVA incluido**, «multi RFC… sin costo adicional por cada uno».
- **Costo por timbre.** Fuente secundaria (Radar Contable, verificada el 17-oct-2026, https://radarcontable.mx/herramienta/facturapi/): «MXN 0.60 por timbre». Facturama: solo se vio el precio de nómina: [NO VERIFICADO] para la API de ingresos.
- **Encaje.** La API multi-RFC encaja con el multi-tenant: una licencia de plataforma para muchas tiendas.
- **Ingreso potencial.** Complemento de $F por tienda al mes ([Supuesto]) × tiendas que lo usan − ($299 + $0.60 × facturas).
- **Esfuerzo.** 3–4 semanas: datos fiscales del comprador, factura global, cancelaciones.
- **ADR.** Sí.

#### OPO-07 · Prioridad Media · Reseñas verificadas: recordatorio para opinar

- ADR-029 ya implementó las opiniones verificadas y moderadas.
- Dejó fuera el «recordatorio por email para opinar», porque dependía de que el correo funcionara en producción.
- Con Resend activo, es **≈1 semana**.

#### OPO-11 · Prioridad Media · Plantillas por giro

- Ya existen 6 (test: `src/lib/templates/store-templates.test.ts:15-22`).
- Una plantilla nueva por giro de alta demanda (por ejemplo, mascotas o café) cuesta 0.5–1 semana. Es más un argumento de venta del SaaS que ingreso directo.

#### OPO-13 · Prioridad Media · SEO de contenido

- Guías educativas por categoría.
- **Riesgo.** El contenido sobre suplementos no puede hacer afirmaciones de salud; pasarlo por los términos prohibidos del módulo de cumplimiento.
- **Esfuerzo.** 2–3 semanas para el tipo de contenido. El contenido en sí es trabajo continuo.

#### OPO-10 · Prioridad Media · Segunda tienda con inventario sincronizado

- **Atajo.** Que la tienda B trate a la tienda A como «proveedor» (ADR-025). La disponibilidad entraría por `app.apply_inventory_movement` con motivo `supplier_sync`, mediante un adaptador entre tiendas que es un job.
- **Por qué así.** No rompe el aislamiento por `store_id` (regla 2) porque no comparte filas.
- **ADR.** Sí (ADR-038 está propuesto).

#### OPO-05b, OPO-06, OPO-08, OPO-09 · Prioridad Baja

Requieren cambios a los contratos de pagos, descuentos o tenencia (§43). Conviene esperar a tener datos de OPO-12.

---

## 3. Unit economics

Supuestos en la §0. Cifras en MXN.

**Las comisiones de MP se calculan sobre el ticket.** Si el envío se cobra aparte, la comisión crece en proporción.

**Fuera del cálculo:** publicidad y costo de adquisición, sueldos, devoluciones, contracargos, impuestos sobre la utilidad y el IVA de la venta. Con todo eso, el resultado real será **menor**.

### 3.1 Tienda PRUVA: por pedido

| Concepto | Fórmula | Conservador | Base | Optimista |
|---|---|---|---|---|
| Margen bruto | P1 × P2 | 180.00 | 360.00 | 600.00 |
| Comisión MP con IVA | (G3 % × P1 + $4) × 1.16 | 28.93 | 41.08 | 53.22 |
| Comisión efectiva | comisión ÷ P1 | 4.82 % | 4.56 % | 4.44 % |
| Envío absorbido | P4 × P5 | 160.00 | 72.00 | 36.00 |
| Empaque | P6 | 25.00 | 20.00 | 15.00 |
| Correo | G4 × G5 × G1 | 0.03 | 0.03 | 0.03 |
| **Margen de contribución por pedido** | bruto − comisión − envío − empaque − correo | **−33.96** | **226.89** | **495.75** |
| Infraestructura prorrateada (si PRUVA la paga sola) | G6 × G1 ÷ P3 | 101.75 | 20.35 | 6.11 |
| Contribución al mes | contribución × P3 | −1,018.80 | 34,034.22 | 247,874.80 |
| Infraestructura al mes | G6 × G1 | 3,052.50 | 3,052.50 | 3,052.50 |
| **Resultado antes de publicidad y sueldos** | contribución al mes − infraestructura | **−4,071.30** | **30,981.72** | **244,822.30** |
| Pedidos para cubrir la infraestructura | infraestructura ÷ contribución por pedido | no se alcanza (contribución negativa) | 13.5 | 6.2 |

**Lectura** (según los supuestos, no es pronóstico):

- Con un ticket de $600, margen del 30 % y envío gratis absorbido al 100 %, **cada pedido pierde dinero**.
- La palanca es el **umbral de envío gratis** (P5) y el costo de la guía (P4). Por eso OPO-01 tiene prioridad alta.
- La comisión de MP con IVA y el cargo fijo de $4 cuesta **alrededor del 4.4–4.8 %** del ticket.
- Comparación con Stripe con tarjeta: (3.6 % × 900 + 3) × 1.16 = **$41.07** en el escenario base, prácticamente igual a MP ($41.08).

### 3.2 SaaS: por tienda y total al mes

| Concepto | Fórmula | Conservador | Base | Optimista |
|---|---|---|---|---|
| MRR | S1 × S2 | 1,495 | 12,475 | 79,900 |
| Infraestructura | S3 × G1 | 3,052.50 | 3,145.00 | 5,180.00 |
| Soporte | S4 × S5 × S2 | 1,000 | 3,750 | 10,000 |
| Comisión por cobrar la suscripción | (3.6 % × S1 + $3) × 1.16 × S2 | 79.83 | 607.96 | 3,684.62 |
| Costo total | infraestructura + soporte + comisión | 4,132.33 | 7,502.96 | 18,864.62 |
| **Costo por tienda** | costo total ÷ S2 | **826.47** | **300.12** | **188.65** |
| **Margen al mes** | MRR − costo total | **−2,637.33** | **4,972.04** | **61,035.38** |
| Margen % | margen ÷ MRR | −176.4 % | 39.9 % | 76.4 % |
| Tiendas para cubrir la infraestructura (base) | S3 × G1 ÷ (S1 − S4 × S5 − comisión por tienda) | — | 3,145 ÷ (499 − 150 − 24.32) ≈ **9.7** | — |

**Lectura:**

- La infraestructura es casi fija, así que el SaaS solo deja margen con **≈10 o más tiendas** (con los supuestos base).
- El soporte por tienda es el costo que más crece. Las plantillas por giro (OPO-11) y un onboarding guiado lo bajan.
- **Bloqueo:** sin OPO-14 (OAuth de MP por tienda y cobro de la suscripción) el MRR es 0, sin importar el escenario.
- Si la plataforma y PRUVA comparten infraestructura, la §3.1 cuenta ese costo dos veces. En ese caso, prorratéalo entre las tiendas.

---

## 4. Lista compacta de hallazgos

| ID | Severidad | Título | Evidencia corta | Etiqueta |
|---|---|---|---|---|
| DEP-01 | Alto | Productos con nombres asociados con THC o vapeadores en una tienda pública de staging: riesgo de suspender las cuentas de MP, Stripe, Vercel y Supabase de toda la plataforma | AUP de Vercel («illegal goods»), lista de prohibidos de Stripe (cannabis), AUP de Supabase §1.2, DOF 17-01-2025 art. 5o.; credencial única de MP (ADR-028) | VERIFICADO (políticas y datos según el orquestador) / INFERIDO (contenido) |
| DEP-02 | Alto | Concentración en una sola credencial de MP; solo 1 tienda puede cobrar con MP; liberación a 7 días y revisión manual | ADR-028 «Limitación conocida»; `registry.ts:27-35`; páginas de MP | VERIFICADO (código) / NO VERIFICADO (MP real) |
| DEP-03 | Medio | Vercel Hobby prohíbe el uso comercial; producción requiere Pro; `DomainProvider` y cron atados a Vercel | Fair Use Guidelines; `vercel.json`; `domains/provider.ts` | VERIFICADO / NO VERIFICADO (plan real) |
| DEP-04 | Medio | Supabase: staging gratuito (se pausa, sin respaldos); Auth y Storage caros de reemplazar | supabase.com/pricing; D-F9-17; `privileged/*` | VERIFICADO |
| DEP-05 | Medio | Resend: el acceso al panel y los avisos dependen de él; el plan gratuito permite 100 correos al día | `notifications/channel.ts`, `channels.ts`; resend.com/pricing | VERIFICADO |
| DEP-06 | Bajo | Paqueterías sin integración; variación de costo por auditoría de peso | `checkout_tables.sql:61-86`; Cubbo; Skydropx | VERIFICADO / fuente secundaria |
| DEP-07 | Bajo | Precios de WhatsApp cambiantes (subieron el 2026-10-01) | goeva.ai con la tabla de Meta | VERIFICADO (fuente secundaria) |
| OPO-14 ★ | Alta | Cobro de la suscripción SaaS y OAuth de MP por tienda | GATE0 §19; ADR-028 | INFERIDO |
| OPO-01 ★ | Alta | Envíos con cotización en vivo y guías | API de Skydropx; `shipping_rates` | INFERIDO |
| OPO-04 ★ | Alta | Recuperación de carritos | entitlement `abandoned_cart`; `carts.status` | INFERIDO |
| OPO-05a ★ | Alta | Recordatorio de recompra por porciones | ADR-026 | INFERIDO |
| OPO-12 ★ | Alta | Analítica de conversión propia | entitlement `advanced_analytics` | INFERIDO |
| OPO-03 | Media | WhatsApp con estado del pedido | MXN 0.1565 por plantilla de utilidad | INFERIDO |
| OPO-02 | Media | CFDI automático | Facturapi: $299 al mes, multi-RFC | INFERIDO |
| OPO-07 | Media | Recordatorio para opinar (reseñas) | ADR-029, fuera del alcance v1 | VERIFICADO |
| OPO-11 | Media | Más plantillas por giro | 6 plantillas existentes | VERIFICADO |
| OPO-13 | Media | SEO de contenido | ADR-034 | INFERIDO |
| OPO-10 | Media | 2.ª tienda con inventario sincronizado vía «proveedor» | ADR-025, ADR-038 | INFERIDO |
| OPO-05b | Baja | Suscripción con cobro recurrente | — | INFERIDO |
| OPO-06 | Baja | Lealtad | — | INFERIDO |
| OPO-08 | Baja | Afiliados | — | INFERIDO |
| OPO-09 | Baja | Marketplace de marcas | — | INFERIDO |

---

## 5. Fuentes (consultadas el 2026-10-27)

| ID | Fuente | URL | Dato usado |
|---|---|---|---|
| F1 | Mercado Pago · Checkout en tu sitio web | https://www.mercadopago.com.mx/herramientas-para-vender/check-out | «Tu dinero al instante 3,49% +IVA»; 14 días 3.19 %; 30 días 2.95 %. **Nota:** esta página no muestra el cargo fijo de $4; F2 sí. Se usó el valor más caro. |
| F2 | Mercado Pago · Link de pago | https://www.mercadopago.com.mx/herramientas-para-vender/link-de-pago | 3.49 % + $4.00 al instante; efectivo/OXXO 3.79 % + $4.00; liberación a 7 días para vendedores nuevos |
| F2b | Mercado Pago · Blog Hot Sale 2026 (2026-05-05) | https://www.mercadopago.com.mx/blog/hot-sale-integra-mercado-pago | Confirma 3.49 % + $4.00 al instante |
| F2c | Mercado Pago · Blog Checkout Pro (2026-09-03) | https://www.mercadopago.com.mx/blog/checkout-pro-mercado-pago | Plazos de acreditación y revisión manual por riesgo |
| — | Mercado Pago · Sección de costos | https://www.mercadopago.com.mx/costs-section | **No cargó** (error de crawl): [NO VERIFICADO] |
| F3 | Stripe México · Tarifas | https://stripe.com/mx/pricing , https://stripe.com/mx/pricing/local-payment-methods | 3.6 % + MXN 3.00 tarjeta nacional; OXXO 4 % + MXN 3.00; sin IVA |
| F3b | Stripe · Prohibited and Restricted Businesses (2026-09-22) | https://stripe.com/legal/restricted-businesses | Cannabis prohibido; nutracéuticos con afirmaciones dañinas prohibidos; tabaco y cigarros electrónicos restringidos |
| F4 | Supabase · Pricing | https://supabase.com/pricing | Pro USD 25 con USD 10 de cómputo; Micro USD 10, Small USD 15, Medium USD 60; PITR USD 100 al mes por 7 días; el plan gratuito se pausa tras 1 semana |
| F4b | Supabase · AUP v1 (2026-06-01) | https://supabase.com/aup | §1.2 actividades ilegales; suspensión inmediata |
| F5 | Resend · Pricing | https://resend.com/pricing | Gratuito: 3,000 al mes y 100 al día; Pro USD 20 por 50,000; USD 0.90 por 1,000 adicionales |
| F6 | Vercel · Pricing; Fair Use Guidelines (2026-09-14); ToS §4 (2026-10-19); AUP (2026-04-21) | https://vercel.com/pricing , https://vercel.com/docs/limits/fair-use-guidelines , https://vercel.com/legal/terms , https://vercel.com/legal/acceptable-use-policy | Pro USD 20 al mes; Hobby no comercial; Hobby se puede apagar sin aviso; «illegal goods» prohibido |
| F7 | Skydropx · API y tarifa de gestión | https://pro.skydropx.com/es-MX/api-docs , https://help.skydropx.com/subcategorias-cda/api | Endpoints de cotización y envío; 2.5 % de gestión o $199 + IVA al mes |
| F8 | Envío Fácil · Comparativa (precios del 16-oct-2026) | https://enviofacil.com.mx/comparativa | 1 kg desde CDMX: FedEx Express Saver $75 (promocional), Estafeta Terrestre $141.53–$204.44, DHL Standard $186.37–$255.62 |
| F8b | Cubbo · Precios Skydropx (2026-04-28) | https://www.cubbo.com/posts/precios-skydropx | Variación del 15–30 % por auditoría de peso (fuente secundaria) |
| F9 | Facturapi · Pricing; Radar Contable (verificado el 17-oct-2026) | https://www.facturapi.io/pricing , https://radarcontable.mx/herramienta/facturapi/ | API $299 MXN al mes con IVA, multi-RFC; $0.60 por timbre (secundaria) |
| F10 | WhatsApp: tarifas de México desde el 2026-10-01 | https://www.goeva.ai/en/resources/whatsapp-business-api-pricing-mexico , https://www.fiscoclic.mx/asistencia/meta-precios-whatsapp-mxn-2026-10-01.pdf | Marketing MXN 0.7298; utilidad y autenticación MXN 0.1565 |
| F11 | DOF 17-01-2025, reforma a los arts. 4o. y 5o. | https://www.diariooficial.gob.mx/nota_detalle.php?codigo=5747305&fecha=17%2F01%2F2025 | Prohibición del comercio de vapeadores y dispositivos análogos |
| F12 | El Planteo (2025-06-12): política de MP sobre cannabis | https://elplanteo.com/mercado-pago-productos-prohibidos-cannabis/ | Secundaria; la página oficial de MP no cargó |

## 6. Lo que no se pudo verificar

- **Mercado Pago real.** Comisiones vigentes en la sección de costos (la página no cargó), texto oficial de las actividades prohibidas (la página no renderizó) y comportamiento real de retención (sin credenciales).
- **Vercel.** Plan y uso reales del proyecto (403 en el conector).
- **Precios no consultados.** Openpay, Conekta, Clip, Postmark, SES, Brevo, Envía.com (precio), la API de ingresos de Facturama y los BSP de WhatsApp.
- **Datos propios.** No hay pedidos reales: ticket, conversión, abandono, costo de envío y margen son supuestos.
- **Contenido de los 19 productos de staging.** Solo se evaluaron sus nombres.
