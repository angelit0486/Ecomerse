# PRUVA — Informe maestro de estado (Orden 08, 2026-11-12)

## Base de este informe

- **Código**: rama `audit/hardening-capacity-2026-11`, commit `cc7a855` (370 commits en su historia).
- **Staging**: consultas de **solo lectura** del 2026-11-12. Proyecto Supabase `pruva-staging`; despliegues de Vercel del proyecto `ecomerse`.
- **Respetado**: no se cambió código, base de datos ni configuración. No se ejecutó nada en staging que escriba.
- **Tienda `demo`**: se ignoró, como pide el propietario. Los totales de staging son de toda la base.

**Documentos complementarios** (todos en `docs/audit/`):

- `PRUVA_FEATURE_INVENTORY.md`: 98 funcionalidades, cada una con estado y evidencia.
- `PRUVA_TRACEABILITY_MATRIX.md`: 35 requisitos trazados.
- `PRUVA_TECHNICAL_DEBT_AND_RISKS.md`: riesgos, defectos y deuda.
- `PRUVA_COMMERCIAL_READINESS.md`: proceso de entrega y brechas comerciales.
- `PRUVA_COMPLETION_ROADMAP.md`: 28 tareas con dependencias.
- `PRUVA_NEXT_PROMPT_CONTEXT.md`: contexto autosuficiente para el siguiente superprompt.

**Etiquetas.**

- **[VERIFICADO]**: lo comprobé hoy.
- **[MEDIDO]**: cifra de una prueba ejecutada, con fecha y commit.
- **[ESTIMADO]**: deducido del código o de mediciones.
- **[PROPUESTO]**: aún no hecho.
- **[NO VERIFICADO]**: sin acceso o sin servicio real.

---

## Capítulo 01 — Resumen ejecutivo

**Qué es.** PRUVA es una plataforma de comercio electrónico **multiempresa y de marca blanca**: Organización → Tienda. Con ella, un operador da de alta tiendas en línea para comercios físicos de México. Cada tienda tiene su dirección, su identidad visual, su catálogo, sus pedidos y su propia cuenta de cobro: el dinero va directo al comercio.

**Para quién.** Comercios físicos que quieren vender en línea sin conocimientos técnicos. Los giros objetivo (propietario, 2026-11-12) son:

- ropa, calzado y accesorios;
- hogar, belleza y regalos;
- abarrotes y suplementos pequeños.

En los tres casos, hasta 10,000 productos por tienda.

**Qué existe** [VERIFICADO]:

- 72,758 líneas de TypeScript, 167 migraciones SQL y 89 pantallas;
- 98 funcionalidades inventariadas: 84 implementadas, 3 parciales y 11 ausentes;
- 4,850 pruebas automatizadas que pasan en la última corrida completa (commit `87622f2`, 2026-11-12):
  - 1,280 unitarias;
  - 2,983 pgTAP;
  - 438 de integración;
  - 149 de 149 E2E.

**Qué tan cerca está de venderse.** La base técnica es sólida y está medida:

- aislamiento entre tiendas con 0 fugas en 11,220 intentos;
- 500,000 productos en 50 tiendas sin degradación para el comprador (local);
- importación de 10,000 productos con fallas y reintentos, sin duplicados.

Sin embargo, **nada que toque dinero o correo real se ha probado**, y **no existe un entorno de producción**.

### Dictamen: **NO APTO TODAVÍA**

| Motivo                                                                                                       | Evidencia      |
| ------------------------------------------------------------------------------------------------------------ | -------------- |
| No hay producción; staging tiene datos de demostración y está en el plan gratuito, sin respaldos automáticos | RSK-01, RSK-08 |
| Nunca ha salido un correo real: sin confirmación de pedido ni código de acceso por correo                    | RSK-02         |
| Mercado Pago solo probado con simulador; 0 pedidos y 0 pagos en staging [VERIFICADO 2026-11-12]              | RSK-03         |
| La cola de trabajos de staging está atascada desde 2026-11-10 19:34 UTC, con cron diario                     | RSK-04         |
| Staging va 5 migraciones detrás del código: los defectos de escala corregidos siguen en staging              | RSK-06, RSK-07 |
| Textos legales sin revisar                                                                                   | RSK-09         |

