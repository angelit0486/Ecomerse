# RM-12 — Revisor del archivo: todos los errores en un solo reporte

> Protocolo de mejora continua (2026-11-28). Este documento fija los **criterios de
> aceptación antes de tocar código**. Los resultados se agregan al final. Base: `9fd3e34`
> (`docs/audit/LINEA_BASE_2026-11-28.md`).

## Qué ya existía (no se reconstruye)

D-PROD-04 y O10-04 ya entregaron la mayor parte del revisor:

- vista previa con errores por columna y por fila;
- CSV de errores (`…/importar/[jobId]/errores`);
- «importar solo lo que está bien»;
- revisión de enlaces de fotos antes de confirmar (`photo-check`, hasta 500 enlaces por
  revisión; lo que no alcanza se marca «sin revisar»);
- categorías nuevas (ADR-065).

## Lo que falta de verdad (hallazgos de la auditoría, con evidencia en el código)

1. **El CSV de errores se corta en 1,000 filas.** La ruta pide `.limit(5000)`, pero
   PostgREST tiene `max_rows = 1000` (`supabase/config.toml`; también es el valor por
   omisión del servicio alojado [no verificado en staging]). Un archivo de 5,000 filas
   con 1,500 errores entrega 1,000 sin avisar.
2. **Un archivo de más de 5,000 filas no tiene un solo reporte.** Se parte en partes de
   2,500 filas (ADR-064/067) y cada parte tiene su propio CSV. Un archivo de 10,000 filas
   obliga a abrir 4 partes y bajar 4 archivos.
3. **Un SKU repetido en dos partes distintas no se detecta antes de aplicar.** Cada parte
   se valida sola. Si la parte 1 y la parte 4 traen el mismo SKU, ambas salen «Lista». Al
   aplicar, la parte 4 falla y el lote queda **aplicado a medias**. Es el caso que la E2E
   `import-batch` provoca a mano con «Intruso».

## Alcance

- Solo lectura y presentación: **sin migraciones**, sin cambiar `imports_create*`,
  `import_commit` ni el contrato de las partes. No toca pagos, checkout ni inventario.
- No cambia qué se puede aplicar. Bloquear «Aplicar el lote» cuando hay SKU repetidos
  entre partes sería un cambio de comportamiento: queda como **propuesta para el
  propietario**.

## Criterios de aceptación

| #   | Criterio                                                                                                                                                              | Cómo se comprueba                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | El CSV de errores de una importación trae **todas** las filas con error (hasta las 5,000 del tope), con las mismas columnas de hoy (`fila,errores,…`)                 | E2E con 1,500 filas con error: el CSV trae 1,500. Primero se sube la prueba sola para que CI muestre el corte (antes) y luego el arreglo (después) |
| C2  | Un lote tiene **un solo CSV** con los errores de todas sus partes, en orden de fila del archivo original y con la columna `parte`                                     | E2E con un archivo de 10,000 filas en 4 partes                                                                                                     |
| C3  | El reporte del lote marca los **SKU repetidos entre partes** con fila y parte de la primera aparición, y la página del lote lo advierte antes de «Aplicar el lote»    | Unitarias de la función pura y E2E                                                                                                                 |
| C4  | Un archivo de 10,000 filas da su reporte completo en **menos de 30 s** (criterio del roadmap)                                                                         | Tiempo medido en la E2E (CI) y de la parte pura (local)                                                                                            |
| C5  | Aislamiento: el reporte solo lee con la sesión del usuario (RLS), exige `imports.run` de **esa** tienda, y un lote de otra tienda da 404                              | E2E con un segundo comercio                                                                                                                        |
| C6  | Datos: el CSV mantiene la protección contra fórmulas de `toCsv` y no expone columnas internas                                                                         | Unitarias                                                                                                                                          |
| C7  | UX: enlace visible con el número de filas con error. Español claro. Sin violaciones graves de accesibilidad (axe)                                                     | E2E                                                                                                                                                |
| C8  | Sin regresión frente a la línea base: lint, formato, tipos, unitarias (≥ 1,796 + nuevas), build, `db:test` (≥ 3,330 / ≥ 468) y CI (Stack ≥ 29, E2E sin fallos nuevos) | Re-ejecución local y CI                                                                                                                            |
| C9  | Tamaño del JS del cliente sin crecer más de 2 % (las rutas nuevas son del servidor)                                                                                   | Mismo cálculo que la línea base                                                                                                                    |
