# Misión vendible · Fase 3 · El panel a escala (2026-10-29)

Pregunta de la fase: ¿el panel le sirve al comerciante para llevar su tienda de 0 a 100, igual con 50 productos que con 1000?

Etiquetas: **[VERIFICADO]** = medido aquí, en local; **[NO VERIFICADO]** = falta medirlo.

## Cómo se midió

- Se creó una tienda local con **1000 productos × 3 tallas = 3000 presentaciones**:
  - 12 categorías y 25 marcas;
  - 900 publicados y 100 en borrador;
  - existencias en todas las presentaciones.
- La siembra usa las mismas funciones del panel (`catalog_upsert_product`, `inventory_adjust`) y tarda 13–16 s.
- Se abrió cada pantalla 3 veces con la sesión de la dueña y se tomaron capturas.
- Se repitió la tarea grande del día a día: exportar el catálogo completo, cambiar precios en el archivo y volver a importarlo.
- Las consultas de la base se cronometraron por separado (con `\timing` y el rol del panel), para saber si la lentitud viene de la base o del servidor.

## Resultados

### Base de datos con 1000 productos [VERIFICADO, local]

| Consulta                                      | Tiempo   |
| --------------------------------------------- | -------- |
| Listado de productos (primera página)         | < 1 ms   |
| Buscar «modelo 777» / por SKU                 | 2–10 ms  |
| Filtro «sin foto»                             | ~6 ms    |
| Filtro «pocas existencias»                    | 130 ms   |
| Inventario (primera, última, solo stock bajo) | 0.3–8 ms |
| Resumen de cambios de una importación (nuevo) | 38 ms    |

**Conclusión:** la base no es el cuello de botella a esta escala.

### Pantallas del panel [VERIFICADO, local]

- Todas abren en ~1.8–2.4 s hasta que la red queda en reposo: inicio, productos, búsqueda, inventario, pedidos, categorías, marcas, exportar y ficha.
- Las pantallas casi vacías (exportar: 1.8 s) tardan lo mismo que las llenas. Ese tiempo es fijo del servidor local más los 500 ms que espera la medición; no crece con el catálogo.
- Hubo una búsqueda de 7.1 s en 1 de 3 corridas. No se repitió, y la consulta en la base tarda 2 ms. Queda anotada como pico del contenedor.
- **En staging: [NO VERIFICADO]** (este contenedor no alcanza Vercel).

### Ida y vuelta por archivo con 1000 productos [VERIFICADO, local]

| Paso                                                      | Tiempo |
| --------------------------------------------------------- | ------ |
| Exportar (3001 líneas, 446 KB)                            | 2.3 s  |
| Validar el archivo editado (3000 filas, 0 errores)        | 7.4 s  |
| Aplicar 1000 actualizaciones (precios y existencias)      | 28 s   |
| Integración con 5000 actualizaciones (vista previa nueva) | < 5 s  |

Todos los precios quedaron como en el archivo. 24 de 3000 difirieron en un centavo, por el redondeo del script de prueba al editar (`toFixed` de JavaScript), no de la plataforma.

## Hallazgos

| #   | Gravedad | Hallazgo                                                                                                                                                                                                                                                                               | Estado                                                                                                                             |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Alta     | La vista previa de la importación decía «1000 por actualizar» sin decir qué cambia. Las existencias del archivo **reemplazan** las de hoy (§26.1 paso 7). Un archivo exportado ayer y subido hoy borra en silencio lo vendido entre tanto, lo que puede llevar a vender lo que no hay. | ✅ `8cdceed`: bloque «Qué cambia en tus productos» (precios que suben o bajan, existencias de hoy → del archivo, ejemplos y aviso) |
| E2  | Media    | El listado mostraba 25 productos por página. Una acción en bloque (publicar, precio, marca, categoría, etiqueta) había que repetirla 40 veces para 1000 productos, aunque el servidor acepta 100.                                                                                      | ✅ `0be9c7e`: «Mostrar 25 / 50 / 100 por página»                                                                                   |
| E3  | Media    | El listado no dice cuántos productos coinciden con el filtro («¿cuántos agotados tengo?») y solo ofrece «Siguiente» y «Primera página».                                                                                                                                                | Pendiente: requiere una función de conteo en la base; se propone para la siguiente tanda                                           |
| E4  | Media    | Inventario: 3000 presentaciones = 60 páginas de 50 tarjetas altas. Buscar por producto o SKU y «Solo stock bajo» funcionan; recibir mercancía de muchos SKU a la vez solo se puede por archivo.                                                                                        | Pendiente: vista de tabla compacta y recepción por lote                                                                            |
| E5  | Baja     | «Seleccionar todos» selecciona la página (ahora hasta 100), no «los 1000 que coinciden con el filtro».                                                                                                                                                                                 | Pendiente: requiere un trabajo en la cola (con 1000 productos no cabe en una sola petición)                                        |
| E6  | Info     | La importación tarda 28 s para 1000 productos y 20–40 s para 5000 en la prueba de integración. Cabe en una ejecución del worker; la página se actualiza sola.                                                                                                                          | Sin cambio                                                                                                                         |

## Lo que no se midió en esta fase

- **Pedidos a escala** (1000 pedidos): la lista pagina igual que productos (cursor de 50), pero no se sembraron pedidos. **[NO VERIFICADO]**
- **Recorrido de 0 a 100:** se auditó en la misión panel (`docs/plan/AUDITORIA-PANEL.md`, fases 0–4), con un recorrido de 128 pantallas a 375 y 1280 px. Aquí no se repitió a mano; lo cubren las pruebas fijas que corren en la suite E2E del cierre:
  - alta rápida;
  - plantillas;
  - lanzamiento;
  - recorrido de pantallas.
- **Staging:** todos los tiempos son locales.
