# Inventario de dependencias (SBOM) y licencias (2026-10-29)

Dependencias de producción resueltas con `pnpm licenses list --prod` sobre `pnpm-lock.yaml` (versiones exactas). Se regenera con el mismo comando.

## Resumen

| Licencia          | Paquetes | Lectura                                                                                                                                |
| ----------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| MIT               | 143      | Permisiva                                                                                                                              |
| OFL-1.1           | 10       | Fuentes tipográficas: libre uso y redistribución; no se venden sueltas                                                                 |
| Apache-2.0        | 9        | Permisiva (aviso de patentes)                                                                                                          |
| ISC               | 6        | Permisiva                                                                                                                              |
| BSD-2-Clause      | 4        | Permisiva                                                                                                                              |
| LGPL-3.0-or-later | 2        | libvips de `sharp`, enlazada dinámicamente como binario aparte: permitido sin abrir el código propio; se conserva el aviso de licencia |
| CC-BY-4.0         | 1        | Datos (caniuse): pide atribución, ya incluida en el paquete                                                                            |
| Unlicense         | 1        | Dominio público                                                                                                                        |
| BSD-3-Clause      | 1        | Permisiva                                                                                                                              |
| 0BSD              | 1        | Permisiva                                                                                                                              |

Sin licencias GPL o AGPL (copyleft fuerte) en producción.

## Titularidad del código

- El código vive en dos cuentas de GitHub: `angelit0486/Ecomerse` (donde se trabaja y despliega) y `angelii33/pruva` (remoto original, hoy sin acceso para la app de Claude, responde 403).
- El propietario debe **unificar la titularidad** en una sola cuenta u organización a su nombre (o de su empresa) antes de vender: transferir el repositorio, revisar colaboradores y conservar el historial.
- Parte del código fue escrito con asistencia de IA. PENDIENTE DE REVISIÓN por abogado: cesión de derechos y cláusulas para el contrato de venta (data room, `docs/venta/`).

## Lista completa

