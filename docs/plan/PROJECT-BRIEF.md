# Informe del proyecto para análisis externo

> **Para la IA que lea este documento.** Es un resumen autocontenido del proyecto al 2026-10-07.
> Las fuentes de verdad son, en este orden:
>
> 1. `docs/architecture/GATE0-ARCHITECTURE-REVIEW.md` (contrato técnico, "GATE0 §x");
> 2. `docs/DECISIONS.md` (decisiones y desviaciones, "D-Fx-yy");
> 3. `CLAUDE.md` (reglas de no regresión);
> 4. `docs/plan/AUTONOMOUS_PLAN.md` y `docs/plan/PROGRESS.md` (plan y avance);
> 5. `docs/phases/PHASE-0X-REPORT.md` (informes de cierre de fase).
>
> Si algo de aquí contradice esas fuentes, mandan ellas. Al final (§12) hay preguntas concretas
> sobre las que queremos tu análisis.

---

## 1. Meta

Construir una **plataforma de e-commerce SaaS multi-tenant y white-label**, del estilo de Shopify,
para venderla a muchas tiendas:

- **Una sola instalación** da servicio a muchas organizaciones. Cada organización tiene una o
  más tiendas (marcas): `Organization → Store`.
- **Cada tienda tiene identidad propia:**
  - dominio;
  - logo, colores y tipografía;
  - páginas legales;
  - emails con su nombre;
  - cuenta de pago propia (el dinero va directo a la tienda).
- **La plataforma cobra a las tiendas** por planes con límites (tiendas, productos, equipo,
  almacenamiento). Ese cobro se automatiza en la Fase 10.
- **Mercado inicial:** México (MXN, IVA 16 % incluido en precios por defecto, `es-MX`), sin
  cerrarse a otros países.

**Principios del propietario (no negociables):**

- seguridad y aislamiento estricto entre tiendas;
- **nunca inventar productos, precios ni contenido legal**;
- reglas regulatorias configurables;
- cambios no destructivos;
- cada fase cierra con un informe;
- nunca se avanza sin verificar la fase anterior.

---

## 2. Reglas técnicas clave (resumen de `CLAUDE.md` y GATE0 §44)

- **Aislamiento de tiendas.** RLS forzado en toda tabla de tienda, con:
  - `store_id NOT NULL`;
  - FK compuestas `(store_id, …)`;
  - trigger que impide cambiar de tenant;
  - nunca `USING (true)`.
- **Roles de mínimo privilegio:**
  - `anon` no recibe grants;
  - `service_role` solo se usa para Auth/Storage Admin;
  - `storefront_gateway` y `system_worker` solo tienen `EXECUTE` de funciones.
- **Funciones `SECURITY DEFINER`:** `search_path = ''` y `REVOKE … FROM public`.
- **Permisos:** nunca en el JWT; se evalúan en la base en cada request.
- **El cliente nunca es autoridad** sobre precio, total, impuestos, descuento, stock, tienda ni
  permisos.
- **Dinero** en `bigint` (centavos).
- **Inventario** solo vía `app.apply_inventory_movement`, y sin llamadas de red dentro de
  transacciones.
- **Pagos** confirmados solo por webhook verificado o reconciliación; todo es idempotente.
- **Historial que nunca se borra:** pedidos, pagos, movimientos y auditoría. Los snapshots de
  pedidos son inmutables.
- **Contenido del comerciante:**
  - sin SVG en subidas;
  - sin CSS ni JS del comerciante;
  - HTML sanitizado (`SafeHtml`).
- **Migraciones** forward-only. Ninguna prueba se salta ni se desactiva.

---

## 3. Arquitectura y stack

