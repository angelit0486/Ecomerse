# Línea base del proyecto (2026-10-29)

Medida sobre el commit `d09406a`, sin cambiar código, en el contenedor de desarrollo y en los servicios en línea. Cada suite corrió **dos veces** para detectar pruebas inestables.

Etiquetas: **[VERIFICADO]** = comprobado aquí con evidencia; **[NO VERIFICADO]** = no se pudo comprobar.

## Semáforo

| Área                   | Estado | Resumen                                                                                                                                                       |
| ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pruebas locales        | 🟢     | Las cuatro suites, en verde las dos veces y con las mismas cifras: no hay pruebas inestables                                                                  |
| Entorno local          | 🟡     | Se levanta, pero Storage tarda más que la espera del script en un contenedor recién encendido; hubo que correr `stack.sh up` otra vez                         |
| Git y GitHub           | 🟡     | Todo subido y el push funciona; el repo de destino es **público** y el remoto `angelii33/pruva` da 403                                                        |
| CI (GitHub Actions)    | 🟢     | 125 corridas; la última, verde en sus 4 trabajos                                                                                                              |
| Staging: base de datos | 🔴→🟢  | Le faltaban **16 migraciones**. Se aplicaron el mismo día (prompt siguiente): ver «Después de la línea base»                                                  |
| Staging: Vercel        | 🔴     | Sin acceso: el conector no tiene permiso sobre el equipo y la red del contenedor bloquea `*.vercel.app`. Último despliegue, logs y variables: [NO VERIFICADO] |
| Supabase: avisos       | 🟡     | Ningún error en los registros de 24 h; avisos de seguridad y rendimiento conocidos (abajo)                                                                    |
| Correo real            | 🔴     | Sin Resend: no sale ningún correo en staging; no se puede entrar al panel de la vista previa                                                                  |

## 1. Pruebas (dos corridas)

| Suite                                    | Corrida 1      | Corrida 2      | Evidencia                              |
| ---------------------------------------- | -------------- | -------------- | -------------------------------------- |
| `pnpm verify` (lint, tipos, unit, build) | 1,043/1,043 ✅ | 1,043/1,043 ✅ | 115 archivos de unitarias [VERIFICADO] |
| pgTAP                                    | 2,571/2,571 ✅ | 2,571/2,571 ✅ | 115 archivos [VERIFICADO]              |
| Integración                              | 375/375 ✅     | 375/375 ✅     | 30 archivos [VERIFICADO]               |
| E2E (Playwright + axe)                   | 117/117 ✅     | 117/117 ✅     | 17.6–18.5 min por corrida [VERIFICADO] |

Nota de honestidad: mientras corría la E2E se agregó una prueba nueva (`schema-version.spec.ts`, del prompt siguiente) y entró a la corrida. Esa prueba falló en las dos vueltas porque la app compilada y la base local aún no tenían su migración. **Las 117 del commit `d09406a` pasaron en ambas**; la nueva se corrió aparte después de aplicar su migración.

## 2. Git

| Dato                   | Valor                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Rama local             | `claude/carga-imagenes-lote` (nombre antiguo); se sube a `claude/ecommerce-regulated-platform-41vu1e`             |
| Último commit al medir | `d09406a` · 2026-10-29 16:46 UTC · «Fase 4: E2E completa 117/117 en el informe»                                   |
| Commits sin subir      | 0 [VERIFICADO con `git rev-list`]                                                                                 |
| Push                   | Funciona a `angelit0486/Ecomerse` [VERIFICADO]; `angelii33/pruva` responde 403 (la app de GitHub no tiene acceso) |
| Repositorio de destino | **Público**: cualquiera puede leer el código (no hay secretos en el historial)                                    |
| CI                     | 125 corridas del flujo `CI`; la 125 (`d09406a`) verde en verify, base de datos, stack+E2E y secretos [VERIFICADO] |

## 3. Staging

| Dato                        | Valor                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Proyecto Supabase           | `pruva-staging` (`epgiglysldwoiulnwamf`), us-east-1, PostgreSQL 17, saludable [VERIFICADO]                                                      |
| Versión del esquema         | `20261025000100`; **faltaban 16 migraciones** (`20261027000100` a `20261029000800`) [VERIFICADO]                                                |
| Registro de migraciones     | 120 filas; 116 coinciden por sha256 con el repo; 4 (`20261018000800` a `001100`) registradas sin huella                                         |
| `MIGRATION_DATABASE_URL`    | No configurada en la práctica (las migraciones no se aplicaban solas). En Vercel: [NO VERIFICADO]                                               |
| Último despliegue de Vercel | [NO VERIFICADO]: sin acceso al equipo `angelit0486s-projects`                                                                                   |
| Errores en registros (24 h) | Supabase: 0 con severidad de error en API, base, Auth y Storage [VERIFICADO]. Vercel: [NO VERIFICADO]                                           |
| Tablas temporales           | `supabase_migrations.pruva_fetch` (86 filas), `pruva_pending_migration` (6), `pruva_pending_chunk` (0). Esperan la confirmación del propietario |

### Avisos de Supabase (advisors)

| Aviso                                                        | Nivel | Cantidad | Lectura                                                                                |
| ------------------------------------------------------------ | ----- | -------- | -------------------------------------------------------------------------------------- |
| Funciones `SECURITY DEFINER` ejecutables por `authenticated` | WARN  | 163      | Por diseño: las RPC del panel; cada una pasa por un guardián de permisos (metatest 15) |
| Extensión `pg_net` en `public`                               | WARN  | 1        | Mover a `extensions` (aprobado; la confirmación de Supabase quedó sin responder)       |
| Protección de contraseñas filtradas apagada                  | WARN  | 1        | Activarla en Supabase → Auth (lo hace el propietario)                                  |
| RLS activo sin políticas                                     | INFO  | 40       | Por diseño: tablas que solo tocan funciones del sistema (carritos, ajustes, cola…)     |
| Llaves foráneas sin índice                                   | INFO  | 74       | Revisar con datos reales; hoy no afecta                                                |
| Índices sin uso                                              | INFO  | 104      | Normal en una base casi vacía                                                          |
| Varias políticas permisivas en `customers`                   | WARN  | 2        | Política del comprador + de la tienda; correcto, con costo menor                       |
| Tabla sin llave primaria (`system.auth_login_intents`)       | INFO  | 1        | Revisar en una migración futura                                                        |

## 4. Lo que estaba en rojo y qué pasó después

1. **16 migraciones faltantes en staging:** aplicadas el 2026-10-29 con verificación sha256. Después se aplicó también `20261029000900`, que hace que la tienda muestre «Tienda en mantenimiento» en lugar de una pantalla rota. El registro coincide con el repositorio [VERIFICADO].
2. **Vercel sin acceso:** falta que el propietario apruebe el acceso del conector al equipo.
3. **Correo real (Resend):** falta la cuenta, el dominio y la clave del propietario. Sin esto no se puede entrar al panel de la vista previa.
4. **Repositorio público:** conviene hacerlo privado antes de vender; si se hace, las migraciones de staging pasan a `MIGRATION_DATABASE_URL`.
