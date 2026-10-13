# Gate R: informe de cierre de la Fase R (productos regulados: suplementos en México)

> **Estado:** cerrada en local el 2026-10-13. El CI está pendiente porque el push sigue bloqueado (P0).
> Contrato: ADR-021 (módulo regulatorio), ADR-022 (atributos), GATE0 §14.3, §14.4, §21.4 y §26.
> Decisiones: D-R-01 a D-R-06 y D-S-05.

## 1. Cambios realizados

| Tarea | Resultado                                                                                                                                                                                                                                                         |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-T01 | Modelo regulatorio con denegación por defecto: categorías reguladas, perfiles por país (nacen pendientes), reglas versionadas, ficha del producto y validación al publicar y al lanzar. Producto activo ⇒ cumple, con la revisión por lotes `compliance.recheck`. |
| R-T02 | Panel: ficha sanitaria en el editor de producto (tabla nutrimental incluida), Ajustes → Cumplimiento y la consola de reglas de la plataforma. Ninguna pantalla propone texto legal.                                                                               |
| R-T03 | Tienda pública: "Información del suplemento" en la ficha y leyendas en el carrito y el checkout; JSON-LD sin afirmaciones de salud.                                                                                                                               |
| R-T04 | Atributos filtrables ("Objetivo", "Sabor"…): panel, asignación, filtros con conteo en la tienda (OR dentro de un atributo, AND entre atributos) y búsqueda por valor.                                                                                             |
| R-T05 | Ficha y atributos en el CSV de productos, con formato compacto y prueba de ida y vuelta.                                                                                                                                                                          |
| Gate  | Revisión adversarial de base de datos y de aplicación, correcciones (§5) y 15 pruebas de mutación de las correcciones de base.                                                                                                                                    |

## 2. Migraciones

| Migración                                   | Contenido                                                                                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261016000100_regulatory_model.sql`       | Tablas del módulo, validadores, RPC de plataforma y de tienda, `compliance.recheck`                                                                                         |
| `20261016000200_regulatory_panel.sql`       | Lecturas y clasificación en bloque para el panel                                                                                                                            |
| `20261016000300_regulatory_storefront.sql`  | `storefront.get_product_regulatory`, `storefront.cart_legends`, `app.compliance_legends`                                                                                    |
| `20261016000400_attributes.sql`             | `attributes`, `attribute_values`, `product_attribute_values`; listados y conteos; RPC del panel; búsqueda y cumplimiento con atributos                                      |
| `20261016000500_catalog_csv_regulatory.sql` | Columnas de la ficha y de atributos en la importación y la exportación                                                                                                      |
| `20261016000600_phase_r_gate_fixes.sql`     | Gate R (§5): normalización y texto completo del cumplimiento, dos triggers de revisión, continuación sin deduplicar, guardado de atributos; redefine 5 funciones y agrega 3 |

Todas son forward-only y se prueban desde cero en cada `pnpm db:test`.

## 3. Pruebas y resultados (locales, 2026-10-13)

| Suite                                             | Resultado                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify` (lint, formato, tipos, unit, build) | ✅ 356 unit                                                                                                                                       |
| pgTAP                                             | ✅ 1477 en 53 archivos (nuevos de la fase: 46 a 50, y 51 `phase_r_gate` con 26 aserciones)                                                        |
| Integración                                       | ✅ 98 (nuevas: job `compliance.recheck` y la ida y vuelta del CSV con ficha y atributos)                                                          |
| E2E (Playwright + axe)                            | ✅ 38 (nuevos: `compliance` y `attributes`; `imports` y `exports` con las columnas nuevas)                                                        |
| Lighthouse móvil                                  | Ficha del suplemento 99/100/100/100; listado, listado filtrado y ficha con atributos 97–100                                                       |
| Mutación                                          | R-T01: 7 de 7 · R-T03: 8 de 8 · R-T04: 9 de 9 · Gate R: 15 de 15, con un control sin cambios que no se detecta (comprueba que el arnés es válido) |

## 4. Criterios de aceptación (plan §4, Fase R)

| Criterio                                                                | Evidencia                                                                                                                           |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Sin clasificación no se publica (denegación por defecto)                | pgTAP 46 (tienda que declaró la categoría, producto sin clasificar o con perfil pendiente)                                          |
| Una leyenda sin texto bloquea; campos obligatorios; términos prohibidos | pgTAP 46 y 51; E2E `compliance`                                                                                                     |
| Producto activo ⇒ cumple                                                | pgTAP 46, 49 y 51: cambio de reglas, de atributos, de marca y de texto alternativo vuelven a revisar y despublican lo que no cumple |
| La tienda no regulada no cambia                                         | E2E de R-T03 en dos tiendas; exportación sin columnas nuevas (pgTAP 50)                                                             |
| Ficha y leyendas sin texto de la plataforma                             | Las leyendas salen solo de reglas activas de un perfil revisado (pgTAP 48)                                                          |
| Filtros por objetivo con conteo, solo publicados y aislados por tienda  | pgTAP 49; E2E `attributes` con axe                                                                                                  |
| Ficha y atributos por archivo, sin saltarse el cumplimiento             | pgTAP 50; integración de ida y vuelta; E2E `imports`                                                                                |
| **Reglas reales de México (texto legal)**                               | **No verificable aquí:** las da el asesor regulatorio del propietario (R0). El perfil de México sigue pendiente y bloquea.          |

