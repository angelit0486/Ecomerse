# Misión panel — Fase 4: pulido, celular y rendimiento

Fecha de cierre: 2026-10-20. Commits `a15fde2`, `62d0421` y el de cierre. Sin publicar en staging.

## Qué se hizo

| Pedido de la misión                   | Resultado                                                                                                                                                                        | Decisión |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Sistema de diseño consistente         | Botones, campos y selectores con la misma altura en todo el panel (también los 17 escritos a mano); «Más del catálogo» en Productos; el `Feedback` duplicado de Contenido se fue | D-F4-02  |
| Mobile-first, objetivos de 44 px      | Menú agrupado con «Menú» en el celular; controles de 44 px bajo 768 px; casillas de 24 px (mínimo AA)                                                                            | D-F4-01  |
| Esqueletos y estados de carga         | Indicador en la entrada del menú elegida y esqueleto en «Avisos». El esqueleto de página se probó y se quitó: bajaba Lighthouse                                                  | D-F4-03  |
| Rendimiento (panel ≥ 90, tienda ≥ 95) | Ficha con todas sus lecturas en una sola ronda; Zod fuera del navegador en Apariencia y Configurar tienda (278 → 186 KB de JS)                                                   | D-F4-05  |
| axe 0 violaciones                     | 0 serias o críticas y 0 moderadas en las 132 pantallas del panel                                                                                                                 | —        |
| Eliminar lo aprobado                  | E1, E2, E3 y parte de E4 (ver abajo)                                                                                                                                             | D-F4-04  |

## Medición antes → después

Mismo script sobre la misma base local (`demo`, 16 productos), a 375 px, contra el build de `a715b48` y el de esta fase:

| Medida                                         | `a715b48` | Fase 4 |
| ---------------------------------------------- | --------- | ------ |
| Pantallas recorridas                           | 132       | 132    |
| Pantallas con desplazamiento lateral           | 4         | 0      |
| Violaciones críticas de axe                    | 1         | 0      |
| Tipos de aviso moderado de axe                 | 2         | 0      |
| Objetivos táctiles < 44 px (suma de pantallas) | 5169      | 943    |

Los 943 restantes son sobre todo casillas de 24 px (cumplen el mínimo AA de WCAG 2.5.8) y enlaces dentro de tablas de 37–40 px.

**Lighthouse móvil (rendimiento), varias corridas:**

| Pantalla          | Línea base | Fase 4 |
| ----------------- | ---------- | ------ |
| Inicio            | 95         | 96–98  |
| Productos         | 91         | 98     |
| Agregar producto  | 99         | 97–99  |
| Ficha             | 96         | 98–99  |
| Pedidos           | 96         | 97–98  |
| Inventario        | 91         | 92–95  |
| Apariencia        | 92         | 92–97  |
| Configurar tienda | 95         | 94–96  |
| Tienda (portada)  | 96         | 92–96  |

La tienda no se tocó en esta misión; su variación (92–96) es la misma que en la línea base («92 en frío»). Accesibilidad 100 en todas.

## Eliminado

- Primitivas sin uso: `checkbox`, `drawer` y `tabs`, con sus 3 pruebas unitarias.
- Exports muertos: `clearCartCookie`, `isStandardWebhookSecret` y `THEME_VERSION`.
- El reexport `_shared/submit.ts`.
- El `Feedback` de Contenido, idéntico a `FormFeedback`.

## Pruebas al cierre

- `pnpm verify` en verde: 678 unitarias, 3 menos que antes por las primitivas eliminadas.
- `pnpm db:test` en verde: pgTAP 2047 en 82 archivos e integración 255.
- E2E completo sobre el build final: **71 de 71 en verde** (10.1 min). Incluye `checkout.spec` con el localizador exacto de la Fase 3.
- E2E nuevo: `panel-mobile`, a 375 px con axe. Cubre el menú, «Más del catálogo», los 44 px, la ficha sin desplazamiento lateral y la imagen sin descripción en SEO.
- E2E ajustados: `suppliers` y `attributes` abren «Más del catálogo».

## Revisión adversarial

Hecha a mano sobre el diff de la fase:

- **Alturas en escritorio.** `cn` concatena sin fusionar, así que `md:h-9` de la primitiva gana a un `h-11` de quien la usa. Se revisaron todos los usos con altura propia (11): los que querían 44 px siempre ahora piden `md:h-11`, y en los demás bastaba la primitiva.
- **Fuera del panel.** La tienda no usa estas primitivas. La consola de plataforma y las pantallas de acceso sí, y también ganan 44 px en el celular.
- **Hallazgo corregido: el esqueleto de página bajaba Lighthouse** (ficha 96 → 89). Se midió con y sin él y se sustituyó (D-F4-03).
- **Hallazgo corregido: afirmación falsa en DECISIONS.** El primer borrador decía que los avisos ya compartían `FormFeedback`; quedaban 5 locales. Se unificó el idéntico y se documentan los 4 que hacen algo distinto.
- **Hallazgo corregido: dos buscadores con el mismo nombre de región** (axe `landmark-unique` en Clientes). Ahora se llaman «Buscar en el panel» y «Buscar clientes».
- **Lecturas en paralelo de la ficha.** Si falla la de existencias, falla la página entera, igual que antes. No se cambió ningún permiso ni consulta.
- **Sin cambios de esquema.** La fase no tocó migraciones, RLS ni RPC.

## No hecho, con su motivo

- **Paginar Proveedores y Descuentos:** con decenas de registros no cambia nada medible, y un tope sin paginación escondería datos (D-F4-04).
- **Unificar los 4 `Feedback` restantes:** cada uno hace algo distinto (D-F4-04).