| Capa                | Elección                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App                 | Next.js 16 (App Router, Server Actions, RSC), React 19, TypeScript 6, Tailwind 4, Radix UI                                                                          |
| Datos               | Supabase: PostgreSQL 16 + RLS, Auth (OTP por email + TOTP obligatorio para staff), Storage, PostgREST                                                               |
| Acceso a datos      | supabase-js con el JWT del usuario (RLS) para el panel; `postgres.js` con roles dedicados (`storefront_gateway`, `system_worker`) para la tienda pública y los jobs |
| Jobs                | Cola propia en PostgreSQL (`system.jobs`) con runner por cron firmado; mantenimiento periódico (vencimientos, reconciliación, purgas)                               |
| Pagos               | Stripe Connect (cuentas Standard, cargos directos) + transferencia manual + `fake` (solo pruebas). Mercado Pago como 2.º adaptador (pendiente)                      |
| Email               | Resend en producción, Mailpit en local; Send Email Hook de Supabase Auth hacia la app                                                                               |
| Imágenes            | Pipeline en el worker con `sharp` (verifica magic bytes, re-codifica, quita EXIF, limita píxeles)                                                                   |
| Calidad             | Vitest (unit, integración, stack), pgTAP (base de datos), Playwright + axe (E2E y accesibilidad), Lighthouse                                                        |
| Despliegue previsto | Vercel + Supabase (aún no desplegado; ver bloqueos)                                                                                                                 |
| Dependencias        | Mínimas: next, react, supabase-js/ssr, postgres, radix-ui, sanitize-html, sharp, zod, server-only. Sin SDK de Stripe (REST con `fetch`)                             |

**Código:**

- `supabase/migrations/` (43 migraciones SQL);
- `supabase/tests/database/` (37 archivos pgTAP);
- `src/proxy.ts`: request id, CSP con nonce y ruteo por dominio; **no** autoriza;
- `src/server/` (db, jobs, security, payments, notifications, orders, storefront…);
- `src/app/` (panel `/admin/[storeHandle]`, tienda pública por host, consola `/platform`).

En total, unas 22 mil líneas de TypeScript.

---

## 4. Qué está construido (fases 0–7)

Calculamos un **60–65 % del MVP**.

| Fase                              | Contenido                                                                                                                                                                                                                                                                                                                                                                         | Estado                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 0. Contrato                       | GATE0 aprobado y versionado (arquitectura completa, ADRs, matriz de riesgos y de trazabilidad)                                                                                                                                                                                                                                                                                    | ✅                                 |
| 1. Foundation                     | Proyecto, CI (definido), roles de base de datos, cola de jobs, logger que redacta PII, errores públicos uniformes, CSP                                                                                                                                                                                                                                                            | ✅ (CI nunca corrió: P0)           |
| 2. Identidad y tenancy            | Organizaciones, tiendas, dominios, RBAC (roles del sistema + permisos por tienda), RLS en todo, suite genérica de aislamiento, feature flags, estado del tenant (suspender/reactivar), soporte de plataforma con concesiones auditadas, login de staff (OTP + TOTP obligatorio), equipo e invitaciones, onboarding en 4 pasos, consola mínima de plataforma                       | ✅                                 |
| 3. Catálogo y medios              | Productos con hasta 3 opciones y variantes (SKU y código de barras únicos por tienda, precio y precio de comparación, peso y medidas), categorías en árbol (≤ 4 niveles), marcas, etiquetas, especificaciones (`specs` JSON), SEO por producto, publicación con validación, imágenes seguras, HTML sanitizado, logo de la tienda                                                  | ✅                                 |
| 4. Inventario                     | Niveles por ubicación, libro de movimientos inmutable, reservas con vencimiento, ajustes con motivo, concurrencia probada                                                                                                                                                                                                                                                         | ✅                                 |
| 5. Tienda pública, contenido, SEO | Tienda por dominio o subdominio, catálogo, ficha, categorías, marcas, búsqueda, páginas y menús, políticas (plantillas en borrador que el comerciante completa), SEO por host (canonical, JSON-LD, sitemap, robots), caché por tienda con invalidación por tag. Lighthouse 100                                                                                                    | ✅                                 |
| 6. Checkout                       | Carrito (token en cookie httpOnly; la base solo guarda el hash), envíos por zona y tarifa, impuestos, descuentos (reglas, límites, ventana por zona horaria), checkout de una página, pedido del invitado con enlace firmado, cálculo del total en SQL con casos dorados, idempotencia y concurrencia probadas, rate limits, expiración de pedidos sin pagar, pagos manual y fake | ✅                                 |
| 7. Pagos, ciclo de vida y emails  | Ver el detalle abajo                                                                                                                                                                                                                                                                                                                                                              | ✅ (cerrada: `PHASE-07-REPORT.md`) |

**Fase 7 en detalle:**

- **Stripe Connect:**
  - Checkout y webhook Connect verificado (firma, tolerancia, deduplicación, re-consulta al
    proveedor como fuente de verdad; monto, moneda y referencia validados).
  - Reconciliación cada 10 minutos.
  - Pagos tardíos (se re-reserva el stock, o se cancela y queda en atención).
  - Onboarding con Account Links: solo la respuesta de Stripe activa una cuenta.
