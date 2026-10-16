# Plan de lanzamiento: de la vista previa a la primera venta real

Fecha: 2026-10-16. Estado de partida: Gate F9 cerrado en lo técnico (`docs/phases/PHASE-09-REPORT.md`).
Orden acordado (D-S-05): **Fase P → F10 → F11**. Este plan agrega lo que falta para vender de verdad
(contenido, correos, producción) y fija cómo se evita cada error. No reemplaza a
`AUTONOMOUS_PLAN.md`: lo ordena hacia el lanzamiento.

Cada etapa dice **quién** la hace (🧑 propietario, 🤖 Claude), **qué la desbloquea** y **cómo se
verifica**. Nada se da por terminado sin evidencia: pruebas en verde, capturas y métricas.

---

## 0. Cómo se evita cometer errores (reglas para todas las etapas)

1. **Nada llega a producción sin pasar por la vista previa.** Cada cambio: rama → `pnpm verify` →
   `pnpm db:test` → E2E completos → despliegue a la vista previa → verificación en vivo → producción.
2. **Pruebas antes que código** en todo lo que toca dinero, existencias o datos personales: casos
   dorados de totales, concurrencia (dos compras del último producto) y webhooks repetidos o fuera de
   orden.
3. **Revisión adversarial independiente** al cierre de cada fase (base de datos, aplicación, diseño
   y conversión), con sus hallazgos corregidos o aceptados por escrito.
4. **Pagos solo confirmados por webhook verificado o reconciliación** (GATE0 §44.11), con idempotencia.
   Nunca se marca un pedido como pagado desde el navegador.
5. **Migraciones solo hacia adelante**, probadas desde cero, aplicadas con verificación de sha256 y
   con respaldo previo en producción.
6. **Secretos nunca en el chat ni en el repositorio**: el propietario los carga en los paneles de
   Vercel y Supabase; Claude solo verifica que existan.
7. **Nada inventado**: ni reseñas, ni sellos, ni cifras. Si falta un dato, el espacio no se muestra.
8. **Plan de reversa** para cada despliegue: volver al despliegue anterior en Vercel en un clic y
   migraciones compatibles con la versión previa (expand → migrate → contract).

---

## Etapa 1 — Contenido real y decisiones del propietario (🧑, en paralelo a la Etapa 2)

Es lo que más pesa en la confianza percibida (ver §5.3 del informe de la Fase 9).

| #    | Qué entregar                                                                                                                       | Formato                                        | Lo usa                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------- |
| 1.1  | Fotos de cada producto: frente, reverso con tabla nutrimental y una de escala o uso                                                | JPG/PNG de 1600 px o más, fondo limpio         | Ficha, tarjetas, portada                    |
| 1.2  | Logo (horizontal y cuadrado) y colores de marca si ya existen                                                                      | SVG o PNG transparente                         | Encabezado, favicon, correos                |
| 1.3  | Foto o imagen principal para la portada (con personas reales si es posible)                                                        | 2400×960 px                                    | Hero                                        |
| 1.4  | Lista de productos: nombre, presentación, precio, precio anterior (si hay oferta real), existencias, SKU, código de barras         | Hoja de cálculo (la importación CSV ya existe) | Catálogo                                    |
| 1.5  | Textos sanitarios aprobados por tu asesor: leyenda COFEPRIS, ingredientes, modo de uso, advertencias, tabla nutrimental, porciones | Documento por producto                         | Ficha sanitaria (bloqueo **R0**)            |
| 1.6  | Políticas: envíos, cambios y devoluciones, términos y **aviso de privacidad** (LFPDPPP)                                            | Texto revisado por un abogado                  | Páginas y pie                               |
| 1.7  | Contacto: WhatsApp, correo, teléfono, horario y dirección fiscal si aplica                                                         | Texto                                          | Pie, franja de confianza, botón de WhatsApp |
| 1.8  | Envíos: paqueterías, costos por zona, mínimo para envío gratis y tiempos                                                           | Tabla                                          | Tarifas y checkout                          |
| 1.9  | Impuestos: ¿precios con IVA incluido?                                                                                              | Sí/No                                          | Totales y textos                            |
| 1.10 | Decisiones: aprobar ADR-023 (paquetes) y elegir dominio (ej. `tutienda.mx`)                                                        | Respuesta en el chat                           | Fase P y producción                         |

