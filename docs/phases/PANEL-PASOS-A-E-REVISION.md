# Misión Panel — revisión adversarial de los Pasos A–D y cierre del Paso E

Fecha: 2026-10-22. Alcance: commits `0a0455f` (fotos de categorías) y `440d01b` (tema v4: Diseño y
Colores por separado, barra de categorías y marcas sin logo), más el Paso E.

## Revisión adversarial (Pasos A–D)

Un revisor aparte leyó los archivos clave completos: migraciones, Zod, CSS del tema, barra, editor de
colores y acciones. No ejecutó pruebas. **Sin hallazgos de severidad alta.**

| #   | Severidad | Hallazgo                                                                                                                                                                                                                                                                 | Estado                                                                                                                                                                                   |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Media     | La barra de categorías no cambiaba el activo (`aria-current`) al navegar con `<Link>` entre enlaces de la misma ruta con distintos parámetros. Ejemplo: de «Todos» (`/productos`) a «Más vendidos» (`/productos?orden=best_selling`). `pushState` no dispara `popstate`. | **Corregido.** `useSearchParams` dentro de su propio `Suspense`; el HTML estático marca por ruta. Prueba: E2E `nav-bar` a 360, 375 y 1280 px pasa de «Todos» a «Novedades» sin recargar. |
| 2   | Media     | Una zona con colores propios (bloque o elemento) redefinía fondo y texto, pero no el texto de oferta ni los colores de estado. Así, un precio rojo podía quedar ilegible sobre un bloque azul marino.                                                                    | **Corregido.** Ver el detalle debajo de la tabla. Pruebas: 3 unitarias en `resolve-theme.test.ts`.                                                                                       |
| 3   | Baja      | `saveColors` guarda en dos pasos (tema y bloques) y da un mensaje genérico si falla el segundo.                                                                                                                                                                          | **Aceptado.** El mensaje dice qué se guardó y qué no. No pisa borradores ajenos (revisa la revisión). Mejorar el mensaje queda para después.                                             |
| 4   | Baja      | Ids de bloque en mayúsculas (diseños importados) se rechazaban o perdían sus colores.                                                                                                                                                                                    | **Corregido.** `sectionCss` acepta mayúsculas y compara en minúsculas, igual que `data-sec`. Prueba unitaria.                                                                            |
| 5   | Baja      | `thumbs[key]` sobre un objeto plano: una clave como `constructor` devolvería una función del prototipo.                                                                                                                                                                  | **Corregido.** Se usa `Object.hasOwn` en la portada y en la barra.                                                                                                                       |
| 6   | Baja      | Claves de React duplicadas si dos enlaces de la barra repiten ruta y nombre.                                                                                                                                                                                             | **Corregido.** La clave incluye el índice.                                                                                                                                               |
| 7   | Baja      | El borde de la barra se guarda siempre con el valor por omisión.                                                                                                                                                                                                         | **Aceptado.** Es un gris neutro, legible y editable. No afecta el contraste.                                                                                                             |

Detalle del hallazgo 2: dentro de la zona, cada tono se conserva solo si se lee (≥ 4.5:1) sobre su
fondo; si no se lee, toma el color del texto de la zona. Así funcionan los tonos de oferta, peligro,
éxito y aviso. En los bloques de la portada no se conoce el tema y se usa el texto del bloque.

Verificado sin problema:

- **Sin inyección de CSS.** Solo hex validados y uuid.
- **Permisos y aislamiento de `catalog_set_category_media`:**
  - exige el permiso de categorías y AAL2;
  - es `SECURITY DEFINER` con `search_path=''`;
  - otra tienda o un medio que no es de categoría se rechazan.
- **Enlaces de la barra:** solo rutas propias o `https://`.
- **Paridad Zod/SQL:** coinciden en `nav_bar`, `element_colors` y `sale`.
- **Accesibilidad de la barra:** objetivos de 44 px, foco visible y estado activo que no depende solo del color.

## Paso E — cero errores

- **Versión del esquema al arrancar (nuevo).**
  - La migración `20261024000300_schema_version` agrega `public.app_schema_version()`. No es `SECURITY DEFINER`, solo la ejecuta `authenticated` y anon no.
  - El panel la compara con `EXPECTED_SCHEMA_VERSION`. Si faltan migraciones, muestra arriba de cada pantalla: «Faltan actualizaciones de la base de datos (migraciones)…».
  - Un error de red no da aviso falso.
  - Pruebas:
    - pgTAP `98_schema_version` (4);
    - unitarias: comparación, falta de la función, error de red y coincidencia con la última migración que define la función, para que no se olvide subirla;
    - E2E `nav-bar` comprueba que el aviso no sale con la base al día.
- **Aviso «Vista previa del borrador» en el celular.**
  - Ya ocupaba una sola fila. Ahora una prueba E2E lo fija: a 375 px mide 48 px o menos y «Salir de la vista previa» se ve en pantalla (`preview-drafts`).
- **Lighthouse móvil de la portada (demo, 5 corridas en este contenedor).**
  - Rendimiento: 74, 92, 93, 90 y 96, con mediana 92. La primera corrida es en frío.
  - Accesibilidad, buenas prácticas y SEO: 100 en las 5.
  - CLS: 0.008. TBT: 46–115 ms, salvo la corrida en frío.
  - El LCP (2.6–3.5 s) depende de la imagen principal servida por el almacenamiento local.
  - **No se puede afirmar ≥ 95.** La variación del contenedor es de ±5 puntos. Se confirma en staging.
- **Staging.** Faltan 7 migraciones, comprobado con la lista de migraciones de `pruva-staging`, que llega a `20261022000200`:
  - `20261023000100`, `0200`, `0300` y `0400`;
  - `20261024000100`, `0200` y `0300`.
- **Paquete de migraciones para staging.** Base64 con sha256, el mismo método que el runbook `database-roles.md` §7. Se ensayó así:
  - en una base nueva igual a staging (hasta `20261022000200`), las 7 se aplicaron sin errores;
  - el esquema final es idéntico al de pruebas (`pg_dump -s` sin diferencias);
  - volver a pegar un bloque se rechaza con «ya aplicada».

Resultados de las suites: ver `docs/plan/PROGRESS.md` (entrada del Paso E).
