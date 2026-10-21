# Portada y marcas · Revisión adversarial del Paso 1

**Fecha:** 2026-10-21. **Alcance:** commit `5daaf7a` (diagnóstico de la portada y correcciones). **Revisor:** un agente independiente que solo podía leer el código. Las correcciones las hizo esta sesión.

## Resultado

No hay hallazgos de seguridad:

- **XSS:** los enlaces se muestran solo como texto de React o como valor de `<option>`, nunca en un `href`.
- **Redirección abierta:** ninguna.
- **Aislamiento entre tiendas:** todas las consultas llevan `store_id`, el id sale del servidor y además aplica RLS.

Hubo 3 hallazgos medios y 5 bajos, todos sobre avisos falsos y accesibilidad.

| #   | Severidad | Hallazgo                                                                                                                                                        | Estado                                                                                                                                                        |
| --- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Media     | Un rol sin `products.read` (o sin `seo.manage`) recibe listas vacías por RLS y todos sus enlaces válidos daban aviso.                                           | **Corregido.** `linkAccess(ctx)`: lo que el rol no puede leer queda en `null` y no avisa. Prueba unitaria.                                                    |
| 2   | Media     | Si una consulta fallaba, supabase-js no lanza: la lista quedaba vacía y aparecían avisos falsos.                                                                | **Corregido.** Toda consulta con `error` devuelve `null`, que significa «no se sabe».                                                                         |
| 3   | Media     | Se cargaban hasta 5000 slugs de productos en cada carga y se enviaban al navegador; con más productos (o con el tope de filas de PostgREST) daba avisos falsos. | **Corregido.** Ya no se cargan productos: al guardar se buscan solo los slugs a los que apuntan los botones (hasta 100). En vivo no se avisa de productos.    |
| 4   | Baja      | Las redirecciones se comparaban distinguiendo mayúsculas («/Plumas» contra «/plumas»).                                                                          | **Corregido.** Se comparan en minúsculas, como el proxy. Prueba unitaria.                                                                                     |
| 5   | Baja      | Faltaban `/cuenta/…`, `/pedido/…` y `/pago-simulado/…`.                                                                                                         | **Corregido.** Ahora se reconocen como prefijos. Prueba unitaria.                                                                                             |
| 10  | Baja      | El aviso en vivo era una región viva y el lector de pantalla lo anunciaba con cada tecla.                                                                       | **Corregido.** El aviso ya no es región viva; se liga al campo con `aria-describedby`. El aviso que aparece después de guardar sí queda como `role="status"`. |
| 11  | Baja      | Contraste de `text-warning` sobre `bg-canvas`.                                                                                                                  | **Revisado.** `#8a5a00` sobre `#f6f8fb` da 5.8:1, así que cumple AA. El panel no tiene modo oscuro.                                                           |
| 12  | Baja      | El difuminado de los accesos rápidos atenuaba un enlace con foco en el borde derecho.                                                                           | **Corregido.** El difuminado se quita con `focus-within`.                                                                                                     |
| 13  | —         | El contraste del texto de ayuda del buscador depende del tema de cada tienda.                                                                                   | **Pendiente (Paso 4):** validar `muted` contra el fondo al guardar la paleta.                                                                                 |

**Lo que el revisor confirmó correcto:**

- El estado derivado `lastState`/`edited`: es el patrón de React y no entra en bucle.
- `saveHomeDraft`: los avisos se calculan después del guardado y no lo bloquean.
- El aviso de vista previa: es accesible y el botón «Salir» mide 44 px.

## Pruebas

- Unitarias de `link-targets`: 6.
- E2E `home-editor-regression` (3), `home` y `studio` en verde.