Ninguno es un defecto de diseño. Cerrando la fase 0 y la fase 1 del roadmap (RM-01 a RM-09), el dictamen pasa a **APTO SOLO PARA PILOTOS CONTROLADOS** con catálogos de hasta ~1,000 productos. Llegar a 10,000 productos en cinco días exige además la fase 2 (RM-10 a RM-16).

---

## Capítulo 02 — Objetivo y alcance final

**Visión.** Visitar un comercio, ofrecerle PRUVA y entregarle en cinco días hábiles una tienda configurada y operando, que el comerciante pueda manejar solo.

**Usuarios.**

| Usuario                             | Qué hace                                                     | Dónde                |
| ----------------------------------- | ------------------------------------------------------------ | -------------------- |
| Operador de la plataforma           | Da de alta organizaciones y tiendas, planes, soporte y salud | `/platform`          |
| Dueña o administradora de la tienda | Catálogo, apariencia, pedidos, equipo y cobro                | `/admin/[tienda]`    |
| Personal con rol                    | Catálogo, pedidos, inventario, diseño o solo lectura         | `/admin/[tienda]`    |
| Comprador                           | Compra, sigue su pedido y pide devoluciones                  | Dominio de la tienda |

**Alcance confirmado** (decisiones aprobadas, `docs/DECISIONS.md`):

- productos físicos con variantes;
- México: pesos, IVA incluido y es-MX;
- Mercado Pago por tienda con OAuth (ADR-041) y transferencia;
- envíos por zona;
- devoluciones (ADR-061);
- plantillas por giro (ADR-034);
- dominio propio (ADR-037);
- importación con fotos por enlace (ADR-033) e importar solo lo válido (ADR-040);
- cobro de planes con Stripe Billing (ADR-044);
- guías con Skydropx (ADR-057) y CFDI con Facturapi (ADR-058): aprobados, sin cuenta de pruebas.

**Fuera de alcance por decisión.**

- Alta autoservicio (ADR-045, no aprobado).
- OXXO y transferencia de Mercado Pago (ADR-059 A, quitados).
- Lista de categorías bloqueadas (ADR-053, rechazado).
- Política de contenido (ADR-042, aplazado).
- Colecciones y cupones por producto (ADR-035 y ADR-036, pospuestos).

**Propuestas sin aprobar.** ADR-023 (paquetes), ADR-027 (lotes y caducidad), ADR-051, ADR-052, ADR-054 y ADR-055.

**Posibles ampliaciones.**

- Productos digitales y servicios (el modelo de datos lo admite; F-29).
- Tiendas de más de 10,000 productos (CAP-12).
- Otros países.

**Requisitos no funcionales.**

| Requisito                          | Fuente         | Estado          |
| ---------------------------------- | -------------- | --------------- |
| Aislamiento estricto               | GATE0 §44      | Medido          |
| Dinero en centavos `bigint`        | Regla 14       | Implementado    |
| Cálculo de totales en el servidor  | Regla 8        | Implementado    |
| Pagos solo por webhook verificado  | Regla 11       | Implementado    |
| Migraciones aditivas               | Regla 17       | Implementado    |
| Accesibilidad sin problemas serios | axe en las E2E | Medido          |
| 10,000 productos por tienda        | Objetivo       | Medido en local |
| Meta global de 5 millones          | Objetivo       | Sin medir       |
| Entrega en cinco días              | Objetivo       | Sin medir       |

---

## Capítulo 03 — Inventario completo de lo construido

El detalle está en `PRUVA_FEATURE_INVENTORY.md`: 98 filas con objetivo, estado, evidencia, despliegue, operatividad, dependencias, pendiente y prioridad. Resumen por módulo:

