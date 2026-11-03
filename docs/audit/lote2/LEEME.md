# Lote 2 · correcciones visuales (2026-11-03)

Verificación: `tests/visual/lote2.spec.ts` (tienda en borrador con 6 categorías y 10 marcas, vista previa a 375 px).

| Punto                      | Antes [VERIFICADO]                                                                                                                                                            | Cambio                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a) Barra de categorías     | Al centrar el enlace activo, el borde izquierdo caía a media palabra. En `/marcas` se ocultaban 70 px de texto: «…nos» de «Pre‑entrenos», el mismo caso que «dos» de «Todos». | Detrás del interruptor `storefront_nav_scroll_fix` (apagado): el borde se alinea con el inicio de un enlace y la barra se acomoda al deslizarla. Al final de la lista agrega el espacio justo para alinear y, si aun así queda un corte, lo difumina. Con el interruptor encendido: 0 px cortados (el primer texto empieza a 16 px del borde). |
| b) «Buscar marca»          | Ya tenía ícono de lupa y el texto de ejemplo «Escribe el nombre de una marca»; 44 px de alto.                                                                                 | Ninguno.                                                                                                                                                                                                                                                                                                                                       |
| c) Aviso de vista previa   | Ya era una sola fila de 44 px en el celular, con «Salir de la vista previa» de 44 px.                                                                                         | Ninguno.                                                                                                                                                                                                                                                                                                                                       |
| d) Contraste, foco y 44 px | axe sin violaciones serias en la vista previa y en `/marcas`, con el interruptor apagado y encendido; enlaces de la barra ≥ 44 px.                                            | Ninguno.                                                                                                                                                                                                                                                                                                                                       |

Si viste b) o c) mal, probablemente fue en la vista previa de Vercel con una versión anterior del código: no la pude revisar porque falta acceso al equipo de Vercel.

## Capturas

- `antes/`: código sin el cambio.
- `despues/`: barra con el interruptor apagado (`barra-marcas-flag-apagado-375.png`, igual que antes) y encendido (`barra-marcas-flag-encendido-375.png`).

Con el interruptor apagado, las capturas de referencia (portada, listado, ficha, carrito, checkout, panel; 375 y 1280 px) son idénticas a la línea base, salvo el ruido conocido de `listado-375` y el nombre de la tienda del panel.

## Encender en una tienda de pruebas

```sql
insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
values ('storefront_nav_scroll_fix', 'store', '<id de la tienda>', true, 'Prueba del lote 2');
```

Apagar en todas las tiendas: `update public.feature_flags set kill_switch = true where key = 'storefront_nav_scroll_fix';`
