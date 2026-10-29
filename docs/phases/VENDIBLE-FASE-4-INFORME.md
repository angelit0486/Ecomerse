# Misión vendible · Fase 4 · La plataforma como SaaS (2026-10-29)

Meta: convertir PRUVA en un producto SaaS que se pueda cobrar, medir y operar. Brechas de partida: `docs/plan/FASE4-SAAS-BRECHAS.md`. Decisiones: `docs/DECISIONS.md` §29 (ADR-044 a ADR-049).

Etiquetas: **[VERIFICADO]** = probado aquí con evidencia (local, con proveedores simulados); **[NO VERIFICADO]** = falta probarlo con el servicio real.

## Decisiones del propietario (2026-10-29)

| ADR     | Pregunta                   | Decisión                                                                                     |
| ------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| ADR-044 | Cobro de la mensualidad    | Stripe Billing; cambio de plan con **prorrateo**. Precios y días de prueba: los pone él      |
| ADR-045 | Alta autoservicio          | **No**: la tienda la sigue creando la plataforma                                             |
| ADR-046 | Datos al cerrar una tienda | **Anonimizar** a los 30 días                                                                 |
| ADR-047 | Orden de integraciones     | Carritos primero, luego envíos; cada una con su ADR corto                                    |
| ADR-048 | Recordatorio de carritos   | **A todos, como recordatorio**, con enlace de baja. PENDIENTE DE REVISIÓN legal              |
| ADR-049 | Envíos                     | Skydropx con la cuenta de cada comercio. **Bloqueado**: faltan la documentación y las llaves |

## Qué cambió

| Para quién                       | Ahora                                                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dueño de la plataforma (Consola) | **Métricas**: organizaciones, suscripciones por estado, tiendas, ventas y **MRR** real a partir de los precios de cada plan. **Planes → Precios**: mensual, anual, moneda y días de prueba |
| Dueña de una organización        | **Plan y uso → Pagar con tarjeta** (Stripe Checkout) y **Cambiar plan** (prorrateo). El plan solo cambia con el webhook firmado de Stripe                                                  |
| Comerciante                      | **Ajustes → Notificaciones → Recordatorio de carritos** (apagado por defecto)                                                                                                              |
| Comprador                        | Un solo correo si deja su carrito con correo: «Volver a mi carrito» (enlace de un solo uso) y «date de baja aquí»                                                                          |
| Datos personales                 | 30 días después de cerrar una tienda se anonimizan pedidos, clientes, carritos y opiniones. Montos, fechas e inventario no cambian                                                         |
| Legal                            | Borradores de la plataforma (términos, privacidad, uso aceptable) y finalidad nueva en el aviso de cada tienda. Todo **PENDIENTE DE REVISIÓN**                                             |

## Commits

| Commit    | Tarea                                          | Migración        | pgTAP    |
| --------- | ---------------------------------------------- | ---------------- | -------- |
| `ac70294` | Consola → Métricas                             | `20261029000300` | 108      |
| `8a92ee9` | Borradores legales de la plataforma            | —                | —        |
| `804c854` | ADR-044 paso 1: precios en los planes y MRR    | `20261029000400` | 109      |
| `3ec04ea` | ADR-044 paso 2: cobro con Stripe Billing       | `20261029000500` | 110 (26) |
| `c131a4c` | ADR-046: anonimizar 30 días después del cierre | `20261029000600` | 111 (19) |
| `4d3a4fc` | ADR-048: recordatorio de carritos dejados      | `20261029000700` | 112 (18) |
| `0544c3a` | ADR-044: cambiar de plan con prorrateo         | `20261029000800` | 113 (17) |

## Pruebas de cada tarea

| Tarea                    | Unitarias                             | Base / integración                                                                                                                            | E2E + axe                                                                    |
| ------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Métricas                 | Formato de cifras (3)                 | pgTAP 108; integración `platform-metrics`                                                                                                     | `platform.spec` (Métricas)                                                   |
| Precios y MRR            | —                                     | pgTAP 109                                                                                                                                     | `platform.spec` (Precios y MRR)                                              |
| Stripe Billing           | Firma, eventos y Checkout (6)         | pgTAP 110; integración `stripe-billing` (firma, idempotencia, cancelación)                                                                    | `billing-card.spec`: Checkout, webhook falso rechazado, webhook firmado      |
| Anonimizar               | —                                     | pgTAP 111: solo la tienda cerrada hace más de 30 días, valores exactos, montos intactos; integración `store-anonymization`                    | Sin pantalla (trabajo del sistema)                                           |
| Recordatorio de carritos | Enlaces, firma de baja, plantilla (6) | pgTAP 112: permisos, apagado por defecto, ventana 3–48 h, baja, un solo uso, otra tienda; integración: hash igual al de la base, fallos       | `cart-recovery.spec`: activar, recuperar con botón, enlace usado, baja       |
| Cambiar plan             | Petición a Stripe con prorrateo (2)   | pgTAP 113: precio de la base, mismo plan, sin precio, límites, permisos, AAL2, cobro pendiente; integración: el webhook aplica plan y periodo | `billing-card.spec`: cambiar plan, cuerpo enviado a Stripe, webhook aplicado |

