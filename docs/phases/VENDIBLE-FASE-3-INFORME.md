# Misión vendible · Fase 3 · El panel a escala (2026-10-29)

Meta: que el panel sea la herramienta principal del comerciante para llevar su tienda de 0 a 100, igual con 50 productos que con 1000. Detalle y mediciones: `docs/plan/AUDITORIA-PANEL-ESCALA.md`.

Etiquetas: **[VERIFICADO]** = probado aquí con evidencia (local); **[NO VERIFICADO]** = falta medirlo.

## Qué se encontró con 1000 productos

- **La base aguanta:**
  - listado, búsqueda e inventario responden en 0.3–10 ms;
  - el filtro «pocas existencias», en 130 ms;
  - las pantallas tardan lo mismo vacías que llenas (~2 s en local).

  [VERIFICADO]

- **Exportar → editar → importar 1000 productos funciona:**
  - exportar, 2.3 s;
  - validar, 7.4 s;
  - aplicar, 28 s;
  - todo queda como en el archivo.

  [VERIFICADO]

- **El riesgo real estaba en la importación:** la vista previa decía «1000 por actualizar» sin decir qué cambia. Las existencias del archivo reemplazan las de hoy, así que un archivo de ayer borraba en silencio lo vendido entre tanto.

## Qué cambió para el comerciante

| Antes                                                             | Ahora                                                                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vista previa: «1000 por actualizar»                               | «Qué cambia en tus productos»: cuántos precios suben o bajan, cuántas existencias cambian, 5 ejemplos con antes → después y el aviso de reemplazo |
| 25 productos por página: una acción en bloque, 40 veces para 1000 | 25, 50 o 100 por página; las acciones en bloque llegan a 100 a la vez                                                                             |

## Commits

| Commit    | Tarea                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------- |
| `8cdceed` | Vista previa de importación con resumen de cambios. Migración `20261029000200` (solo lectura), pgTAP 107 |
| `0be9c7e` | 25 / 50 / 100 productos por página                                                                       |

## Pruebas de cada tarea

| Tarea              | Unitarias                | Base / integración                                                                                                         | E2E + axe                                                                         |
| ------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Resumen de cambios | Frases y porcentajes (4) | pgTAP 107 (11): cambios, columna vacía no cuenta, solo lee, sin permiso, otra tienda. Integración con 5000 actualizaciones | `imports.spec`: archivo de precios sobre un producto importado de Shopify         |
| Por página         | `parsePageSize` (2)      | Integración: la base topa en 100 y el cursor tras la última fila encuentra la 101                                          | `products-page-size.spec`: 101 productos, seleccionar 100, página siguiente con 1 |

## Suites completas al cierre

| Suite                     | Resultado                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm verify` (unitarias) | 1,026/1,026 [VERIFICADO]                                                                                        |
| pgTAP                     | 2,465/2,465 en 109 archivos [VERIFICADO]                                                                        |
| Integración               | 365/365 [VERIFICADO]                                                                                            |
| E2E (Playwright + axe)    | 110 de 111 en la ronda completa; la fallida se corrigió y pasó 9 de 9 (3 rondas de `imports.spec`) [VERIFICADO] |

**La fallida no se tomó como «inestable»:**

- La cola ahora se procesa al instante, así que a veces la importación ya había terminado cuando la prueba buscaba el aviso «Importando…». La captura mostraba «Importación terminada.».
- Era una carrera de la prueba, no del producto.
- La prueba acepta cualquiera de los dos avisos (los dos significan que el trabajo ya está en la cola), y el mismo arreglo se aplicó a la otra prueba con la misma espera.

## Lighthouse del panel (local, tienda de 1000 productos)

| Pantalla             | Rendimiento                        | Acc. | BP  |
| -------------------- | ---------------------------------- | ---- | --- |
| Inicio               | 99 y 96 (79 en la corrida en frío) | 100  | 100 |
| Productos (25)       | 96                                 | 100  | 100 |
| Productos (100)      | 93                                 | 100  | 100 |
| Inventario           | 99                                 | 100  | 100 |
| Pedidos              | 98                                 | 100  | 100 |
| Ficha de un producto | 97                                 | 100  | 100 |
| Importar             | 97                                 | 100  | 100 |

Meta ≥ 90: se cumple en todas las pantallas una vez caliente el servidor. Contra staging: [NO VERIFICADO].

## Revisión adversarial

1. **¿El resumen puede mentir?**
   - Busca el producto por su handle y la presentación con el mismo ayudante que usa la confirmación (`app.import_find_variant`).
   - La prueba de integración con 5000 productos confirma, aplica y vuelve a pedir el resumen: dice «0 cambios», es decir, anunció exactamente lo que se aplicó.
   - Límite: compara contra las existencias de **hoy**. Si se vende algo entre la vista previa y la confirmación, eso no lo ve.
2. **¿Filtra datos?**
   - Exige `imports.run`.
   - Las existencias solo salen con `inventory.read`.
   - Otra tienda recibe `forbidden`, y pasando su propia tienda con la importación ajena no ve filas (pgTAP).
   - Es `SECURITY DEFINER` con `search_path=''` y pasa los metatests de guardas.
3. **¿Cambia el contrato de importación?** No. Las existencias siguen siendo absolutas (§26.1 paso 7); solo se avisa. Cambiar a «sumar al actual» sería un cambio de contrato y necesitaría un ADR.
4. **¿100 por página es pesado?**
   - Es una consulta de < 1 ms más los extras de la página (fotos y existencias).
   - Con 100 se hace una consulta extra de 1 fila para saber si hay más, porque la base topa en 100. No se tocó esa función.
5. **¿Si el resumen falla, se rompe la importación?** No: la vista previa sigue sin el bloque y el error queda en el registro (`imports.preview_changes_failed`).

## Pendientes (propuestos para la siguiente tanda)

- **E3** Conteo de resultados en el listado («83 productos coinciden»).
- **E4** Inventario en tabla compacta y recepción de mercancía por lote.
- **E5** «Seleccionar los 1000 que coinciden», como trabajo en la cola.
- **[NO VERIFICADO]**
  - pedidos a escala (1000 pedidos);
  - tiempos en staging.
- **Propietario:** aplicar la migración 10 en staging (`docs/runbooks/migraciones-2026-10-27.md`).