## 5. Revisión del gate

Hubo dos revisiones adversariales independientes, de solo lectura y con reproducción, sobre
R-T01..R-T05: una de base de datos y otra de la capa de aplicación.

| ID    | Sev.  | Hallazgo                                                                                                                                                                                                                                               | Corrección                                                                                       |
| ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| DB-1  | Alta  | La continuación de la revisión por lotes usaba la clave `after:<último id>`: una segunda revisión (otra versión de reglas) que terminaba su lote en el mismo producto no encolaba el siguiente lote, y productos que ya no cumplían seguían publicados | Continuación sin deduplicar                                                                      |
| DB-2  | Media | Un término con signos en la orilla (`100%`) nunca coincidía: `\m…\M` exige que la orilla sea una letra                                                                                                                                                 | Orilla "no letra ni número"                                                                      |
| DB-3  | Media | El texto revisado no incluía etiquetas, marca, opciones ni el texto alternativo de las imágenes, y se podía evadir con entidades (`c&#250;ra`), etiquetas en línea (`c<b>u</b>ra`), guiones suaves o caracteres de ancho cero                          | Texto completo y normalizado; cambiar la marca o el texto alternativo vuelve a revisar la tienda |
| DB-4  | Baja  | Renombrar un atributo con términos prohibidos solo se revisaba en los productos publicados que lo usaban en ese momento                                                                                                                                | Editar un atributo encola la revisión de la tienda                                               |
| DB-5  | Baja  | El id de un valor que llegaba con su clave no se comprobaba contra el atributo                                                                                                                                                                         | Siempre se comprueba (`not_found`)                                                               |
| APP-1 | Media | Guardar un atributo borraba en silencio un valor que otra persona había agregado mientras el formulario estaba abierto                                                                                                                                 | El formulario manda los valores que conocía y la base responde `conflict`                        |
| APP-2 | Media | Cambiar reglas o categorías declaradas no invalidaba la ficha pública en caché (hasta 60 s con leyendas viejas)                                                                                                                                        | Tag `storefront:compliance` e invalidación al instante                                           |
| APP-3 | Baja  | El listado saltaba la caché con cualquier parámetro, aunque la tienda no tuviera ese atributo                                                                                                                                                          | Solo con filtros que la tienda tiene                                                             |
| APP-4 | Baja  | Las casillas del formulario de atributos se reiniciaban tras un error                                                                                                                                                                                  | Casillas controladas                                                                             |
| APP-5 | Baja  | El nombre accesible de cada filtro no coincidía con el texto visible (WCAG 2.5.3)                                                                                                                                                                      | El texto visible "Nombre (n)" es el nombre                                                       |
| APP-6 | Baja  | Regresión de APP-4 que encontró el E2E del gate: React 19 reinicia el formulario al terminar la acción y desmarcaba las casillas controladas tras guardar                                                                                              | Envío sin el reinicio automático (`action` queda como respaldo sin JS)                           |

Las correcciones de aplicación están en el commit `09d8c46` (APP-6, en el commit del gate). Las de base de datos están en
`20261016000600_phase_r_gate_fixes.sql` y en pgTAP 51.

**Mutaciones del gate:** se quitó cada corrección por separado y la suite de la fase (pgTAP 46 a 51) falló en todos los casos. Son 15 mutaciones:

- caracteres invisibles, espacios colapsados, etiquetas en línea y entidades numéricas;
- orilla del término;
- etiquetas, marca, opciones y texto alternativo;
- continuación deduplicada;
- id del valor;
- valores desconocidos;
- revisión al editar un atributo;
- revisión ya en cola.

Hubo además un control sin cambios, que pasó.

**Aceptados y documentados (D-R-06):**

- **Publicar mientras corre una revisión.** La revisión no bloquea las publicaciones nuevas. Un producto que se publica a la vez que cambian las reglas puede quedar publicado hasta la siguiente revisión.
- **Normalización más estricta.** Podría despublicar productos existentes en la siguiente revisión. Hoy no hay datos desplegados.
- **Clasificación declarada por el comerciante.** La plataforma no puede saber si un producto marcado "no regulado" es un suplemento. Lo cubre el acuerdo del comerciante (Fase P).

## 6. Riesgos

- **Contenido regulatorio (R0).** Sin las reglas del asesor, ningún suplemento se publica en
  México: es la intención (denegación por defecto), pero bloquea la tienda insignia en producción.
- **Corpus de términos.** La lista de términos prohibidos la define el asesor. La coincidencia por
  palabra completa no detecta paráfrasis: es una red de seguridad, no un sustituto de la revisión
  humana del contenido.
- **Sin CI (P0):** todo se verificó solo en el contenedor.

## 7. Pendientes

- **Propietario:** P0 (acceso de escritura a GitHub); reglas y leyendas de México con su asesor
  (R0); aprobar ADR-023 antes de P-T04; decisiones D1–D6.
- **Siguiente (D-S-05):** Fase 9, la tienda insignia de suplementos (white-label, portada por
  objetivo, ficha y navegación de nivel insignia), luego la Fase P.

## 8. Definition of Done

Todas las tareas de la Fase R están hechas, no hay hallazgos críticos ni altos abiertos, todas las
suites pasan, las decisiones están documentadas (D-R-01 a D-R-06) y este informe está publicado.
**Se puede pasar a la Fase 9** (ver `docs/plan/PROGRESS.md`).