**Verificación (🤖):** cargo el contenido, reviso que cada producto pase el validador sanitario y que
ninguna foto rompa el rendimiento (re-codificación automática), y te mando capturas antes de publicar.

---

## Etapa 2 — Fase P: pagos y promociones en México (🤖, desbloquea 🧑 2.0)

**2.0 (🧑):** abrir la cuenta de Stripe México (persona física con actividad empresarial o moral),
activar OXXO y meses sin intereses en su panel, y cargar las claves en Vercel (te guío pantalla por
pantalla, sin pegarlas en el chat).

| ID     | Tarea                                                                                                                      | Cómo se evita el error                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| P-T01  | Pago con tarjeta y **OXXO** por Stripe: reserva de existencias hasta que vence la ficha, avisos, pago tardío y vencimiento | Pruebas con los payloads reales de Stripe (pago aprobado, fallido, asíncrono, repetido, fuera de orden) + E2E |
| P-T02  | **Meses sin intereses** con monto mínimo por tienda; mensaje en ficha y checkout solo si aplica                            | Prueba del contrato del adaptador + E2E                                                                       |
| P-T03  | **Descuento de primera compra** (D-S-04)                                                                                   | Concurrencia: dos compras simultáneas con el mismo correo → solo una con descuento                            |
| P-T04  | **Paquetes** (solo con ADR-023 aprobado): componentes, existencias y devoluciones                                          | Concurrencia con un componente compartido y pruebas de inventario                                             |
| P-T05  | **SPEI** (transferencia) por Stripe si tu cuenta lo permite; si no, se documenta                                           | Mismo esquema de webhook e idempotencia                                                                       |
| Gate P | Revisión adversarial, informe `PHASE-P-REPORT.md` y **prueba real en el sandbox de Stripe** (spike S-4)                    | Sin hallazgos altos abiertos                                                                                  |

---

## Etapa 3 — Correos y avisos (🤖, desbloquea 🧑 3.0)

**3.0 (🧑):** cuenta de Resend y verificación del dominio (registros DNS que te doy listos para copiar).

| Tarea                                                                                                                        | Verificación                                                     |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Correos con la marca de la tienda: confirmación de pedido, pago recibido, ficha OXXO, enviado con guía, entregado, reembolso | Vista previa de cada plantilla + E2E que lee el correo           |
| Código de acceso al panel y a «Mi cuenta» por correo                                                                         | E2E de inicio de sesión de punta a punta                         |
| Aviso al equipo de pedidos nuevos y pagos                                                                                    | Prueba de integración                                            |
| SPF, DKIM y DMARC del dominio                                                                                                | Comprobación con herramienta externa (correo que no cae en spam) |

---

## Etapa 4 — Lo que falta para estar a la altura de GNC, Birdman y B Life (🤖)

| Tarea                                                                                                                                                        | Por qué                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| **Opiniones verificadas**: solo compradores con pedido entregado, moderación en el panel, sin estrellas inventadas; JSON-LD de reseñas solo con datos reales | La señal de confianza que más falta (hoy el espacio está reservado) |
| **Búsqueda tolerante a errores** («creatna» → creatina) y sinónimos                                                                                          | M7 pendiente                                                        |
| **Precio por porción por variante** (1 kg vs 2 kg)                                                                                                           | M5 pendiente                                                        |
| **«Lo más vendido»** e insignia «Más vendido» con ventas reales                                                                                              | Lo usan las tres referencias                                        |
| **Aviso de «vuelve a estar disponible»** por correo                                                                                                          | Recupera ventas de agotados                                         |
| **Carrito abandonado** (un correo, con permiso del comprador)                                                                                                | Conversión                                                          |
| **Banner de cookies y aviso de privacidad** enlazados, consentimiento registrado                                                                             | LFPDPPP                                                             |
| **Analítica sin datos personales** (Vercel Analytics) y embudo de compra                                                                                     | Medir para mejorar                                                  |