| Módulo                                 | Implementado | Parcial o ausente                      | Lo más importante                                                      |
| -------------------------------------- | ------------ | -------------------------------------- | ---------------------------------------------------------------------- |
| Plataforma y tiendas (F-01 a F-11)     | 10           | 1 ausente (autoservicio, por decisión) | Ningún plan admite 10,000 productos                                    |
| Acceso y equipo (F-12 a F-16)          | 5            | —                                      | El código por correo no llega sin Resend                               |
| Catálogo e inventario (F-17 a F-31)    | 11           | 1 parcial, 3 ausentes                  | Solo productos físicos; suplementos bloqueados por reglas sin capturar |
| Importaciones (F-32 a F-40)            | 6            | 1 parcial, 2 ausentes                  | 5,000 filas por archivo; no crea categorías                            |
| Imágenes (F-41 a F-44)                 | 4            | —                                      | La cola procesa una foto a la vez; cron diario                         |
| Tienda pública (F-45 a F-51)           | 7            | —                                      | Búsqueda y filtros rápidos solo en la rama                             |
| Apariencia (F-52 a F-56)               | 5            | —                                      | 14 plantillas por giro                                                 |
| Checkout, pagos y envíos (F-57 a F-68) | 8            | 1 parcial, 3 ausentes                  | Mercado Pago solo simulado                                             |
| Pedidos y clientes (F-69 a F-76)       | 8            | —                                      | Completo para operar                                                   |
| Correos (F-77 a F-80)                  | 4            | —                                      | Nunca ha salido uno real                                               |
| Reportes y ayuda (F-81 a F-85)         | 5            | —                                      | Rentabilidad solo en la rama                                           |
| Seguridad (F-86 a F-91)                | 6            | —                                      | 0 fugas en T06                                                         |
| Operación (F-92 a F-98)                | 5            | 2 ausentes                             | Sin producción ni Sentry; cola atascada                                |

---

## Capítulo 04 — Arquitectura tecnológica

**Stack** [VERIFICADO en `package.json`, `.nvmrc` y en el proyecto de Supabase]:

| Componente                                | Versión                                |
| ----------------------------------------- | -------------------------------------- |
| Node                                      | 24 (`>=24.0.0 <25`)                    |
| pnpm                                      | 10.28.0                                |
| Next.js                                   | 16.4.1 (App Router, Server Actions)    |
| React                                     | 19.3.0                                 |
| TypeScript                                | 6.0.3                                  |
| Tailwind                                  | 4.3.3                                  |
| `@supabase/supabase-js` / `@supabase/ssr` | 2.117.2 / 0.12.7                       |
| `postgres`                                | 3.4.9                                  |
| `sharp`                                   | 0.35.5                                 |
| `zod`                                     | 4.6.6                                  |
| Pruebas                                   | Vitest 5.0.5, Playwright 1.56.1, pgTAP |
| PostgreSQL                                | 17.11 en staging; 16.15 en local       |
| Despliegue                                | Vercel                                 |

**Arquitectura.**

- Monolito Next.js con la lógica de negocio en funciones de PostgreSQL.
- El panel usa el JWT del usuario: todo pasa por RLS.
- La tienda pública y los trabajos usan roles de mínimo privilegio (`storefront_gateway`, `system_worker`), que solo ejecutan funciones.
- `src/proxy.ts` pone el identificador de la petición, la CSP con nonce y el ruteo por dominio. No autoriza.
- Cola de trabajos propia en `system.jobs`, con 36 tipos de trabajo. La corre `/api/jobs/run`, ya sea por el cron o al terminar una acción (`processQueueSoon`).

**Estructura.**

- `src/app`: panel, consola, tienda (`%5Fstore`) y API.
- `src/server`: 33 módulos de negocio.
- `src/lib`: utilidades puras.
- `supabase/migrations`: 167 migraciones.
- `supabase/tests/database`: 144 archivos pgTAP.
- `tests`: e2e, integration, capacity, unit y stack.
- `scripts`: bench, capacity, db, deploy, dev y ops.

**Multiempresa.**

- 82 de 82 tablas de `public` con RLS forzado; 63 con `store_id`.
- Llaves foráneas compuestas `(store_id, …)`.
- `app.prevent_tenant_change` impide mover una fila de tienda.
- Permisos evaluados en la base en cada petición (`app.has_store_permission`), nunca en el JWT.

**Dependencias externas.**

