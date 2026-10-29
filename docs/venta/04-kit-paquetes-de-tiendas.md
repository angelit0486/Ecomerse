# Kit de venta: tiendas como servicio (borrador, 2026-10-29)

Para vender a negocios una tienda en línea lista. Los **precios no están definidos**: los fija el propietario (`[PRECIO]`). Todo lo que se promete aquí existe hoy en la plataforma y está probado en local; lo que depende de servicios reales se marca.

## Paquetes propuestos

| Paquete   | Para quién                            | Incluye                                                                                                                                            | Precio     |
| --------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Arranque  | Negocio que empieza a vender en línea | Plantilla de su giro, logo y colores, hasta [N] productos cargados por CSV, envíos y pagos configurados, dominio de la plataforma                  | `[PRECIO]` |
| Marca     | Negocio con marca propia              | Todo Arranque + dominio propio, páginas (nosotros, preguntas, políticas), portada por bloques a la medida, fotos subidas y optimizadas             | `[PRECIO]` |
| Operación | Negocio con equipo                    | Todo Marca + equipo con roles, importación de catálogo grande con fotos por enlace, capacitación del panel, revisión mensual de la Consola → Salud | `[PRECIO]` |

Cuota mensual de la plataforma: según el plan asignado en Consola → Planes (`[PRECIO]`).

## Lanzar una tienda en horas (guion para quien la arma)

1. Consola → Organizaciones → crear organización y tienda (2 min).
2. Panel → Configura tu tienda → elegir plantilla del giro (1 min): estilo, portada, categorías y ejemplos quedan listos.
3. Logo, colores y datos de la tienda (10 min).
4. Productos: plantilla CSV + fotos en lote por SKU (30–90 min según catálogo).
5. Quitar productos de ejemplo (1 clic; la plataforma no deja publicar mientras existan).
6. Envíos, impuestos y pagos: Mercado Pago con la cuenta del comercio [NO VERIFICADO con Mercado Pago real] o transferencia (15 min).
7. Políticas: borradores en `docs/legal/` (PENDIENTES DE REVISIÓN por abogado).
8. Vista previa privada → Publicar.

## Giros con plantilla

Suplementos, Ropa, Belleza, Abarrotes, Hogar y decoración, Mascotas (más Genérica y En blanco). Productos prohibidos: según la política de contenido (ADR-042, **pendiente de aprobación**).

## Lo que no se debe prometer todavía

- Correos de confirmación y códigos de acceso: dependen de configurar Resend.
- Cobros reales: dependen de las credenciales de Mercado Pago.
- Respaldos automáticos: dependen de pasar Supabase a un plan de pago.