- **Operación del pedido:**
  - Envíos parciales con rastreo https.
  - Marcar entregado y completar automáticamente.
  - Cancelación (libera stock y reembolsa todo).
  - Reembolsos parciales o totales con devolución al inventario. El dinero solo cambia cuando el
    proveedor confirma (job `refund.execute`).
- **Emails con la marca de la tienda:**
  - Al comprador: recibido con instrucciones, confirmado, pago fallido, enviado, cancelado y
    reembolso.
  - Al staff: nuevo, pagado y atención.
  - Deduplicados, con escape de HTML y Reply-To al contacto de la tienda.
  - Send Email Hook de Supabase Auth.
- **Lanzamiento:**
  - `stores_launch` exige método de pago real activo, producto activo, zona de envío si hay
    productos físicos, políticas publicadas **con contenido propio** (la plantilla no cuenta) y
    email de contacto.
  - Los pasos 3 y 4 del onboarding ya están completos.
- **Ajustes:** Pagos (Stripe y transferencia) y Notificaciones (destinatarios).
- **Prueba de caos:** 100 checkouts con fallos aleatorios (11 escenarios, 16 invariantes),
  repetida con 20 semillas más: cero estados inconsistentes.

**Pruebas al último corte:**

| Suite                 | Pruebas                            |
| --------------------- | ---------------------------------- |
| pgTAP (base de datos) | 1099                               |
| Integración           | 92                                 |
| Unitarias             | 306                                |
| E2E (Playwright)      | 24 (con revisión de accesibilidad) |

La fase 7 tiene además una prueba de mutación que confirma que las invariantes detectan
corrupción.

**Método de cierre de fase:**

1. Revisión adversarial con subagentes (seguridad, dinero y estados; capa de aplicación).
2. Mutaciones para verificar que las pruebas fallan cuando deben.
3. Correcciones en una migración `*_gate_fixes.sql`.
4. Informe de la fase.

En las revisiones anteriores no quedaron hallazgos críticos ni altos abiertos.

---

## 5. Qué falta (plan aprobado)

### 5.1 Cierre de la Fase 7

**Hecho.** Gate F7: dos revisiones adversariales; se corrigieron 3 hallazgos altos, 8 medios y 15 bajos (pagos sobre pedidos cancelados, reembolsos pendientes de Stripe, unidades de reembolso, cobros duplicados, cuentas de Stripe desautorizadas). Ver `docs/phases/PHASE-07-REPORT.md`.

### 5.2 Fase 8: cuentas del comprador y operación

| ID     | Tarea                                                                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F8-T01 | Cuenta del comprador por tienda: login con código (con la marca de la tienda, D-F7-07), vincular pedidos solo después del OTP, historial de pedidos y direcciones                                                              |
| F8-T02 | Clientes en el panel: listado enmascarado, perfil, anonimización (sin `customers.pii.read` no se ve PII)                                                                                                                       |
| F8-T03 | Dashboard de KPIs: ventas, pedidos, ticket promedio, productos más vendidos, stock bajo                                                                                                                                        |
| F8-T04 | **Importación y exportación CSV** (§26): vista previa, errores por fila, atomicidad ≤ 5 000 filas, `store_id` del archivo ignorado, protección contra formula injection. **Se amplía con el plan de carga de productos (§10)** |
| F8-T05 | Ajustes → Actividad (auditoría paginada)                                                                                                                                                                                       |

### 5.3 Fase 9: white-label completo

| ID     | Tarea                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F9-T01 | Editor de marca completo: tipografía curada, forma, header con anuncio, footer, redes, contacto, SEO global. Con vista previa y publicación; el contraste insuficiente bloquea |
| F9-T02 | Editor de secciones de la página de inicio: agregar, quitar, ordenar, editar. Dos tiendas visualmente distintas, ambas ≥ 90 en Lighthouse                                      |

### 5.4 Fase 10: consola de plataforma y planes

| ID      | Tarea                                                                                                                               |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| F10-T01 | CRUD de planes y límites, overrides por organización, suscripciones (hoy manuales) con transiciones y periodo de gracia             |
| F10-T02 | Consola completa: tenants, salud (cola, webhooks, errores), flags, auditoría de plataforma, "Plan y uso" en el panel de cada tienda |

### 5.5 Fase 11: endurecimiento