| Servicio     | Uso                  | Estado         |
| ------------ | -------------------- | -------------- |
| Supabase     | Base, Auth y Storage | Operando       |
| Vercel       | Hosting y cron       | Operando       |
| Mercado Pago | Cobro                | Simulado       |
| Stripe       | Planes y Connect     | Simulado       |
| Resend       | Correo               | Sin configurar |
| Skydropx     | Guías                | Simulado       |
| Facturapi    | CFDI                 | Sin código     |
| Sentry       | Errores              | Sin configurar |

**Entornos.**

- Local: stack sin Docker con Auth, PostgREST, Storage y Mailpit.
- Staging: Supabase `pruva-staging` más Vercel `ecomerse`.
- Producción: **no existe**.

**Despliegue.**

- Vercel publica la rama `claude/ecommerce-regulated-platform-41vu1e`, hoy en `88edc6d`.
- Las migraciones en staging se aplican a mano con verificación sha256 (`docs/runbooks/database-roles.md` §7).

**Conservar.**

- Modelo multiempresa y de permisos.
- Cálculo de dinero en SQL.
- Cola en PostgreSQL.
- Importador todo o nada.
- Plantillas por giro.
- Suites de pruebas.

**Cambiar, con justificación.**

| Qué                                        | Por qué                       | Referencia           |
| ------------------------------------------ | ----------------------------- | -------------------- |
| Cron diario → cada minuto                  | La cola se atasca             | RSK-04               |
| Importación de una sola parte → por partes | El tope de 5,000 filas        | CAP-04, requiere ADR |
| Tres ramas de despliegue → una             | Confusión sobre lo desplegado | DT-01                |

**Decisiones de arquitectura pendientes.**

- ADR para la importación por partes (RM-11).
- Crear categorías al importar (RM-13).
- Rama principal (RM-04).
- ADR-054 (datos enmascarados por rol).
- Paralelismo de la cola de fotos (tras medir, RM-10).

---

## Capítulo 05 — Base de datos y seguridad

**Inventario** [VERIFICADO en la base local `pruva_cap_c`, esquema `20261111000400`]:

- Tablas: 82 en `public`, 9 en `system` y 2 en `audit` (particionada).
- Políticas: 78 en `public`.
- Funciones: 193 en `public` (todas con `EXECUTE` para `authenticated` y permiso revisado dentro de cada una), 254 en `app`, 97 en `system` y 53 en `storefront`.
- Permisos: 8 roles de tienda y 47 permisos.

**Migraciones.**

| Grupo                 | Cantidad | Estado                                                                           |
| --------------------- | -------- | -------------------------------------------------------------------------------- |
| En el repositorio     | 167      | `20261005000100` a `20261111000400`                                              |
| Aplicadas en staging  | 162      | Hasta `20261110000200` [VERIFICADO 2026-11-12]                                   |
| Pendientes en staging | 5        | `20261110000300` (rentabilidad) y `20261111000100` a `20261111000400` (Orden 06) |
| Fallidas              | 0        | —                                                                                |

**Aislamiento.**

- Metatests genéricos (`00_schema_security`) cubren toda tabla y función nueva.
- Cada migración trae su pgTAP con prueba entre tiendas.
- La matriz T06 (2026-11-11) intentó leer, cambiar y borrar en las 67 tablas con `store_id` u `organization_id` y llamó las 164 funciones públicas con ids ajenos, como 5 roles de 3 tiendas: 11,220 intentos y **0 fugas**.
- `anon` tiene 0 permisos; `storefront_gateway` y `system_worker`, 0 permisos de tabla.

**Integridad.**

- Pedidos, pagos, movimientos y auditoría son solo de alta (regla 9).
- El inventario solo cambia por `app.apply_inventory_movement`.
- Idempotencia en checkout, webhooks e importaciones.

**Respaldos.**

- `scripts/ops/backup-export.sh` y `restore-check.sh` (D-MEJ-26) se probaron en local: 0 diferencias, 119 tablas, 208,011 filas y metatests 17/17 sobre la copia.
- **Staging no tiene respaldos automáticos** (plan Free).
- El respaldo manual de staging lo debe correr el propietario: no se ha hecho.
- Las imágenes de staging tienen una copia verificada de 401 archivos, entregada al propietario el 2026-11-11.

---

## Capítulo 06 — Auditoría de calidad y pruebas

