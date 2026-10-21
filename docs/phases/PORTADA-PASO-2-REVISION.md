# Revisión adversarial · Misión Portada/Marcas · Paso 2 (fotos y logos de marcas)

Fecha: 2026-10-21. Alcance: commits 468c5b8 (panel y tienda de marcas) y 3a664a3 (CSV con logo y descripción).
Enfoque: seguridad, XSS, aislamiento entre tiendas, permisos, pérdida de datos y uso en el celular.

## Resultado

- **Sin hallazgos de seguridad ni de aislamiento.** Todas las escrituras pasan por funciones
  `SECURITY DEFINER` con `app.require_store_permission(…, 'brands.manage')`; las imágenes se validan
  por `store_id` y `owner_type = 'brand'`; las FK compuestas impiden apuntar a medios de otra tienda
  (pgTAP 92). La descripción se pinta como texto (React escapa) y el sitio web exige `https` y
  `rel="noopener noreferrer nofollow"`.
- 2 altos, 4 medios y 5 bajos. Corregidos todos menos B10 y B11 (abajo, con su porqué).

## Corregidos

| ID  | Severidad | Qué pasaba                                                                                                                                                  | Arreglo                                                                                                                                                             | Prueba                                                           |
| --- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A1  | Alta      | Una descripción con caracteres de control en el CSV hacía fallar el `CHECK` dentro de `import_apply_brand_profiles` y tumbaba la importación ya confirmada. | La función normaliza como `catalog_upsert_brand` y omite la descripción inválida; el planificador TS la marca como error de fila («tiene caracteres invisibles»).   | pgTAP 94 (2), `products.test.ts`                                 |
| A2  | Alta      | Reimportar un CSV con otro enlace reemplazaba un logo ya listo (subido a mano desde el panel).                                                              | Un logo listo nunca se reemplaza desde el archivo; se cuenta en `totals.brand_logos_kept`. Para cambiarlo, el panel.                                                | pgTAP 94                                                         |
| M3  | Media     | Un logo del archivo que se rechazó (enlace roto) no se podía reintentar con el mismo CSV.                                                                   | Se reintenta y el intento anterior se borra (soft).                                                                                                                 | pgTAP 94 (2)                                                     |
| M4  | Media     | Cambiar o quitar el logo o la portada dejaba la imagen anterior huérfana (contaba en la cuota).                                                             | `catalog_set_brand_media` borra (soft) la anterior si ninguna marca la usa; la purga la quita a los 7 días.                                                         | pgTAP 94 (2), E2E `brands.spec.ts`                               |
| M5  | Media     | Renombrar una marca desde su ficha cambiaba su dirección (`/marca/…`) y rompía enlaces guardados.                                                           | El formulario envía el `slug` actual; renombrar no cambia la dirección.                                                                                             | E2E `brands.spec.ts`                                             |
| M6  | Media     | En la subida en lote, un archivo que fallaba dejaba el botón bloqueado («Subiendo…») y los demás sin subir.                                                 | `try/catch` por archivo y `finally`; cada archivo dice si falló. Vista previa con `catch`.                                                                          | Revisado en el código (sin prueba automática de un fallo de red) |
| B7  | Baja      | Dos archivos asignados a la misma marca: el segundo pisaba al primero sin avisar.                                                                           | Las coincidencias repetidas quedan sin asignar y, si se eligen a mano, aparece «Elegiste la misma marca para dos archivos. Deja una sola.» y el botón se desactiva. | E2E `brands.spec.ts`                                             |
| B8  | Baja      | Los cambios de marca hechos por la importación no quedaban en la auditoría.                                                                                 | `brand.saved` y `brand.media_set` con `import_job_id`.                                                                                                              | pgTAP 94                                                         |
| B9  | Baja      | Sitio web con mayúsculas en el dominio quedaba distinto al validado; zona de soltar sin foco visible; lista de archivos sin anuncio.                        | Dominio en minúsculas; contorno con `focus-within`; lista con `aria-live`.                                                                                          | E2E (axe)                                                        |

## No corregidos (y por qué)

- **B10** — `media_delete` sobre una imagen de marca no limpia `cover_media_id`/`logo_media_id`.
  Inofensivo: la tienda solo pinta medios `ready` y no borrados, así que la marca cae a sus iniciales.
  Desde el panel ya no se llega a ese caso (se quita con «Quitar», que sí limpia). Se revisa en el Paso 5.
- **B11** — El recorte se hace en el navegador (canvas → WebP); un navegador sin WebP en canvas sube PNG,
  más pesado. El worker vuelve a codificar, así que el peso final es el mismo. Sin acción.

## Verificación

- `pnpm verify`: 96 archivos, 901 pruebas, build OK.
- pgTAP 92, 93 y 94 contra PostgreSQL local: OK.
- E2E `brands.spec.ts` (ampliada con B7, M5 y M4) e `imports.spec.ts`: 3/3 con la build actual, en el stack local.
- Pendiente de staging: migraciones `20261023000100`, `…0200` y `…0400` (las aplica la propietaria).