| ID      | Tarea                                                                                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------------- |
| F11-T01 | Revisión de seguridad completa (§30) + escaneo ZAP                                                                         |
| F11-T02 | Rendimiento: presupuestos de Lighthouse y bundle, `EXPLAIN ANALYZE` de las 20 consultas principales, carga del checkout    |
| F11-T03 | Accesibilidad: axe en todos los E2E + revisión con teclado                                                                 |
| F11-T04 | Runbooks: incidentes, restauración, rotación de secretos, despliegue a Vercel y Supabase, checklist de salida a producción |
| F11-T05 | Páginas legales de plataforma como plantillas marcadas "requiere revisión legal"                                           |
| Gate    | `FINAL-REPORT.md`: estado, cobertura, riesgos residuales y lista exacta de pasos humanos para la Fase 12                   |

### 5.6 Fase 12: piloto (requiere personas)

Despliegue real, tiendas piloto, soporte y medición.

### 5.7 Brechas comerciales fuera del plan actual (propuestas)

Requieren decisión del propietario:

1. **Cobro automático a las tiendas** (Stripe Billing): mensualidad por plan y/o comisión por venta
   (`application_fee` de Connect).
2. **Registro público de tiendas** con prueba gratis (hoy el alta la hace la plataforma).
3. **Dominios propios automatizados:** verificación DNS + certificado vía la API del hosting. El
   modelo `store_domains` ya existe.
4. **Mercado Pago** (OXXO, SPEI, meses sin intereses) como segundo adaptador. GATE0 lo preveía.
5. **Facturación CFDI** para los comerciantes (integración con un PAC). Hoy no está en el alcance.
6. **Más canales de notificación** (WhatsApp, SMS). El contrato `NotificationChannel` ya lo admite.
7. Analítica de la tienda, carritos abandonados, reseñas, colecciones y filtros por atributo (P2
   en GATE0 §14.4).

---

## 6. Decisiones pendientes del propietario

| ID  | Decisión                                                                                                                     | Por qué importa                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| P0  | Dar acceso de escritura a GitHub (app de Claude en `angelii33/pruva`)                                                        | Todo el trabajo vive solo en el contenedor; el CI nunca ha corrido |
| D1  | Modelo de cobro a tiendas: mensualidad, comisión por venta o ambas                                                           | Define la Fase 10 y la configuración de Stripe                     |
| D2  | Alta de tiendas: registro público o asistida con pilotos primero                                                             | Cambia el alcance de la Fase 10 y el riesgo de abuso (R-17)        |
| D3  | Cuentas reales: Supabase, Vercel, Stripe (sandbox para verificar S-4), Resend, dominio                                       | Necesarias para desplegar y validar contra proveedores reales      |
| D4  | Revisar los casos dorados del carrito (`docs/phases/golden-cart-cases.md`)                                                   | Confirma redondeo, impuestos y descuentos                          |
| D5  | Para la carga de productos (§10): ¿XLSX además de CSV? ¿imágenes por URL, por ZIP o ambas? ¿asistente de IA para borradores? | Define el alcance de F8-T04 ampliado                               |
| D6  | Revisión legal de las plantillas (políticas de tienda y de plataforma)                                                       | La plataforma nunca redacta texto legal definitivo                 |

---

## 7. Riesgos y deuda conocida

- **Sin CI ni despliegue real (P0).** Las pruebas solo han corrido en el contenedor. Riesgo de
  diferencias con Supabase gestionado (versiones de Auth, Storage, PostgREST).
- **Stripe sin verificar contra el sandbox real (S-4).** La API está simulada en las pruebas
  según la documentación oficial (API 2024-06-20).
- **El OTP del comprador aún no lleva la marca de la tienda.** Llega con F8-T01 (D-F7-07).
- **Una sola moneda y una tasa de impuesto por tienda.** Cumple con México, pero no cubre
  impuestos por región ni multimoneda.
- **Inventario con una ubicación por defecto en la UI,** aunque el modelo admite varias.
- **Cola de jobs propia en PostgreSQL:** suficiente para el MVP. Revisar si el volumen crece
  (GATE0 §47).
- **Regulación por jurisdicción (RQ-28)** sin implementar. Hay un punto de extensión en los
  validadores de publicación, checkout y lanzamiento.

---

## 8. Oportunidades de mejora (para evaluar)

**Producto:**