**Corridas con commit exacto.** Todas en local: 4 núcleos, PostgreSQL 16.15, Node 24.

| Fecha      | Commit                          | Comando                                                               | Resultado                                                                                          | Fallos                              | Evidencia                      |
| ---------- | ------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------ |
| 2026-11-11 | `532ac6e` (base de la Orden 06) | lint, prettier, `tsc`, `pnpm test`, build, `pnpm db:test`, Playwright | Unit 1,279/1,279; pgTAP 2,935/2,935 (140 archivos); integración 437/437; E2E 148/149               | 1: `logo.spec` (carrera; corregida) | `EXECUTION_MASTER_LOG.md` §T01 |
| 2026-11-11 | `b8c9b06`                       | `pnpm verify`, `pnpm db:test`, E2E                                    | Unit 1,280; pgTAP 2,970; integración 437; E2E 149/149                                              | 0                                   | Bitácora de la sesión          |
| 2026-11-12 | `f426f42`                       | Las mismas                                                            | pgTAP 2,978 (143); integración 437; E2E 149/149                                                    | 0                                   | Bitácora de la sesión          |
| 2026-11-12 | `87622f2`                       | Las mismas                                                            | Unit 1,280/1,280 (146); pgTAP 2,983/2,983 (144); integración 438/438 (36); E2E 149/149 en 20.4 min | 0                                   | Registros de la corrida        |
| 2026-11-12 | `cc7a855`                       | —                                                                     | Solo documentación sobre `87622f2`                                                                 | —                                   | —                              |

Pruebas omitidas o en cuarentena: **0**. No hay `skip` ni `fixme` en el repositorio [VERIFICADO].

**Pruebas por tipo.**

| Tipo                  | Qué se ejecutó                                                                                                        | Limitaciones                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Unitarias             | 1,280                                                                                                                 | —                                                              |
| Base de datos         | 2,983 pgTAP                                                                                                           | PostgreSQL 16 local; staging es 17                             |
| Integración           | 438 contra PostgreSQL real, con el rol del worker                                                                     | —                                                              |
| E2E                   | 149 con Playwright y axe, contra el stack local (Auth y Storage de código abierto)                                    | No contra staging                                              |
| Seguridad             | T06: 11,220 intentos, 0 fugas; auditorías del 2026-10-29 y 2026-11-06                                                 | Storage alojado sin probar                                     |
| Rendimiento           | T03 en 48 consultas; escalones B, C y D                                                                               | Solo local                                                     |
| Carga                 | T05: 20 conexiones, 10,766 operaciones, 0 errores; checkout de 14,900 pedidos por minuto (`escalabilidad-2026-11.md`) | Una máquina de 4 núcleos; sin carga contra staging (prohibido) |
| Resiliencia           | T04 (interrupción y reintento de importación); `order-chaos.test`                                                     | —                                                              |
| Restauración          | `restore-check.sh` en local                                                                                           | No contra un proyecto alojado                                  |
| Pagos y correo reales | **Ninguna**                                                                                                           | Sin credenciales                                               |

**Según PROGRESS, sin repetir hoy**: en `88edc6d` (lo desplegado) hubo verify 1,269, pgTAP 2,908 y E2E 148/148, con la corrida 210 de CI en verde. La CI de la rama de auditoría está [NO VERIFICADO]: el repositorio `angelit0486/Ecomerse` está fuera del alcance de las herramientas de GitHub de esta sesión.

---

## Capítulo 07 — Escalabilidad real

Fuente: `docs/audit/EXECUTION_MASTER_LOG.md`, con mediciones del 2026-11-11 y del 2026-11-12. No se extrapolan resultados de pedidos al catálogo.

