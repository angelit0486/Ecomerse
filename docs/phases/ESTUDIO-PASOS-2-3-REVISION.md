# Estudio de tiendas · Revisión adversarial de los Pasos 2 y 3

**Fecha:** 2026-10-21 · **Alcance:** commits `5f162d7`..`a0c51a8` (migraciones `20261020000200` a `20261021000400` y el código del panel y la tienda que las usa) · **Revisor:** agente independiente con lectura del código, sin poder modificarlo; las correcciones y sus pruebas son de esta sesión.

## Resultado

- **Sin fugas ni escrituras entre tiendas.** Toda función nueva `security definer` tiene `search_path = ''` y `revoke … from public`; las de `system.*` solo para `system_worker`; ninguna con permisos para `anon`.
- **Tablas nuevas:** `store_theme_versions` y `store_redirects` con RLS forzado, `prevent_tenant_change`, `UNIQUE (store_id, id)` y FK compuestas.
- **Sin llamadas de red dentro de transacciones** y **sin secretos ni PII en los logs** de dominios.
- **Autoridad:** el panel no puede marcar un dominio como verificado ni saltarse el bloqueo de productos de ejemplo.
- **HTML de la tienda:** el HTML enriquecido se sanea al pintarlo (`SafeHtml`).
- **Video:** la fachada usa host fijo e id validado.
- **CSP:** solo agrega `youtube-nocookie.com` y `player.vimeo.com`.

| #   | Severidad  | Hallazgo                                                                                                                                                                                                               | Estado                                                                                                                                              |
| --- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1 | Media-alta | **Acaparamiento de dominios.** Otra tienda podía dejar un hostname «pendiente» o soltarlo, y así quedaba bloqueado para siempre.                                                                                       | **Mitigado.** Un hostname quitado o vencido en otra tienda se libera. Uno pendiente ajeno sigue apartado: **decisión del propietario** (ver abajo). |
| R-2 | Media      | **Revisiones de DNS paralelas.** Cada «Verificar ahora» abría otra cadena de revisiones del DNS y del proveedor.                                                                                                       | **Corregido.** Una sola revisión en cola por dominio; las demás la adelantan (pgTAP 89, integración `domains-verify`).                              |
| R-3 | Media      | **Revisión detenida por fallos pasajeros.** Un fallo de DNS o del proveedor mataba la revisión, y el dominio se quedaba «en verificación» para siempre. Además, «Verificar ahora» no hacía nada en un dominio vencido. | **Corregido.** El handler registra el fallo como «aún no» y la base reprograma la revisión. Verificar un dominio vencido reinicia su ventana.       |
| R-4 | Baja-media | **Alta en el proveedor antes de demostrar la propiedad.** El dominio se agregaba al proyecto de Vercel antes de comprobar el TXT.                                                                                      | **Corregido.** Primero se compara el TXT (`system.domains_txt_matches`); el dominio se agrega al proveedor solo si coincide.                        |
| R-5 | Baja       | **Dominios sin seguimiento.** Un dominio activo no se vuelve a verificar. Al quitarlo, no se retira del proveedor.                                                                                                     | **Pendiente.** Requiere un `remove` en `DomainProvider` y una revisión periódica, y no se puede probar sin el token real de Vercel.                 |
| R-6 | Baja       | **Dominio raíz sin configurar.** Sin `storefront.root_domain` se saltaba la guarda del dominio de la plataforma.                                                                                                       | **Corregido.** Sin ese dato no se aceptan dominios.                                                                                                 |
| R-7 | Baja       | **Concurrencia al elegir el dominio principal.** Dos peticiones a la vez en `domains_set_primary` devolvían un 23505 crudo.                                                                                            | **Corregido.** La función bloquea las filas de la tienda.                                                                                           |
| R-8 | Baja       | **Etiqueta «ejemplo» sola.** Bastaba la etiqueta para borrar un producto propio y bloquear el lanzamiento.                                                                                                             | **Corregido.** Hacen falta la etiqueta y el título «Ejemplo · …» que pone la base.                                                                  |
| R-9 | Baja       | **Importar diseño borraba contenido.** Se perdían el anuncio y los accesos rápidos del encabezado.                                                                                                                     | **Corregido.** Del encabezado solo se lleva `logo_position`.                                                                                        |

Hallazgos del propio cierre de pasos (no del revisor):

- **Redirecciones.** El panel convertía una URL externa en «Llevar a» en una ruta interna. **Corregido:** solo se convierte la dirección vieja; el destino debe ser una ruta y la base rechaza el resto.
- **404 del panel.** Con `loading.tsx` (Paso 1), un 404 llega con código 200 y la pantalla «No encontramos esta página», porque la respuesta ya va en streaming. En el panel (noindex) solo cambia el código; la tienda no tiene `loading.tsx` y sus 404 siguen siendo 404.

## Decisión pendiente del propietario (R-1)

Hoy cada hostname es único en toda la plataforma (ADR-011), y una tienda que lo agrega lo aparta mientras lo verifica. La alternativa es que la unicidad aplique solo a dominios **activos**, y que gane quien demuestre primero el TXT. Así nadie puede apartar el dominio de otro, pero cambia ADR-011, y por eso no lo hice sin tu aprobación.

## Pruebas

| Suite                | Antes (Paso 1) | Ahora                                                                                |
| -------------------- | -------------- | ------------------------------------------------------------------------------------ |
| Unitarias (`verify`) | 819            | 837                                                                                  |
| pgTAP                | 2123           | 2202                                                                                 |
| Integración          | 316            | 319                                                                                  |
| E2E nuevas           | —              | `store-templates`, `theme-move`, `custom-domain`, `two-stores`, `redirects-designer` |
