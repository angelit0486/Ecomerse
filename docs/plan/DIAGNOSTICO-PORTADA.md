# Diagnóstico de la portada: «ya no puedo editarla»

**Fecha:** 2026-10-21. **Alcance:** las tiendas `demo` y `demo2` de staging (`pruva-staging`) y el editor Apariencia → Portada.

**Fuentes (solo lectura):**

- `store_themes` de staging.
- Registros de Supabase de las últimas 24 h: Postgres y API.
- Reproducción local con los mismos datos (E2E `home-editor-regression`, a 375 y 1280 px).

## Resumen

No hay una sola falla: hay **una causa de acceso** (demo2) y **dos de uso** (demo), además de un desfase de versiones que ya quedó resuelto.

| #   | Tienda | Causa raíz                                                                                                                                                                                                                                                                                                        | Evidencia                                                                                                                                                                                                                                  | Estado                                                                                                                                                                                                                                                                                                       |
| --- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | demo2  | **La dueña no tiene acceso a demo2.** demo2 vive en «Organización demo2», cuya única dueña es una cuenta de ejemplo (`dem…@example.test`) que nunca inició sesión. La cuenta real (`alm…@gmail.com`) solo pertenece a «Organización demo». Desde su panel no puede abrir demo2, así que su portada «parece fija». | `organization_members` en staging. demo2 tiene `draft_revision = 3` (nadie la ha editado) y su portada publicada sigue siendo la del sembrado: título, imagen con envases «EJEMPLO» y botón «Ver productos», todo editable desde el panel. | **Pendiente de tu autorización:** dar acceso cambia permisos de staging. Opciones en «Lo que necesito de ti».                                                                                                                                                                                                |
| R2  | demo   | **La portada principal estaba oculta y no se notaba.** El bloque decía «(oculta)» en letra gris y el botón «Mostrar» estaba entre cinco botones pequeños. Hoy a las 21:00 la dueña agregó **otra** portada principal en lugar de volver a mostrar la suya.                                                        | Borrador actual: `hero:false, hero:true, …`. La publicada tiene la portada principal con `enabled:false`.                                                                                                                                  | **Corregido.** El bloque oculto se ve punteado y con la leyenda «Oculto: tus clientes no ven este bloque»; «Mostrar …» es el botón principal. Un aviso arriba ofrece «Mostrar la portada principal» y otro avisa si hay dos visibles. Prueba unitaria `hero-notice.test.tsx` y E2E `home-editor-regression`. |
| R3  | demo   | **El botón llevaba a una página que no existe.** La dueña escribió `/plumas`; la categoría es `/categoria/plumas`. El campo aceptaba cualquier ruta y el comprador terminaba en «No encontrado».                                                                                                                  | Borrador actual: `cta.link = "/plumas"`.                                                                                                                                                                                                   | **Corregido.** El campo sugiere las páginas reales de la tienda (lista desplegable) y avisa en vivo «¿Quisiste decir «/categoria/plumas»?». Al guardar se repite el aviso por bloque. Es un aviso y no bloquea: un rol sin permiso de SEO no ve las redirecciones. Pruebas `link-targets.test.ts` y E2E.     |
| R4  | ambas  | **El panel publicado era más viejo que la base.** Del 20 de octubre a las 22:11 hasta hoy a las 20:05 (UTC), Vercel servía el commit `7458583`, anterior al tema v2 (ADR-034). La base ya tenía parte del tema v2 y le faltaban 9 migraciones.                                                                    | Lista de despliegues de Vercel y `supabase_migrations.schema_migrations`.                                                                                                                                                                  | **Resuelto hoy:** se aplicaron las 9 migraciones y se desplegó `28a16e7`. Desde entonces la dueña guardó la portada sin errores (21:00). Falta el aviso de versión de esquema al arrancar el panel (Paso 5).                                                                                                 |

## Lo que se descartó (con evidencia)

- **Datos inválidos:** el tema y la portada de demo y demo2 pasan `ThemeSettingsV2`, `HomeSectionsV2`, `app.theme_reference_issues` y `app.home_compliance_issues` sin problemas.
- **Errores de base o de API en la portada:** cero en 24 h. Los únicos `400` son de ofertas programadas (`starts_at`, 4 veces, ver abajo) y de publicar un producto sin clasificación sanitaria.
- **Caché sin invalidar:** «Publicar» invalida el tag `store:{id}` (`publishTheme` → `invalidateStore`). Ya lo probaba la E2E `home`.
- **Guardado roto:** con los datos de demo, el editor guarda en el celular y en la computadora (E2E `home-editor-regression`).

## Reproducción (antes de la corrección)

1. Tienda con la portada principal oculta, rieles por un filtro, categorías y un borrador del tema con anuncio y emojis (la E2E siembra exactamente eso).
2. Panel → Apariencia → Portada, a 375 px.
3. El bloque oculto apenas se distingue; no hay ningún aviso. Escribir `/plumas` en «Enlace del botón» y guardar: «Portada guardada» sin aviso, y la tienda lleva a «No encontrado».

## Otros hallazgos de los registros (para el Paso 5)

- **Ofertas programadas:** 4 rechazos seguidos por `starts_at` («El inicio no puede estar en el pasado»). El selector de fecha permite elegir horas ya pasadas. Se corregirá con un mínimo en la hora de la tienda.
- **Tiempo agotado** de una consulta de la tienda (`storefront_gateway`, 21:04). Se investiga en el Paso 5.

## Lo que necesito de ti (se agrupa al final)

- **R1:** ¿te doy acceso a demo2? Hay dos opciones; las dos cambian permisos de staging, por eso espero tu autorización:
  - (a) agregar tu cuenta como dueña de «Organización demo2»;
  - (b) mover demo2 a tu organización. Esta requiere una función nueva de plataforma y su ADR.
- **Cuenta de plataforma:** no hay ninguna en staging, así que «Agregar tienda» no se puede usar. ¿Autorizas darle a tu cuenta el rol `platform_owner`?