| #   | Dimensión                       | Resultado                                                                                                                                                                                    | Clase                                                                                            |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Una tienda con 10,000 productos | Comprador: menos de 160 ms (búsqueda 36–41 ms; «disponibles» 153 ms). Panel: menos de 70 ms, salvo calidad del catálogo (0.84 s)                                                             | MEDIDO (local, con las correcciones de la rama)                                                  |
| 2   | Importación                     | 5,000 filas en 23–30 s, lineal; 10,000 productos en 2 archivos sin duplicados ni productos a medias, incluida la interrupción; cuatro importaciones simultáneas sin agotar candados (CAP-11) | MEDIDO (local)                                                                                   |
| 3   | 10,000 imágenes                 | La cola procesa un trabajo a la vez, en pasadas de unos 45 s, con cron diario                                                                                                                | **NO VERIFICADO** (tiempo por foto sin medir); el riesgo de días se deduce del código (ESTIMADO) |
| 4   | Varias tiendas                  | 10 tiendas desiguales a la vez: 0 fugas, 0 errores; la grande no frena a las chicas                                                                                                          | MEDIDO (local)                                                                                   |
| 5   | Concurrencia                    | 20 conexiones en 4 núcleos (máquina saturada); checkout con 8 compradores: 14,900 pedidos por minuto (pedidos, no catálogo)                                                                  | MEDIDO (local)                                                                                   |
| 6   | Crecimiento                     | 100,000 productos (10 × 10,000) y 500,000 (50 × 10,000) sin degradar al comprador; tiendas de 50,000: de 0.35 a 1.3 s (CAP-12); 5 millones sin medir (~27 GB)                                | MEDIDO hasta 500,000; ESTIMADO arriba                                                            |
| 7   | Costos                          | Precios oficiales sin consultar; staging Free con 500 MB (hoy usa 38 MB)                                                                                                                     | NO VERIFICADO                                                                                    |
| 8   | Cuellos de botella              | Cola de fotos (RSK-05), tope de 5,000 filas (CAP-04), tiendas de más de 10,000 (CAP-12), cron diario (RSK-04)                                                                                | MEDIDO o ESTIMADO, según el caso                                                                 |

---

## Capítulo 08 — Implementación comercial de tiendas

El detalle está en `PRUVA_COMMERCIAL_READINESS.md`: 19 pasos de la visita a la tienda operando, quién hace cada uno y si es automático, manual o inexistente.

**Conclusión.**

- **Hoy no se puede entregar una tienda que cobre**, por los seis bloqueos del capítulo 01.
- Tras las fases 0 y 1: tiendas de **hasta ~1,000 productos en cinco días** [ESTIMADO].
- **10,000 con variantes en cinco días sigue incierto** hasta medir las fotos (RM-10) y construir la importación por partes (RM-11).

---

## Capítulo 09 — Órdenes anteriores y trazabilidad

**Antes de las órdenes numeradas.**

- Fases 0 a 9, R, A y B: `docs/phases/PHASE-*-REPORT.md`.
- Misión «vendible», fases 0 a 4: `docs/phases/VENDIBLE-*`.
- Auditoría global del 2026-11-05: `docs/plan/AUDITORIA-GLOBAL-2026-11-05.md`, con 40 pasos.
- Misión de mejoras 2026-11: D-MEJ-01 a D-MEJ-23 en `DECISIONS.md`, desplegada en staging hasta `88edc6d`.

**Órdenes numeradas** (reconstruidas de la bitácora de la sesión y del repositorio):