| Paquete                                   | Versión      | Licencia          |
| ----------------------------------------- | ------------ | ----------------- |
| `@babel/code-frame`                       | 7.29.7       | MIT               |
| `@babel/compat-data`                      | 7.29.7       | MIT               |
| `@babel/core`                             | 7.29.7       | MIT               |
| `@babel/generator`                        | 7.29.8       | MIT               |
| `@babel/helper-compilation-targets`       | 7.29.7       | MIT               |
| `@babel/helper-globals`                   | 7.29.7       | MIT               |
| `@babel/helper-module-imports`            | 7.29.7       | MIT               |
| `@babel/helper-module-transforms`         | 7.29.7       | MIT               |
| `@babel/helper-string-parser`             | 7.29.7       | MIT               |
| `@babel/helper-validator-identifier`      | 7.29.7       | MIT               |
| `@babel/helper-validator-option`          | 7.29.7       | MIT               |
| `@babel/helpers`                          | 7.29.7       | MIT               |
| `@babel/parser`                           | 7.29.9       | MIT               |
| `@babel/template`                         | 7.29.7       | MIT               |
| `@babel/traverse`                         | 7.29.8       | MIT               |
| `@babel/types`                            | 7.29.8       | MIT               |
| `@floating-ui/core`                       | 1.8.0        | MIT               |
| `@floating-ui/dom`                        | 1.8.0        | MIT               |
| `@floating-ui/react-dom`                  | 2.1.9        | MIT               |
| `@floating-ui/utils`                      | 0.2.12       | MIT               |
| `@fontsource-variable/dm-sans`            | 5.3.0        | OFL-1.1           |
| `@fontsource-variable/inter`              | 5.3.0        | OFL-1.1           |
| `@fontsource-variable/lora`               | 5.3.0        | OFL-1.1           |
| `@fontsource-variable/manrope`            | 5.3.0        | OFL-1.1           |
| `@fontsource-variable/montserrat`         | 5.3.0        | OFL-1.1           |
| `@fontsource-variable/oswald`             | 5.3.0        | OFL-1.1           |
| `@fontsource-variable/playfair-display`   | 5.3.0        | OFL-1.1           |
| `@fontsource-variable/space-grotesk`      | 5.3.0        | OFL-1.1           |
| `@fontsource-variable/work-sans`          | 5.3.0        | OFL-1.1           |
| `@fontsource/barlow-condensed`            | 5.3.0        | OFL-1.1           |
| `@img/colour`                             | 1.1.0        | MIT               |
| `@img/sharp-libvips-linux-x64`            | 1.3.4        | LGPL-3.0-or-later |
| `@img/sharp-libvips-linuxmusl-x64`        | 1.3.4        | LGPL-3.0-or-later |
| `@img/sharp-linux-x64`                    | 0.35.5       | Apache-2.0        |
| `@img/sharp-linuxmusl-x64`                | 0.35.5       | Apache-2.0        |
| `@jridgewell/gen-mapping`                 | 0.3.13       | MIT               |
| `@jridgewell/remapping`                   | 2.3.5        | MIT               |
| `@jridgewell/resolve-uri`                 | 3.1.2        | MIT               |
| `@jridgewell/sourcemap-codec`             | 1.6.0        | MIT               |
| `@jridgewell/trace-mapping`               | 0.3.31       | MIT               |
| `@next/env`                               | 16.4.1       | MIT               |
| `@next/swc-linux-x64-gnu`                 | 16.4.1       | MIT               |
| `@next/swc-linux-x64-musl`                | 16.4.1       | MIT               |
| `@playwright/test`                        | 1.56.1       | Apache-2.0        |
| `@radix-ui/number`                        | 1.1.3        | MIT               |
| `@radix-ui/primitive`                     | 1.1.7        | MIT               |
| `@radix-ui/react-accessible-icon`         | 1.1.15       | MIT               |
| `@radix-ui/react-accordion`               | 1.2.20       | MIT               |
| `@radix-ui/react-alert-dialog`            | 1.1.23       | MIT               |
| `@radix-ui/react-arrow`                   | 1.1.15       | MIT               |
| `@radix-ui/react-aspect-ratio`            | 1.1.15       | MIT               |
| `@radix-ui/react-avatar`                  | 1.2.6        | MIT               |
| `@radix-ui/react-checkbox`                | 1.3.11       | MIT               |
| `@radix-ui/react-collapsible`             | 1.1.20       | MIT               |
| `@radix-ui/react-collection`              | 1.1.15       | MIT               |
| `@radix-ui/react-compose-refs`            | 1.1.5        | MIT               |
| `@radix-ui/react-context`                 | 1.2.2        | MIT               |
| `@radix-ui/react-context-menu`            | 2.3.7        | MIT               |
| `@radix-ui/react-dialog`                  | 1.1.23       | MIT               |
| `@radix-ui/react-direction`               | 1.1.4        | MIT               |
| `@radix-ui/react-dismissable-layer`       | 1.1.19       | MIT               |
| `@radix-ui/react-dropdown-menu`           | 2.1.24       | MIT               |
| `@radix-ui/react-focus-guards`            | 1.1.6        | MIT               |
| `@radix-ui/react-focus-scope`             | 1.1.16       | MIT               |
| `@radix-ui/react-form`                    | 0.1.16       | MIT               |
| `@radix-ui/react-hover-card`              | 1.1.23       | MIT               |
| `@radix-ui/react-id`                      | 1.1.4        | MIT               |
| `@radix-ui/react-label`                   | 2.1.15       | MIT               |
| `@radix-ui/react-menu`                    | 2.1.24       | MIT               |
| `@radix-ui/react-menubar`                 | 1.1.24       | MIT               |
| `@radix-ui/react-navigation-menu`         | 1.2.22       | MIT               |
| `@radix-ui/react-one-time-password-field` | 0.1.16       | MIT               |
| `@radix-ui/react-password-toggle-field`   | 0.1.11       | MIT               |
| `@radix-ui/react-popover`                 | 1.1.23       | MIT               |
| `@radix-ui/react-popper`                  | 1.3.7        | MIT               |
| `@radix-ui/react-portal`                  | 1.1.17       | MIT               |
| `@radix-ui/react-presence`                | 1.1.10       | MIT               |
| `@radix-ui/react-primitive`               | 2.1.10       | MIT               |
| `@radix-ui/react-progress`                | 1.1.16       | MIT               |
| `@radix-ui/react-radio-group`             | 1.4.7        | MIT               |
| `@radix-ui/react-roving-focus`            | 1.1.19       | MIT               |
| `@radix-ui/react-scroll-area`             | 1.2.18       | MIT               |
| `@radix-ui/react-select`                  | 2.3.7        | MIT               |
| `@radix-ui/react-separator`               | 1.1.15       | MIT               |
| `@radix-ui/react-slider`                  | 1.4.7        | MIT               |
| `@radix-ui/react-slot`                    | 1.3.3        | MIT               |
| `@radix-ui/react-switch`                  | 1.3.7        | MIT               |
| `@radix-ui/react-tabs`                    | 1.1.21       | MIT               |
| `@radix-ui/react-toast`                   | 1.2.23       | MIT               |
| `@radix-ui/react-toggle`                  | 1.1.18       | MIT               |
| `@radix-ui/react-toggle-group`            | 1.1.19       | MIT               |
| `@radix-ui/react-toolbar`                 | 1.1.19       | MIT               |
| `@radix-ui/react-tooltip`                 | 1.2.16       | MIT               |
| `@radix-ui/react-use-callback-ref`        | 1.1.4        | MIT               |
| `@radix-ui/react-use-controllable-state`  | 1.2.6        | MIT               |
| `@radix-ui/react-use-effect-event`        | 0.0.5        | MIT               |
| `@radix-ui/react-use-escape-keydown`      | 1.1.5        | MIT               |
| `@radix-ui/react-use-is-hydrated`         | 0.1.3        | MIT               |
| `@radix-ui/react-use-layout-effect`       | 1.1.4        | MIT               |
| `@radix-ui/react-use-previous`            | 1.1.4        | MIT               |
| `@radix-ui/react-use-rect`                | 1.1.4        | MIT               |
| `@radix-ui/react-use-size`                | 1.1.4        | MIT               |
| `@radix-ui/react-visually-hidden`         | 1.2.11       | MIT               |
| `@radix-ui/rect`                          | 1.1.3        | MIT               |
| `@supabase/auth-js`                       | 2.117.2      | MIT               |
| `@supabase/functions-js`                  | 2.117.2      | MIT               |
| `@supabase/phoenix`                       | 0.4.5        | MIT               |
| `@supabase/postgrest-js`                  | 2.117.2      | MIT               |
| `@supabase/realtime-js`                   | 2.117.2      | MIT               |
| `@supabase/ssr`                           | 0.12.7       | MIT               |
| `@supabase/storage-js`                    | 2.117.2      | MIT               |
| `@supabase/supabase-js`                   | 2.117.2      | MIT               |
| `@swc/helpers`                            | 0.5.23       | Apache-2.0        |
| `@types/node`                             | 22.20.5      | MIT               |
| `@types/react`                            | 19.3.0       | MIT               |
| `@types/react-dom`                        | 19.3.0       | MIT               |
| `aria-hidden`                             | 1.2.6        | MIT               |
| `baseline-browser-mapping`                | 2.11.27      | Apache-2.0        |
| `browserslist`                            | 4.29.3       | MIT               |
| `caniuse-lite`                            | 1.0.30001814 | CC-BY-4.0         |
| `client-only`                             | 0.0.1        | MIT               |
| `convert-source-map`                      | 2.0.0        | MIT               |
| `cookie`                                  | 1.1.1        | MIT               |
| `csstype`                                 | 3.2.3        | MIT               |
| `dayjs`                                   | 1.11.23      | MIT               |
| `debug`                                   | 4.4.3        | MIT               |
| `detect-libc`                             | 2.1.2        | Apache-2.0        |
| `detect-node-es`                          | 1.1.0        | MIT               |
| `dom-serializer`                          | 3.1.1        | MIT               |
| `domelementtype`                          | 3.0.0        | BSD-2-Clause      |
| `domhandler`                              | 6.0.1        | BSD-2-Clause      |
| `domutils`                                | 4.0.2        | BSD-2-Clause      |
| `electron-to-chromium`                    | 1.5.444      | ISC               |
| `entities`                                | 8.1.0        | BSD-2-Clause      |
| `escalade`                                | 3.2.0        | MIT               |
| `escape-string-regexp`                    | 4.0.0        | MIT               |
| `gensync`                                 | 1.0.0-beta.2 | MIT               |
| `get-nonce`                               | 1.0.1        | MIT               |
| `htmlparser2`                             | 12.0.0       | MIT               |
| `iceberg-js`                              | 0.8.1        | MIT               |
| `is-plain-object`                         | 5.1.0        | MIT               |
| `js-tokens`                               | 4.0.0        | MIT               |
| `jsesc`                                   | 3.1.0        | MIT               |
| `json5`                                   | 2.2.3        | MIT               |
| `launder`                                 | 1.7.2        | MIT               |
| `lru-cache`                               | 5.1.1        | ISC               |
| `ms`                                      | 2.1.3        | MIT               |
| `nanoid`                                  | 3.3.19       | MIT               |
| `next`                                    | 16.4.1       | MIT               |
| `node-releases`                           | 2.0.57       | MIT               |
| `parse-srcset`                            | 1.0.2        | MIT               |
| `picocolors`                              | 1.1.1        | ISC               |
| `playwright`                              | 1.56.1       | Apache-2.0        |
| `playwright-core`                         | 1.56.1       | Apache-2.0        |
| `postcss`                                 | 8.5.23       | MIT               |
| `postcss`                                 | 8.5.28       | MIT               |
| `postgres`                                | 3.4.9        | Unlicense         |
| `radix-ui`                                | 1.6.7        | MIT               |
| `react`                                   | 19.3.0       | MIT               |
| `react-dom`                               | 19.3.0       | MIT               |
| `react-remove-scroll`                     | 2.7.2        | MIT               |
| `react-remove-scroll-bar`                 | 2.3.8        | MIT               |
| `react-style-singleton`                   | 2.2.3        | MIT               |
| `sanitize-html`                           | 2.18.1       | MIT               |
| `scheduler`                               | 0.28.0       | MIT               |
| `semver`                                  | 6.3.1        | ISC               |
| `semver`                                  | 7.8.5        | ISC               |
| `server-only`                             | 0.0.1        | MIT               |
| `sharp`                                   | 0.35.5       | Apache-2.0        |
| `source-map-js`                           | 1.2.2        | BSD-3-Clause      |
| `styled-jsx`                              | 5.1.6        | MIT               |
| `tslib`                                   | 2.8.1        | 0BSD              |
| `undici-types`                            | 6.21.0       | MIT               |
| `update-browserslist-db`                  | 1.3.3        | MIT               |
| `use-callback-ref`                        | 1.3.3        | MIT               |
| `use-sidecar`                             | 1.1.3        | MIT               |
| `yallist`                                 | 3.1.1        | ISC               |
| `zod`                                     | 4.6.6        | MIT               |
