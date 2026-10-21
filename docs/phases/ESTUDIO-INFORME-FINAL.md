# Estudio de tiendas · Informe final (Pasos 0–5)

**Fecha:** 2026-10-21 · **Rama local:** `claude/carga-imagenes-lote`, de `7d4fc04` a `9d41b03`. **Nada se subió ni se aplicó en staging.**

## 1. Qué puede hacer ahora la dueña sin tocar código

| Capacidad           | Ejemplo                                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plantilla por giro  | En «Configura tu tienda» elige «Ropa». El borrador queda con colores, tipografía, portada, 4 categorías y 4 productos «Ejemplo · …» en borrador. Esos productos solo se ven en la vista previa y no dejan publicar la tienda hasta quitarlos con un clic.                            |
| Recorrido guiado    | 10 pasos con enlace y estado: plantilla, datos y moneda, logo, productos, envíos, impuestos, pagos, políticas, dominio (opcional) y publicar.                                                                                                                                        |
| Bloques nuevos      | Preguntas frecuentes, beneficios, objetivos, opiniones verificadas, video (sin cargar YouTube ni Vimeo hasta el clic), mapa y contacto, y productos elegidos a mano. Cada uno se puede mostrar solo en celular o escritorio y con fecha de inicio y fin. Se arrastran y se duplican. |
| Identidad           | Favicon, sombras, densidad, contraste con color sugerido cuando no llega a 4.5:1, barra de anuncio con fechas, hasta 4 accesos rápidos y opciones de ficha y listado.                                                                                                                |
| Historial           | Cada publicación guarda una versión (las últimas 30). «Restaurar» la copia al borrador.                                                                                                                                                                                              |
| Páginas con bloques | «Nosotros» o «Preguntas» se arman con los mismos bloques de la portada. Tienen borrador, publicación, imagen al compartir y vista previa de Google.                                                                                                                                  |
| Mover el diseño     | Descarga el diseño en `.json`, súbelo en otra tienda o cópialo de otra tienda de tu organización. Las imágenes, el SEO y el contacto no viajan.                                                                                                                                      |
| Dominio propio      | En Ajustes → Dominio escribes `www.tutienda.mx` y ves el TXT `_platform-verify…`. El sistema lo verifica solo; después eliges «Usar como principal» y la dirección de la plataforma redirige con 301.                                                                                |
| Redirecciones       | En Contenido → Redirecciones: `/productos/proteina-2024` → `/productos/proteina` con 301. La consulta de la URL se conserva y no se puede redirigir a otro sitio.                                                                                                                    |
| SEO de categoría    | Título y descripción para Google de cada categoría.                                                                                                                                                                                                                                  |
| Rol Diseño          | Una diseñadora edita apariencia, páginas y SEO, pero no ve pedidos ni clientes.                                                                                                                                                                                                      |

## 2. Métricas antes y después

|                              | Antes (Paso 0)       | Después                                                                                                                                                                          |
| ---------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pruebas unitarias (`verify`) | 739                  | 837                                                                                                                                                                              |
| pgTAP                        | 2068                 | 2202                                                                                                                                                                             |
| Integración                  | 260                  | 319                                                                                                                                                                              |
| E2E                          | 73/73                | 79/79 (6 nuevas)                                                                                                                                                                 |
| axe (E2E con revisión)       | 0 violaciones graves | 0                                                                                                                                                                                |
| Lighthouse móvil, tienda     | —                    | Portada 96 · listado, mediana 95 en demo y 97 en demo2 (rango 92–97) · ficha 96. Accesibilidad, buenas prácticas y SEO: 100.                                                     |
| Lighthouse móvil, panel      | 91–99                | Rendimiento 94–99 y accesibilidad 100 en 6 pantallas. Buenas prácticas: 93 en Configuración y Apariencia (ver §4). SEO 50 por `noindex`, a propósito porque el panel es privado. |

Lighthouse se midió en este entorno local; el almacenamiento local sirve las fotos a 800 px sin redimensionar, y eso pesa en el listado.

## 3. Lo que se quitó o corrigió

- **Esqueleto de carga (Paso 1).** Se quitó `admin/[storeHandle]/loading.tsx`: convertía los 404 por permisos en 200 (lo detectó la E2E de equipo).
- **Revisión adversarial.** 9 hallazgos, ninguno crítico y sin fugas entre tiendas. 7 corregidos, 1 mitigado y 1 pendiente (`docs/phases/ESTUDIO-PASOS-2-3-REVISION.md`).
- **Redirecciones.** Una URL externa en «Llevar a» se convertía en ruta interna; ya no.
- **Rol Diseño.** La prueba con un correo con «ñ» falló; no afecta al producto.

