# Súper auditoría Ecomerse/Pruva — Resumen ejecutivo (2026-10-27)

Auditoría de **solo lectura**: no se cambió código, base de datos ni configuración. Hubo 9 revisores por área y un verificador que intentó refutar los hallazgos graves; ninguno quedó refutado.

Etiquetas:

- **[VERIFICADO]**: comprobado hoy.
- **[INFERIDO]**: deducido del código.
- **[NO VERIFICADO]**: requiere un servicio real o un acceso que no hay.

Lo legal es orientación informativa: hay que validarlo con un abogado o un asesor regulatorio.

## Veredicto

La base técnica es fuerte: el aislamiento entre tiendas, el dinero calculado en la base y las pruebas amplias pasan la revisión. Pero **hoy no se puede vender sin riesgo (No-Go)**, por tres razones críticas:

1. Una tienda pública de la cuenta del propietario muestra productos cuyos nombres corresponden a productos asociados con THC y vapeadores.
2. El mantenimiento automático (vencer reservas y conciliar pagos) **nunca ha corrido** en staging.
3. Las reglas sanitarias de suplementos están activas sin la firma del asesor.

Lo técnico que falta son unas 3 a 4 semanas de trabajo. Lo demás son decisiones y cuentas del propietario.

## Semáforo por área

| Área                    | Estado | Por qué (una línea)                                                                                                                        | Documento |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| Pruebas y código        | 🟢     | 945 unitarias, 2,348 pgTAP, 355 de integración y 98 E2E en local; pero el CI está en rojo por el formato de un documento                   | 01, 04    |
| Seguridad y aislamiento | 🟢     | 0 críticas y 0 altas; RLS en 109 de 109 tablas; 4 medias (login por código sin límite, entre otras)                                        | 02        |
| Dinero e inventario     | 🟡     | Sin sobreventa ni doble cobro, pero se ignoran los contracargos y se pierde el pago tardío con webhook perdido                             | 03        |
| Operación y respaldos   | 🔴     | La cola de mantenimiento nunca corre; sin alertas, sin respaldos, un solo operador                                                         | 06        |
| Rendimiento y escala    | 🟡     | Lighthouse 91–99, pero las fotos no tienen variantes y el cron diario está en un plan no comercial                                         | 05        |
| Datos y arquitectura    | 🟡     | Purgas y retención sin programar; la anonimización no alcanza pedidos                                                                      | 04        |
| UX y conversión         | 🟡     | 0 desbordes y 0 problemas de axe en 130 vistas; pero las políticas no se ven en la tienda ni en el pago, y el envío se suma tarde al total | 07        |
| Regulación              | 🔴     | Productos asociados con THC y vapeadores en línea; perfil sanitario sin firma; falta aviso de privacidad en el checkout y domicilio        | 09        |
| Mercado y negocio       | 🟡     | Diferencial real (cumplimiento nativo), pero el SaaS aún no se puede vender y el precio de marketplace es muy bajo                         | 08, 10    |

## 5 amenazas principales

1. **Productos asociados con THC y vapeadores en `pruva-tienda-demo.vercel.app`** (EST-01 y REG-01): 19 activos, cuenta del propietario. Puede provocar la suspensión de Vercel, Supabase y las pasarelas, y tiene riesgo legal.
2. **La cola de mantenimiento nunca ha corrido** (OPS-01): en `system.jobs` de staging hay 0 `orders.expire` y 0 `payments.reconcile`; el cron es diario (`vercel.json`).
3. **Sin monitoreo ni respaldos** (OPS-02 y OPS-04): no hay Sentry ni alertas, y el plan Free de Supabase no hace respaldos.
4. **Contracargos y pagos tardíos de Mercado Pago sin manejar** (DIN-03 y DIN-01): `apply_payment_status` devuelve `ignored`.
5. **Sin filtro de bienes prohibidos ni política de uso** (REG-02): una tienda que no declara categoría se salta todas las reglas.

## 5 oportunidades principales

1. **«La plataforma para vender productos regulados en México»** (MER-03): ningún competidor revisado trae cumplimiento sanitario nativo.
2. **Recompra calculada por porciones** (OPO-05a): las porciones por variante ya existen (ADR-026).
3. **Envíos con cotización y guías** (OPO-01): ataca la palanca que vuelve negativo el escenario conservador (`10`).
4. **Recuperación de carritos y analítica de embudo** (OPO-04 y OPO-12): los permisos `abandoned_cart` y `advanced_analytics` ya existen.
5. **SaaS cobrando** (OPO-14 y MER-02): las tablas de planes y suscripciones ya existen; faltan el cobro y Mercado Pago por tienda (ADR).