## Suites completas al cierre

| Suite                     | Resultado                                                  |
| ------------------------- | ---------------------------------------------------------- |
| `pnpm verify` (unitarias) | 1,043/1,043 [VERIFICADO]                                   |
| pgTAP                     | 2,571/2,571 en 115 archivos [VERIFICADO]                   |
| Integración               | 375/375 [VERIFICADO]                                       |
| E2E (Playwright + axe)    | 117/117 en una sola ronda completa (17.9 min) [VERIFICADO] |

## Revisión adversarial

Se revisó cada cambio buscando cómo romperlo: otra tienda u organización, otro rol, sin 2FA, valores del navegador, reintentos, avisos repetidos o atrasados, enlaces filtrados y fallos a la mitad.

| #     | Hallazgo                                                                                                                            | Qué se hizo                                                                                                         |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| F4-01 | El enlace de baja llevaba el **correo** en la URL (queda en historiales y registros)                                                | Corregido antes del commit: lleva el hash del correo firmado con HMAC; la base solo acepta el hash (pgTAP 112)      |
| F4-02 | Los revisores de enlaces de los correos abren los enlaces: habrían **gastado** el enlace de un solo uso o dado de baja a la persona | Corregido: las dos páginas piden confirmar con un botón (POST)                                                      |
| F4-03 | El carrito se marca como «recordado» **antes** de mandar el correo. Si el proveedor falla, ese recordatorio se pierde               | Aceptado y documentado: es mejor perder un recordatorio que mandar dos. Un fallo no detiene los demás (integración) |
| F4-04 | Quien tenga el enlace de recuperar ve el carrito (productos y, si ya los escribió, datos de envío)                                  | Aceptado: el enlace va solo al correo del comprador, es de un solo uso, tiene 256 bits y vence con el carrito       |
| F4-05 | Bajar a un plan más chico podía dejar a la organización por encima de sus límites                                                   | Corregido: la base rechaza el cambio si sobran tiendas, productos o personas (`over_limit:*`)                       |
| F4-06 | Cambiar de plan con un cobro pendiente sumaría otro cargo                                                                           | Corregido: se pide regularizar el pago primero (`past_due`)                                                         |
| F4-07 | Un webhook de cambio que llega tarde podría revertir otro más nuevo                                                                 | Ya cubierto por ADR-044 paso 2: se ignoran avisos más viejos que el último aplicado (pgTAP 110)                     |
| F4-08 | Un selector de la E2E de Ajustes («Guardar») chocaba con el botón nuevo «Guardar recordatorio»                                      | Corregido con coincidencia exacta; no era un fallo del producto                                                     |
| F4-09 | El límite de almacenamiento (`storage_mb`) no se revisa al bajar de plan                                                            | Abierto, menor: el almacenamiento ya bloquea subidas nuevas al pasarse                                              |
| F4-10 | Capacidad del recordatorio: 50 carritos por corrida cada 15 minutos (200 por hora en toda la plataforma)                            | Abierto: suficiente para el arranque; subirlo es cambiar un número                                                  |
| F4-11 | El correo de recordatorio no trae domicilio ni datos de contacto de la tienda                                                       | Pregunta para el abogado (publicidad por correo, PROFECO)                                                           |

Nada de lo nuevo toca el aislamiento entre tiendas: tabla nueva con `store_id`, RLS forzado, política por permiso y trigger de tenant; funciones nuevas con `search_path = ''` y `REVOKE` de `public`. Los metatests de `00_schema_security` cubren todo lo nuevo y pasan.

## Lo que no se hizo y por qué

- **Alta autoservicio:** el propietario decidió que no (ADR-045).
- **Envíos con Skydropx (ADR-049):** bloqueado hasta tener la documentación de su API y llaves de prueba; no se inventa una API.
- **CFDI y WhatsApp:** fuera del orden aprobado (ADR-047: carritos, luego envíos).
- **ADR-046 paso 2:** borrar cuentas de compradores en Auth y fotos en Storage requiere el administrador privilegiado; queda para la siguiente tanda.
- **Dominios propios:** ya estaban hechos (ADR-037); falta el token de Vercel para probarlos de verdad.

## Pendientes del propietario

1. Aplicar las **16 migraciones** en staging: `docs/runbooks/migraciones-2026-10-27.md`.
2. Precios y días de prueba de cada plan (Consola → Planes → Precios).
3. Cuenta de Stripe y sus llaves (`docs/runbooks/stripe-billing.md`). Hasta entonces el cobro con tarjeta está **[NO VERIFICADO con Stripe real]**.
4. Documentación y llaves de prueba de Skydropx.
5. Revisión del abogado:
   - borradores de la plataforma;
   - aviso de privacidad de las tiendas (finalidad del recordatorio);
   - si el recordatorio necesita consentimiento previo;
   - qué datos de la tienda debe llevar el correo.
6. Resend, credenciales de Mercado Pago, Supabase Pro con PITR, autorización de Vercel y DSN de Sentry (sin cambios desde la Fase 3).