- carga masiva de productos (§10);
- plantillas de tienda por giro (ropa, alimentos, artesanías);
- carritos abandonados por email;
- colecciones;
- filtros por talla y color en la tienda;
- reseñas;
- WhatsApp como canal de pedidos y avisos.

**Negocio:**

- comisión por transacción con Stripe Connect;
- planes por volumen de productos;
- onboarding asistido para pilotos;
- programa de referidos entre tiendas.

**Técnico:**

- CI con base de datos efímera;
- pruebas de carga del checkout;
- observabilidad (trazas, alertas de webhooks fallidos y de la cola);
- tipos de la base generados automáticamente;
- caché de imágenes en CDN con tamaños fijos.

**Operación:**

- runbooks;
- copias de seguridad probadas con restauración;
- rotación de secretos;
- panel de salud en la consola.

---

## 9. Lista exacta de lo que vamos a construir (backlog ordenado)

1. **Gate F7:** correcciones de la revisión e informe.
2. **F8-T01..T05:** cuentas del comprador, clientes, KPIs, **carga de productos (§10)**,
   actividad. Gate F8.
3. **F9-T01..T02:** editor de marca y de la página de inicio. Gate F9.
4. **F10-T01..T02:** planes, suscripciones y consola completa (+ D1/D2). Gate F10.
5. **F11-T01..T05:** seguridad, rendimiento, accesibilidad, runbooks, plantillas legales.
   `FINAL-REPORT.md`.
6. **Fase 12 (humana):** despliegue, pilotos y medición.
7. **Después del MVP (según D1–D5):**
   - cobro automático;
   - registro público;
   - dominios automatizados;
   - Mercado Pago;
   - CFDI;
   - WhatsApp;
   - colecciones y filtros;
   - reseñas;
   - carritos abandonados.

---

## 10. Plan: carga de productos de la manera más eficiente

### 10.1 Punto de partida (ya construido)

- **Editor de producto en el panel:**
  - título, descripción en HTML sanitizado, marca, categorías, etiquetas, especificaciones, SEO;
  - hasta **3 opciones** (por ejemplo Talla, Color, Material) con generador de combinaciones;
  - tabla de variantes con precio, precio de comparación, SKU, código de barras, peso y medidas,
    y política de inventario.
- **Imágenes:**
  - **JPG, PNG, WebP o AVIF**, hasta **10 MB**, hasta **40 MP**;
  - se re-codifican a **≤ 4096 px** por lado, **sin EXIF**, verificando el contenido real del
    archivo;
  - **SVG prohibido**;
  - texto alternativo (`alt_text`, ≤ 250 caracteres) y orden por posición;
  - imagen por variante (`product_variants.image_id`).
- **Publicación validada** (§14.3): variante activa, precio > 0, slug único, título. Sin
  `alt_text` solo hay advertencia.
- **Límites del plan:** `max_products` y `max_variants_per_product`.

**El cuello de botella:** hoy los productos se cargan **uno por uno** desde el panel. Para una
tienda con 200–2 000 productos eso es lento y propenso a errores.

### 10.2 Objetivo y métricas

- **100 productos con 3–5 fotos y variantes, publicados en menos de 30 minutos** por una persona
  sin conocimientos técnicos.
- **Cero datos inventados:** todo valor sale del comerciante o de su archivo.
- **Ninguna importación deja el catálogo a medias:** todo o nada hasta 5 000 filas.

### 10.3 Cuatro vías complementarias

**A. Alta rápida en el panel (mejoras al editor)**

- **Plantillas por tipo de producto** (ropa, calzado, alimentos, accesorios):
  - precargan las opciones habituales (Talla: CH/M/G/XG; Color);
  - precargan las especificaciones esperadas (material, cuidados, contenido neto);
  - precargan peso y medidas típicos, que el comerciante debe confirmar.
- **Duplicar producto** (ya existe) y **edición masiva** en la tabla del listado: precio,
  estado, categoría, etiquetas.
- **Subir varias imágenes a la vez** arrastrando, con orden por arrastre y asignación a
  variantes por color.
- **Guía de tallas reutilizable** por tienda: una página o bloque enlazado desde los productos
  con talla. Es contenido del comerciante, no generado.

**B. Importación masiva por archivo (F8-T04 ampliado, §26)**

- **Formato:** plantilla CSV descargable (UTF-8, `,` o `;`) y opcionalmente XLSX (D5).
- **Estructura:** **una fila por variante**, agrupadas por `handle`.
- **Flujo:**
  1. Subida a `store-private`.
  2. Validación en el worker con los **mismos validadores** que el panel.
  3. **Vista previa** con totales (crear, actualizar, omitir, errores) y CSV de errores por fila.
  4. Confirmación.
  5. Commit atómico (≤ 5 000 filas) o por lotes idempotentes.
