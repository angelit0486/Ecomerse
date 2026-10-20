# Misión panel — Fase 1: alta de productos sin fricción

Fecha de cierre: 2026-10-20. Rama local `claude/carga-imagenes-lote`, commits `70d9fd4` a `10c130a`. Sin publicar en staging.

## Qué se hizo

| Tarea                         | Resultado                                                                                                                                                                                                                                                         | Decisión    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| F1-T1 Alta rápida             | «Agregar producto» pide tipo, nombre, precio, existencias y fotos (varias a la vez, con orden); lo demás plegado en «Más datos»; marca y categoría sugeridas desde el nombre; borrador en el dispositivo; lista de lo que falta. Editor completo en `?completo=1` | D-F1-01..03 |
| F1-T2 Qué falta para publicar | La ficha de un borrador muestra los bloqueos de `catalog_validate_product` antes de intentar publicar                                                                                                                                                             | D-F1-04     |
| F1-T3 Importación             | Tres pasos (plantilla, cómo llenarla, subir); valores en español aceptados; errores con el nombre de la columna en español; «sube el archivo corregido» desde la vista previa                                                                                     | D-F1-05     |
| F1-T4 Sugerencias             | Porciones propuestas por contenido neto ya capturado; SEO plegado en el editor                                                                                                                                                                                    | D-F1-06     |

Sin migraciones ni cambios de contrato (§43): el alta rápida usa `productInputSchema` → `catalog_upsert_product` y `inventory_adjust` con clave de idempotencia; el analizador del CSV solo añade sinónimos.

## Métricas (antes → después)

| Tarea                           | Antes                                                     | Después                                               |
| ------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| Primer producto con foto        | 6 clics, ~14 campos visibles, fotos solo después de crear | 4 clics, 3 campos + fotos al crear                    |
| Importar con errores y corregir | Volver a Importar, elegir archivo y modo otra vez         | Subir el corregido desde la vista previa (mismo modo) |
| Saber qué falta para publicar   | Pulsar «Publicar» y leer el error                         | Visible en la ficha del borrador                      |

## Pruebas al cierre

- `pnpm verify`: 681 unitarias, lint, formato, tipos y build en verde.
- `pnpm db:test`: pgTAP 2047 (82 archivos) e integración 255 en verde.
- E2E completo: 67/69 en la primera corrida. Los 2 fallos se investigaron:
  - `content.spec` (axe, contraste de un botón secundario): axe medía mientras la transición de color de 150 ms del botón recién pulsado estaba a medias. Se estabilizó la medición (puntero fuera y animaciones finitas terminadas) sin omitir reglas; vuelve a pasar.
  - `launch.spec`: la prueba ya estaba actualizada para la Fase 2 y corrió contra el build anterior; pasa con el build actual.
- Nuevos E2E: `quick-product` (375 px, axe, sin desborde); ampliados `imports`, `catalog` y `panel-smoke`.

## Revisión adversarial

Hecha a mano (el agente revisor no pudo lanzarse por un fallo transitorio del entorno). Se verificó en la base que `catalog_upsert_product` exige `products.create` y que `inventory_adjust` exige `inventory.adjust` y rechaza con `conflict` una clave reutilizada para otro movimiento. Hallazgos corregidos:

1. La clave de existencias se reutilizaba entre intentos: un reenvío tras perder la respuesta habría creado un segundo producto cuyo ajuste chocaría con la clave del primero. Ahora cada intento tiene su clave.
2. Las vistas previas `blob:` de las fotos no se liberaban al salir de la pantalla.

Riesgo aceptado y documentado: si se pierde la respuesta del servidor después de crear el producto, un reenvío crea un duplicado (igual que el editor completo); el duplicado queda en borrador y se puede eliminar.

## Pendiente

- Nada de esta fase depende del propietario.