| Orden                                    | Descripción                                                                      | Autorización                      | Estado real                                                                                                                                                                                             | Evidencia                                                                                           | Commit                | Despliegue          | Bloqueo                                                         | Próxima acción                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------- | ------------------- | --------------------------------------------------------------- | ----------------------------------------------- |
| 01                                       | Diagnóstico estratégico integral, sin cambios                                    | Solo lectura                      | Entregada                                                                                                                                                                                               | Documento en Claude Docs «PRUVA — Diagnóstico integral e informe ejecutivo» (fuera del repositorio) | —                     | —                   | —                                                               | —                                               |
| N-1                                      | Arreglo para crear tiendas                                                       | «Autorizo N-1» (2026-11-10)       | Hecha y desplegada                                                                                                                                                                                      | D-MEJ-24, pgTAP 137                                                                                 | `88edc6d`             | Staging             | `VERCEL_DOMAINS_TOKEN`                                          | —                                               |
| 02 y 03                                  | Programa controlado: preparación y cierre de entregables (T-04, T-05, T-06, D-9) | Solo lectura                      | Entregadas                                                                                                                                                                                              | Documento en Claude Docs (fuera del repositorio)                                                    | —                     | —                   | D-9 sin decidir                                                 | Decidir D-9 (desplegar la rentabilidad apagada) |
| 04                                       | Recuperación de datos y estabilización de staging                                | Copia de imágenes de solo lectura | Hecha: 401 imágenes copiadas y verificadas                                                                                                                                                              | ZIP entregado; manifiesto                                                                           | —                     | —                   | La copia temporal se conserva hasta que el propietario confirme | El propietario confirma dónde guardó el paquete |
| 05                                       | Preparación de respaldo y recuperación de PostgreSQL                             | Preparar la guía, sin ejecutar    | Guía y scripts hechos y probados en local                                                                                                                                                               | `scripts/ops/*`, `docs/runbooks/respaldos.md` (D-MEJ-26)                                            | `532ac6e`             | Rama, no desplegado | El propietario corre el respaldo                                | RM-01                                           |
| —                                        | «Mejorar y optimizar todo»                                                       | Pedido del propietario            | Hecha                                                                                                                                                                                                   | D-MEJ-25 y D-MEJ-26                                                                                 | `a817601`, `532ac6e`  | Rama                | D-9                                                             | RM-02 y RM-03                                   |
| Prompt maestro «Auditoría extrema» (PDF) | Plan inicial, sin ejecutar                                                       | Solo plan                         | Entregado                                                                                                                                                                                               | Documento en Claude Docs (fuera del repositorio)                                                    | —                     | —                   | —                                                               | Lo superó la Orden 06                           |
| 06                                       | Endurecimiento continuo y capacidad (T01–T06, escalones)                         | Trabajo local autorizado          | Hecha: T01–T06 y escalones A, B, C parcial y D; 5 defectos corregidos                                                                                                                                   | `EXECUTION_MASTER_LOG.md`, `EXECUTION_BOARD.md`                                                     | `2aa04c4` a `cc7a855` | **No desplegada**   | Migraciones y despliegue requieren aprobación                   | RM-02 y RM-03                                   |
| 07                                       | —                                                                                | —                                 | **NO VERIFICADO**: no hay una orden 07 en el repositorio ni en la sesión. Entre la 06 y la 08 solo hubo dos conversaciones de alcance (qué tiendas soporta y los giros objetivo), sin cambios de código | —                                                                                                   | —                     | —                   | —                                                               | Si existe, compartirla                          |
| 08                                       | Este informe                                                                     | Solo lectura y documentación      | Hecha                                                                                                                                                                                                   | 7 archivos `PRUVA_*.md`                                                                             | El de este informe    | —                   | —                                                               | Capítulo 13                                     |

---

## Capítulo 10 — Errores, riesgos y bloqueos

El registro completo está en `PRUVA_TECHNICAL_DEBT_AND_RISKS.md`:

- 23 riesgos abiertos (RSK-01 a RSK-23);
- 6 defectos corregidos sin desplegar;
- 5 defectos menores abiertos;
- 9 deudas técnicas.

Los que deciden la venta:

| ID     | Riesgo                      | Sev.                          |
| ------ | --------------------------- | ----------------------------- |
| RSK-01 | Sin producción              | S1                            |
| RSK-02 | Sin correo                  | S1                            |
| RSK-03 | Mercado Pago sin probar     | S1                            |
| RSK-04 | Cola atascada               | S1                            |
| RSK-05 | Fotos a escala sin medir    | S1 para la entrega en 5 días  |
| RSK-06 | Staging atrasado            | S1                            |
| RSK-07 | Candados en staging         | S1                            |
| RSK-08 | Sin respaldos               | S1                            |
| RSK-09 | Textos legales sin revisar  | S1                            |
| RSK-10 | Titularidad del código      | S1 para vender la plataforma  |
| RSK-11 | Planes sin 10,000 productos | S1 para el objetivo de 10,000 |

---

## Capítulo 11 — Brechas para comercialización