- **Modos:** solo crear, actualizar existentes, o crear y actualizar (por SKU o `handle`).
- **Seguridad:**
  - se ignora cualquier `store_id` del archivo;
  - se respetan los límites del plan;
  - permiso `imports.run`;
  - las celdas que empiezan con `= + - @` se neutralizan al exportar.
- **Exportación con el mismo formato:** permite editar en Excel y volver a importar.

**C. Imágenes masivas**

- **Opción 1, ZIP de imágenes:** se nombran por SKU o `handle`, por ejemplo
  `CAMISA-AZUL-M_1.jpg`, `camisa-oxford_2.jpg`; el número indica la posición.
  - El ZIP se sube a `store-private`.
  - El worker lo extrae con límites anti zip-bomb: tamaño total, número de archivos, tasa de
    compresión, sin rutas `..`.
  - Cada imagen pasa por el pipeline actual.
  - Se asigna por nombre y se reporta lo que no coincidió.
- **Opción 2, URLs en el CSV** (columna `image_urls`, separadas por `|`):
  - las descarga el worker con protección **SSRF**: solo https, sin IPs privadas ni de
    metadatos, DNS resuelto y fijado, tiempo y tamaño máximos, máximo de redirecciones;
  - luego, el mismo pipeline.
- **Arrastrar una carpeta** al panel: subida directa a Storage y asignación automática por
  nombre de archivo.

**D. Asistente de IA (opcional, D5)**

Sujeto a la regla "nunca inventar":

- **Qué genera, solo como borrador:** descripción, texto alternativo, título SEO y metadescripción.
- **De dónde parte, únicamente:** datos que el comerciante ya escribió (título, especificaciones,
  materiales, tallas) y la imagen.
- **Qué no inventa nunca:** precios, existencias, medidas, materiales, garantías ni afirmaciones
  de salud o legales. Si un dato falta, el borrador lo deja como pregunta.
- **Control:** cada sugerencia queda marcada como "borrador de IA" y **requiere revisión
  humana** antes de publicar. Se audita quién la aceptó.
- **Costo:** se mide por tienda y se limita por plan.

### 10.4 Plantilla de importación propuesta (columnas)

| Columna                                          | Obligatoria   | Ejemplo                            | Regla                                          |
| ------------------------------------------------ | ------------- | ---------------------------------- | ---------------------------------------------- |
| `handle`                                         | sí            | `camisa-oxford`                    | agrupa variantes; slug válido                  |
| `title`                                          | sí (1.ª fila) | `Camisa Oxford`                    | 1–200                                          |
| `description`                                    | no            | `<p>Algodón 100 %…</p>`            | se sanitiza; ≤ 100 KB                          |
| `status`                                         | no            | `draft` / `active`                 | `active` pasa por la validación de publicación |
| `brand`                                          | no            | `Marca X`                          | se crea si no existe (modo upsert)             |
| `categories`                                     | no            | `Ropa > Camisas`                   | ruta; ≤ 4 niveles                              |
| `tags`                                           | no            | `algodón\|verano`                  | ≤ 50                                           |
| `option1_name` / `option1_value`                 | no            | `Talla` / `M`                      | ≤ 3 opciones                                   |
| `option2_name` / `option2_value`                 | no            | `Color` / `Azul`                   |                                                |
| `option3_name` / `option3_value`                 | no            |                                    |                                                |
| `sku`                                            | recomendado   | `CAM-OX-AZ-M`                      | único por tienda                               |
| `barcode`                                        | no            | `7501234567890`                    | 4–32                                           |
| `price`                                          | sí            | `499.00`                           | a centavos sin float; ≥ 0                      |
| `compare_at_price`                               | no            | `599.00`                           | > price                                        |
| `inventory_quantity`                             | no            | `12`                               | movimiento `initial` con clave `job:fila`      |
| `inventory_policy`                               | no            | `deny`                             | deny / continue                                |
| `requires_shipping`                              | no            | `true`                             |                                                |
| `weight_g`, `length_mm`, `width_mm`, `height_mm` | no            | `250`, `300`, `200`, `20`          | enteros ≥ 0; se usan para calcular el envío    |
| `image_urls` / `images`                          | no            | `https://…/1.jpg\|https://…/2.jpg` | ver §10.3 C                                    |
| `image_alt`                                      | no            | `Camisa Oxford azul de frente`     | ≤ 250                                          |
| `variant_image`                                  | no            | `2`                                | posición de la imagen para esa variante        |
| `spec:<clave>`                                   | no            | `spec:Material` = `Algodón`        | va a `specs`                                   |
| `seo_title`, `seo_description`                   | no            |                                    | ≤ 70 / ≤ 320                                   |