## 4. Pendientes técnicos (sin decisión tuya)

- **R-5, dominios:** volver a verificar los dominios activos y retirarlos de Vercel al quitarlos. Necesita el token de Vercel para probarlo de verdad.
- **Imagen de categoría:** la base la acepta, pero falta la subida desde el panel.
- **Errores de CSP en el panel:** Configuración y Apariencia muestran errores de CSP en la consola por el `<select>` oculto del componente de selección de terceros. Ya se conocía y es lo que baja buenas prácticas a 93; quitarlos pide reemplazar ese componente.
- **Fuera de esta tanda:** traducciones por idioma, reordenar colecciones (depende de ADR-035) y banners programados más allá de las fechas por bloque.

## 5. Lo que necesito de ti (una sola lista)

1. **Aplicar en staging las 8 migraciones nuevas**, en orden, antes de subir este código:
   - `20261020000200`
   - `20261020000300`
   - `20261021000100`
   - `20261021000200`
   - `20261021000300`
   - `20261021000400`
   - `20261021000500`
   - `20261021000600`

   El código las usa todas: si se sube primero, falla.

2. **Permiso para subir** la rama y desplegar en Vercel.
3. **Token de Vercel** para dominios, guardado como secreto del proyecto (`VERCEL_DOMAINS_TOKEN` y `VERCEL_PROJECT_ID`), nunca en el chat. Si los tienes, también `DOMAIN_CNAME_TARGET` y `DOMAIN_APEX_A`.
4. **Decisión R-1:** que un hostname sea único solo cuando está activo, para que nadie aparte el dominio de otro. Cambia ADR-011.
5. **Pendientes de antes:**
   - credenciales de Mercado Pago y de Resend;
   - `MIGRATION_DATABASE_URL`;
   - aprobación de ADR-023 (paquetes) y ADR-027;
   - asesor regulatorio;
   - catálogo real y fotos;
   - zonas de envío;
   - tasa de IVA confirmada.

## 6. Plan exacto de lo que sigue

- **Fase C, inventario:**
  - ubicación «Principal»;
  - lote y caducidad por variante (migración con FK compuestas y pgTAP);
  - reservas sin sobreventa usando `apply_inventory_movement`;
  - aviso diario de caducidades y existencias bajas.
- **Fase D, pagos en México:**
  - Mercado Pago ya está en el código (Checkout Pro, webhook firmado, reconciliación). Falta probarlo con tus credenciales en la vista previa: un pago aprobado, uno rechazado y un reembolso;
  - transferencia: confirmación manual desde Pedidos (ya existe).
- **Fase E, correos y avisos:** Resend con dominio verificado, plantillas de confirmación, envío y reembolso, y prueba real a un correo tuyo (pendiente de credenciales).
- **Fase F, proveedores:**
  - despachos por proveedor y CSV con columnas `supplier_*` (ya hecho);
  - falta la sincronización periódica de existencias del proveedor (job con su API o con un CSV programado).
- **Fase P, promociones:**
  - descuento de primera compra (D-S-04);
  - paquetes (si apruebas ADR-023);
  - OXXO y meses sin intereses (ADR-024);
  - cupones por producto (ADR-036, después del lanzamiento).
- **Fase 10, plataforma:**
  - planes y límites con overrides;
  - suscripciones con periodo de gracia;
  - consola de salud (cola, webhooks y errores);
  - «Plan y uso» en el panel de cada tienda.
- **Fase 11, endurecimiento:**
  - revisión de seguridad completa y escaneo ZAP;
  - `EXPLAIN ANALYZE` de las 20 consultas principales;
  - prueba de carga del checkout;
  - presupuestos de Lighthouse y del bundle en CI;
  - revisión con teclado;
  - reemplazar el componente de selección para eliminar los errores de CSP del panel.

Supuesto: tomé el alcance de las Fases C–F del plan de la tienda real (`PROGRESS.md`, `AUDITORIA-TIENDA-PREMIUM.md`). La Fase E no tiene una definición escrita: la equiparé a la Etapa 3 de `PLAN-LANZAMIENTO.md` (correos).