| Para…                             | Falta (indispensable)                                                                                                                                                                                  | Mejoras que no bloquean                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| **Un piloto**                     | Producción (RM-08); correo (RM-06); Mercado Pago real (RM-07); cola cada minuto (RM-05); staging al día y código desplegado (RM-02, RM-03); respaldo (RM-01); revisión legal y plan del piloto (RM-09) | Encender devoluciones, ayuda y salud en la tienda piloto |
| **Entregar a un cliente real**    | Lo anterior, más: plantilla de importación por giro (RM-14), guion de implementación (RM-15), plan con el límite correcto (RM-16)                                                                      | Revisor de archivo (RM-12)                               |
| **Operar varias tiendas**         | Monitoreo (RM-17), topes de gasto (RM-18), cobro de planes real (RM-20)                                                                                                                                | Firewall (RM-19), ADR pendientes (RM-22)                 |
| **Estandarizar implementaciones** | Medición de fotos (RM-10), importación por partes (RM-11), categorías al importar (RM-13), guion probado con un giro de cada tipo                                                                      | —                                                        |
| **Escalar comercialmente**        | Repositorio con un titular (RM-21); repetir T03–T05 en producción (RM-23)                                                                                                                              | Skydropx (RM-24), CFDI (RM-25)                           |
| **Validar gran escala**           | Entorno aislado y presupuesto para 1 a 5 millones (RM-27)                                                                                                                                              | Tiendas de más de 10,000 (RM-26)                         |

---

## Capítulo 12 — Roadmap de finalización

El detalle está en `PRUVA_COMPLETION_ROADMAP.md`: 28 tareas, cada una con objetivo, alcance, archivos, dependencias, riesgo, entregable, pruebas, criterio de aceptación, estimación y autorización.

| Fase | Tareas        | Contenido                                                                 |
| ---- | ------------- | ------------------------------------------------------------------------- |
| 0    | RM-01 a RM-04 | Poner al día lo existente: respaldo, migraciones, despliegue y rama única |
| 1    | RM-05 a RM-09 | Indispensable para el piloto                                              |
| 2    | RM-10 a RM-16 | Carga del catálogo de 10,000 sin errores y entrega en 5 días              |
| 3    | RM-17 a RM-23 | Operar varias tiendas                                                     |
| 4    | RM-24 a RM-28 | Escalar                                                                   |

---

## Capítulo 13 — Próxima orden de ejecución

**A. Ejecutable sin nuevas autorizaciones.** Trabajo local, en una rama de trabajo, sin migraciones remotas ni despliegues:

1. **RM-10**: medir el procesamiento de 1,000 y 10,000 fotos por la cola real, en local.
2. **RM-12**: revisor del archivo de importación con un solo reporte. Reutiliza los validadores y no cambia contratos.
3. **RM-14**: plantilla de importación por giro (ropa, hogar y belleza, abarrotes y suplementos).
4. **RM-15**: guion de implementación de 5 días, ensayado con una tienda sintética de cada giro.

**B. Requiere decisión de arquitectura.**

- RM-11: importación por partes; cambia GATE0 §26.1 y necesita un ADR.
- RM-13: crear categorías al importar.
- RM-04: rama principal.
- ADR-051, ADR-052, ADR-054 y ADR-055.

**C. Requiere acceso o colaboración del propietario.**

| Tarea         | Qué se necesita                                                      |
| ------------- | -------------------------------------------------------------------- |
| RM-01         | Correr el respaldo                                                   |
| RM-05         | `CRON_SECRET`                                                        |
| RM-06         | Resend y dominio                                                     |
| RM-07         | Credenciales de Mercado Pago                                         |
| RM-09         | Abogado y precios                                                    |
| RM-16 a RM-21 | Precios, Sentry, consolas de Vercel y Supabase, Stripe y repositorio |
| RM-28         | Asesor regulatorio                                                   |

**D. Requiere autorización de migraciones, despliegues, infraestructura o gasto.**

| Tarea | Autorización                       |
| ----- | ---------------------------------- |
| RM-02 | Migraciones en staging             |
| RM-03 | Despliegue                         |
| RM-05 | Vercel Pro                         |
| RM-08 | Producción con Supabase Pro y PITR |
| RM-23 | Pruebas en producción              |
| RM-27 | Entorno de gran escala             |

Lo de B, C y D no se ejecutó ni se ejecutará sin la autorización correspondiente.