## Las 10 acciones de esta semana (en orden)

| #   | Acción                                                                           | Quién                    | Cómo (desde el celular, si es del propietario)                                                                                                           |
| --- | -------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Despublicar los productos de la tienda «demo» y consultar a un abogado           | 🧑                       | Panel → tienda demo → Productos → seleccionar todos → «Pausar». O pedir a Claude que los archive (requiere tu autorización por escrito)                  |
| 2   | Autorizar el arreglo del CI (formato de un documento) y la protección de la rama | 🧑→🤖                    | Responder «autorizo arreglar el CI»                                                                                                                      |
| 3   | Disparador por minuto de la cola, con prueba E2E (BL-02)                         | 🤖                       | —                                                                                                                                                        |
| 4   | Contratar Vercel Pro y Supabase Pro con PITR (BL-05)                             | 🧑                       | Vercel → Settings → Billing → Upgrade to Pro. Supabase → Project → Settings → Billing → Pro, y luego Add-ons → PITR                                      |
| 5   | Activar la protección contra contraseñas filtradas                               | 🧑                       | Supabase → Authentication → Providers → Email → «Leaked password protection» → On                                                                        |
| 6   | Sentry y monitor de salud con aviso al celular (BL-07)                           | 🤖 (y 🧑 crea la cuenta) | sentry.io → crear cuenta → proyecto Next.js → copiar el DSN en Vercel → Settings → Environment Variables                                                 |
| 7   | Credenciales de prueba de Mercado Pago (BL-04)                                   | 🧑                       | Mercado Pago Developers → Tus integraciones → Crear aplicación → Credenciales de prueba → cargarlas en Vercel → Environment Variables (nunca en el chat) |
| 8   | Resend con tu dominio y SPF, DKIM y DMARC (BL-08)                                | 🧑                       | resend.com → Domains → Add domain → copiar los 3 registros DNS en tu proveedor de dominio                                                                |
| 9   | Contactar al asesor regulatorio con la lista de reglas que ya existe (BL-03)     | 🧑 + ⚖️                  | Compartirle el documento «Reglas de cumplimiento para suplementos en México»                                                                             |
| 10  | Segundo administrador y códigos de recuperación (CF-08)                          | 🧑                       | Panel → Ajustes → Equipo → Invitar persona de confianza; guardar los códigos en un lugar seguro                                                          |

## Decisiones del propietario que más valor destraban (en orden)

1. Qué hacer con la tienda «demo» (BL-01).
2. Planes comerciales de hosting (BL-05).
3. Credenciales de Mercado Pago (BL-04).
4. Dominio y Resend (BL-08).
5. Asesor regulatorio y la firma del perfil (BL-03).
6. Catálogo y fotos reales.
7. ADR-027, lotes y caducidad (propuesto), que el aviso sanitario puede exigir.
8. ADR-023, paquetes (propuesto).
9. ADR de OXXO/SPEI y de Mercado Pago por tienda (nuevos).

ADR-026 ya está aprobado.

## Qué está verificado y qué no

- **VERIFICADO:**
  - pruebas locales;
  - aislamiento entre tiendas;
  - flujo de dinero con simuladores;
  - migraciones de staging (120 de 120);
  - contenido público de la tienda demo;
  - jobs de staging;
  - Lighthouse y axe en local;
  - políticas de Vercel, Stripe y Supabase.
- **NO VERIFICADO con servicios reales:**
  - Mercado Pago real (pagos, contracargos, OXXO);
  - Resend y la entregabilidad;
  - Supabase Auth hospedado con SMTP propio;
  - despliegues, logs, cron y variables de Vercel (403);
  - velocidad real en celulares (CrUX);
  - el texto literal de las políticas de Mercado Pago México;
  - el contenido físico de los productos de la tienda demo.

## Índice

`01` Estado real · `02` Seguridad · `03` Dinero e inventario · `04` Datos y arquitectura · `05` Rendimiento y escala · `06` Operación y resiliencia · `07` UX y conversión · `08` Mercado y competencia · `09` Regulación · `10` Oportunidades y economía · `11` FODA y riesgos · `12` Backlog · `13` Hoja de ruta y KPIs · `14` Go/No-Go · `tablero.html`