Cada tarea entra con su E2E, axe sin violaciones y Lighthouse sin bajar de 95.

---

## Etapa 5 — Producción (🤖 con 🧑 5.0)

**5.0 (🧑):** pasar Supabase y Vercel a planes de pago (respaldos diarios, tareas cada minuto,
límites de producción) y comprar el dominio.

| Tarea                                                                                                        | Verificación                                                      |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Proyecto de producción en Supabase separado de la vista previa; migraciones desde cero con sha256            | Metatests de seguridad (RLS, permisos) en verde contra producción |
| Variables de entorno de producción (`APP_ENV=production`, Resend obligatorio, clave de servicio)             | La app no arranca si falta alguna (ya validado por `env.ts`)      |
| Dominio propio con HTTPS, `www` → dominio principal, correo del dominio                                      | Comprobación de certificados y redirecciones                      |
| Respaldos automáticos + **simulacro de restauración**                                                        | Restaurar en un proyecto aparte y comprobar pedidos               |
| Monitoreo de errores y alertas (errores del servidor, webhooks fallidos, cola de trabajos)                   | Error provocado a propósito llega como alerta                     |
| Limpieza de la vista previa (`pruva_apply`, `pruva_fetch`, `pg_net` fuera de `public`) y repositorio privado | Avisos de seguridad de Supabase sin pendientes                    |
| Indexación: sitemap enviado a Google Search Console y datos estructurados validados                          | Sin errores en Search Console                                     |

---

## Etapa 6 — Fases 10 y 11 (🤖)

- **F10 — Consola de plataforma y planes:** altas de tiendas, límites por plan, suspensión y
  reactivación sin tocar la base, salud de la cola y de los webhooks. Necesaria para vender la
  plataforma a otros comerciantes; no bloquea la primera venta de tu tienda.
- **F11 — Endurecimiento:** revisión de seguridad completa (checklist §30 y escaneo), presupuestos de
  rendimiento en CI, prueba de carga del checkout, revisión manual con teclado, runbooks de incidentes,
  restauración y rotación de secretos, y lista de verificación de salida a producción.

---

## Etapa 7 — Salida a producción (🤖 + 🧑)

**Lista de verificación de lanzamiento** (todo con evidencia antes de abrir):

- [ ] Todos los productos con fotos reales, textos sanitarios aprobados y precios revisados por ti.
- [ ] Políticas y aviso de privacidad publicados y enlazados en el pie y en el checkout.
- [ ] **Compra real de prueba** con tarjeta, OXXO y SPEI (montos pequeños), seguida de reembolso.
- [ ] Correos recibidos en Gmail y Outlook sin caer en spam.
- [ ] Lighthouse móvil ≥ 95 y axe sin violaciones en producción (red y CDN reales).
- [ ] Respaldo verificado y simulacro de restauración hecho.
- [ ] Monitoreo y alertas probados.
- [ ] Plan de reversa ensayado (volver al despliegue anterior).
- [ ] Aviso «Tienda de demostración» retirado y datos de ejemplo borrados de producción.

**Lanzamiento suave:** primero con un grupo pequeño (amigos o clientes conocidos) durante una semana;
se corrigen los hallazgos; después, apertura pública.

---

## Orden y dependencias

```
Etapa 1 (🧑 contenido) ───────────────┐
Etapa 2 (Fase P) ← cuenta de Stripe   ├─→ Etapa 5 (producción) → Etapa 7 (lanzamiento)
Etapa 3 (correos) ← Resend + dominio  │
Etapa 4 (confianza y conversión) ─────┘
Etapa 6 (F10, F11): F11 antes del lanzamiento público; F10 antes de vender la plataforma a terceros.
```

Lo que Claude puede empezar **ya**, sin esperar cuentas: P-T03 (primera compra), las partes de P-T01 y
P-T02 que se prueban con payloads (sin claves reales), las plantillas de correo con el proveedor de
prueba, y toda la Etapa 4.
