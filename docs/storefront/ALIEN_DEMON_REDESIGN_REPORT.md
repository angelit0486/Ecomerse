# Alien Demon Exotics — Informe del rediseño de la tienda pública

> **Estado:** propuesta en la rama `feature/alien-demon-storefront-redesign`, PR en **borrador** contra `producto/orden-10`. Sin merge, sin despliegue y sin cambios en ninguna tienda. Espera aprobación del propietario.

## 1. Punto de partida verificado

- Rama base: `producto/orden-10` @ `1c12b6f8299cc6e2083af0b9f6bbf4755490f6fc` (la rama por omisión del repositorio es `claude/ecommerce-regulated-platform-41vu1e`).
- Respaldo antes de tocar nada: `/home/box/pruva-respaldos/code-1c12b6f8299cc6e2083af0b9f6bbf4755490f6fc.bundle`, sha256 `aa4e9e85f98b3075b7e43badfb924897824d223bf1d40180ced69f4ba8aeddf0`, `git bundle verify` correcto y restauración probada (mismo HEAD y árbol).
- Tienda real de Alien Demon (lectura pública, sin cambios): fondo blanco, verde `#00a303` y morado `#b200ff`, botones píldora.

## 2. Qué se hizo (fases B–J del brief)

| Fase                   | Entregado                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B. Sistema de diseño   | Paleta nocturna, Space Grotesk + Inter, radios 4/6/12, espaciado, foco, estados — `ALIEN_DEMON_DESIGN_SYSTEM.md`                                                                                       |
| C. Inicio              | Encabezado editorial, hero grande con velo y CTA, franja de confianza, categorías 4:5, novedades, historia, más pedidos, beneficios, pie con nombre grande                                             |
| D. Catálogo y tarjetas | Tarjetas sin caja con marca, título de 2 líneas, precio alineado, agregar en contorno; estados oferta / últimas piezas / agotado / cargando / sin foto                                                 |
| E. Ficha               | Rejilla 7/5, galería limpia, título grande, precio y ahorro, jerarquía «Agregar» (plata) > «Comprar ahora» (contorno), **espacio regulatorio** (`.sf-regulatory`) para la información que exija la ley |
| F. Responsivo          | 360/390/430/768/1024/1440 sin desbordamiento; nombre acotado en tableta para que el encabezado quepa en una fila                                                                                       |
| G. Movimiento          | Solo CSS; entrada del hero y aparición al desplazarse; desactivado por completo con «reducir movimiento»                                                                                               |
| H. Rendimiento         | Sin JS nuevo, sin dependencias nuevas, sin fuentes externas; Lighthouse móvil 96–98 con Nocturno                                                                                                       |
| I. Accesibilidad       | Contrastes ≥ 5.9:1 en todo texto; axe 0 violaciones; Lighthouse Accesibilidad 100                                                                                                                      |
| J. QA                  | Ver `ALIEN_DEMON_QA_REPORT.md` y `ALIEN_DEMON_VISUAL_REGRESSION.md`                                                                                                                                    |

## 3. Cómo funciona (sin tocar lo prohibido)

- El tema se activa por tienda con la columna existente `store_themes.theme_key = 'nocturno'`. **Sin migración, sin bandera nueva, sin cambios al panel, a la API, a pagos, inventario ni pedidos.**
- El HTML de la tienda solo recibió clases «gancho» sin estilo. Con `theme_key` distinto de `nocturno` (todas las tiendas hoy), la vista es idéntica (comprobado píxel a píxel y con E2E).
- Lista de archivos: `ALIEN_DEMON_COMPONENT_INVENTORY.md`.

## 4. Lo que **no** se hizo, a propósito

- No se cambió ningún dato de ninguna tienda (ni la de Alien Demon ni las demo en la nube). Todo se probó en una base local.
- No se tocó `image-carousel.tsx` (lo comparte el editor del panel).
- No se escribió texto de marca, historia, promesas, certificados, lotes, reseñas ni redes sociales: el hero, la historia y los beneficios salen de lo que la tienda tenga en Apariencia / Inicio. En las capturas se ven marcadores «DEMO» del entorno local, que **no** están en el código.
- No se agregó texto de venta de productos con THC ni eufemismos; el espacio regulatorio solo da forma al panel que ya existe.
- No se modificaron semillas demo del repositorio ni pruebas existentes.

## 5. Decisiones que necesita Angel

1. **¿Aprobar el estilo?** Revisar las 4 comparativas (antes/después) y el PR en borrador.
2. **Encenderlo en Alien Demon:** cuando se apruebe y se integre, el único cambio es en datos de esa tienda: `update public.store_themes set theme_key = 'nocturno' where store_id = '<id de Alien Demon>';` (tarda hasta 60 s en verse). Es un cambio en una tienda, así que necesita su autorización expresa. Para apagarlo: `theme_key = 'base'`.
3. **Aceptar que con Nocturno se ignoran los colores de Apariencia** (la paleta es fija). Si prefiere poder elegirlo desde el panel, eso es un cambio de panel (fuera de este alcance).
4. **Fotos:** las fotos con fondo blanco se ven como mosaicos claros sobre negro. Lo ideal: fotos con fondo oscuro o neutro, cuadradas, mínimo 1200 px.

## 6. Contenido que Angel debe entregar

- Texto del hero (título y frase) e imagen del hero.
- Historia real de la marca (quiénes son, desde cuándo, qué los distingue) e imagen.
- Beneficios reales y verificables (envío, tiempos, pagos) — ya existen los de envío y pago en Ajustes.
- Políticas: privacidad, términos y envíos (hoy sin publicar en la tienda local de prueba; revisar en la real).
- Redes sociales reales, si las quiere mostrar.
- Información regulatoria que corresponda a cada producto (la define su asesoría legal; el espacio ya está).

## 7. Riesgos y avisos de contenido detectados (no corregidos, fuera de alcance)

- Textos de la plataforma con tono de suplementos: «Más para tu objetivo» (relacionados en la ficha) y «Encuentra lo que necesitas para tu objetivo» (carrito vacío). Cambiarlos afecta a todas las tiendas: decisión aparte.
- Hallazgos previos en la tienda demo en la nube (catálogo con THC, meta «Tienda naturista», texto del pie sobre reenvío por decomiso): son datos de esa tienda; no se tocaron.
- En 768 px el encabezado actual de **todas** las tiendas baja carrito/cuenta a otra fila (ya pasaba antes). Nocturno lo corrige solo para su tienda; se recomienda un arreglo general aparte.