**Tamaño tiene dos significados y se modela por separado:**

- **Talla:** es una **opción de variante** (cada talla tiene su SKU, precio y stock).
- **Dimensiones físicas:** **peso y medidas por variante** (`weight_g`, `*_mm`). Se usan para
  las tarifas de envío por peso.

La **guía de tallas** es contenido del comerciante (página o especificación).

**Recomendaciones de imagen** que el panel mostrará:

- formato cuadrado (1:1) o 4:5, de al menos 1200 px;
- fondo limpio y producto centrado;
- una foto por color;
- `alt` descriptivo.

Estas recomendaciones no bloquean, salvo los límites técnicos del pipeline.

### 10.5 Tareas propuestas (para integrar en la Fase 8)

| ID      | Tarea                                                                                                            | Pruebas clave                                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| F8-T04a | Tablas `import_jobs` e `import_job_rows` (§26) + RPC `imports_create` y `imports_commit` + job `import.validate` | pgTAP: `store_id` forzado, permisos, límites del plan                                          |
| F8-T04b | Parser CSV en streaming + validadores compartidos con el panel + vista previa con errores por fila               | integración con archivos de prueba (BOM, `;`, comillas, filas duplicadas, 20 000 filas)        |
| F8-T04c | Commit atómico ≤ 5 000 filas y por lotes idempotentes > 5 000; inventario inicial con clave `job:fila`           | integración: un fallo en la fila 4 999 no deja nada escrito; reintento sin duplicados          |
| F8-T04d | Imágenes por ZIP (anti zip-bomb) y por URL (anti-SSRF) + asignación por nombre de archivo                        | integración: zip-bomb, `../`, IP privada, redirección a localhost, SVG renombrado → rechazados |
| F8-T04e | Exportación CSV con el mismo formato + neutralización de fórmulas                                                | ida y vuelta: exportar → importar sin cambios                                                  |
| F8-T04f | Mejoras al editor: plantillas por tipo, subida múltiple con arrastre, edición masiva en el listado               | E2E: 10 productos con variantes y fotos en un flujo                                            |
| F8-T04g | (Opcional, D5) Asistente de IA de borradores con revisión humana obligatoria y auditoría                         | pruebas: nunca publica sin aprobación; no rellena precio, stock ni medidas                     |

---

## 11. Cómo verificar el estado (para quien tenga el código)

```bash
pnpm install && pnpm verify          # lint, formato, tipos, unit, build
pnpm db:test                         # migraciones desde cero + pgTAP + integración (PostgreSQL ≥ 15 con pgTAP)
pnpm stack up && pnpm test:stack     # stack local sin Docker (Auth, PostgREST, Storage, Mailpit)
pnpm build && pnpm start             # luego: pnpm test:e2e
```

---

## 12. Preguntas para la IA analista

1. **Producto:** ¿qué falta para que un comerciante mexicano pequeño elija esta plataforma frente
   a Shopify, Tiendanube o Mercado Shops? ¿Qué funciones del §5.7 adelantarías antes del piloto?
2. **Negocio:** ¿qué modelo de cobro recomiendas (D1) para el arranque, y con qué precios de
   referencia? ¿Registro público o asistido (D2)?
3. **Carga de productos:** ¿el diseño del §10 cubre los casos reales (ropa con tallas y colores,
   alimentos con contenido neto, artesanías únicas)? ¿Qué cambiarías en la plantilla de columnas?
4. **Riesgos:** ¿qué riesgo del §7 o qué hueco de seguridad ves como prioritario antes de tener
   tiendas reales?
5. **Arquitectura:** ¿algo del stack o de la cola de jobs propia no escalaría a 1 000 tiendas con
   10 000 pedidos diarios en total?
6. **Regulación (México):** ¿qué obligaciones (PROFECO, protección de datos, facturación CFDI,
   devoluciones) deberían reflejarse como validadores configurables y no como texto fijo?
