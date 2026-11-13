# PRUVA — Contexto para el siguiente superprompt (autosuficiente, actualizado 2026-11-13)

> Este archivo se puede leer solo. Resume, con evidencia, todo lo que un agente nuevo necesita para continuar sin repetir trabajo.
> Base: verificación del 2026-11-12 en el repositorio (`cc7a855`) y en staging, con consultas de solo lectura.
> **Actualización del 2026-11-13 (Orden 10, mensajes 1 a 4):**
>
> - el trabajo más reciente está en `producto/orden-10`;
> - la sección 0 resume lo nuevo;
> - las secciones 6 a 9 y 12 están al día.
>
> El detalle está en los otros archivos `docs/audit/PRUVA_*.md` y en `docs/DECISIONS.md` §36 a §38.

## 0. Lo nuevo de la Orden 10 (2026-11-12/13) [VERIFICADO en local]

- **Bloque 1** (D-O10-01 a 07):
  - paquete de despliegue de migraciones con ensayo local;
  - alertas «Qué atender hoy»;
  - compartir por WhatsApp y QR;
  - revisar los enlaces de fotos;
  - ensayo del guion con 4 tiendas sintéticas, que encontró que las tarifas guardadas en el panel quedaban inactivas (corregido en `65ee7a0`).
- **Auditoría independiente** (mensaje 3): «aprobado con observaciones». D1: la tienda `demo` de staging está publicada con sus 2 tarifas inactivas. Sigue pendiente porque arreglarlo exige desplegar.
- **Mensaje 4** (D-O10-08 a 14), todo autorizado por el propietario:
  - categorías completas en las 4 plantillas;
  - D2: E2E de la tarifa hasta el pedido;
  - D3: límites persistentes en la revisión de enlaces;
  - D4 a D8;
  - ADR-065 A: crear categorías al importar, con vista previa y confirmación;
  - publicación masiva por candidatos («Publicado: sí» pide publicar; el worker publica solo lo que cumple);
  - ADR-064 A: más de 5,000 filas por partes, hasta 50,000. Cada parte es todo o nada; el lote se detiene en la que falla, a la vista, y se corrige solo esa.
- **Migraciones nuevas, solo locales:** `20261113000100` a `20261113000400`. Con las 6 anteriores son **10 pendientes en staging** (`docs/runbooks/despliegue-migraciones-2026-11.md`, ensayo `scripts/ops/migration-rehearsal.sh`).
- **Nada desplegado; staging y producción sin tocar.** PRUVA **no** está declarado apto para producción.

## 1. Qué es PRUVA

PRUVA es una plataforma SaaS de comercio electrónico **multiempresa y de marca blanca**: Organización → Tienda.

- El operador de la plataforma da de alta tiendas en línea para comercios físicos de México.
- Cada tienda tiene su dirección o dominio, su identidad visual, su catálogo, sus pedidos y su propia cuenta de cobro: el dinero va directo al comercio.
- La plataforma cobra una mensualidad por planes con límites.

## 2. Objetivo

| Tipo                      | Objetivo                                                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comercial                 | Visitar un comercio y entregarle una tienda profesional, configurada y operando en **cinco días hábiles**, que el comerciante maneje sin conocimientos técnicos |
| Giros iniciales           | Ropa, calzado y accesorios; hogar, belleza y regalos; abarrotes y suplementos pequeños                                                                          |
| Capacidad                 | Hasta 10,000 productos por tienda; meta global de 500 tiendas × 10,000 = 5,000,000 productos                                                                    |
| Prioridad del propietario | Cargar productos y precios de forma eficiente y sin errores                                                                                                     |

Son objetivos por validar. Hoy está medido en local: una tienda de 10,000 y 500,000 productos en 50 tiendas.

## 3. Reglas que no se negocian

Las reglas completas están en `CLAUDE.md` y en `docs/architecture/GATE0-ARCHITECTURE-REVIEW.md` §44.

**Datos y aislamiento**

1. Nunca debilitar el aislamiento: RLS forzado, `store_id NOT NULL`, llaves foráneas compuestas `(store_id, …)`, trigger `app.prevent_tenant_change`. Nunca `USING (true)`.
2. `anon` no recibe permisos. `storefront_gateway` y `system_worker` solo ejecutan funciones.
3. Las funciones `SECURITY DEFINER` llevan `search_path = ''` y `REVOKE … FROM public`.
4. El cliente nunca es autoridad sobre precio, total, impuestos, descuento, stock, tienda ni permisos.
5. Dinero en `bigint` (centavos). El inventario solo cambia por `app.apply_inventory_movement`.
6. Los pagos solo se confirman por webhook verificado o por conciliación.
7. Pedidos, pagos, movimientos y auditoría nunca se borran.
8. Migraciones aditivas, solo hacia adelante, cada una con su prueba pgTAP, su prueba entre tiendas y su plan de reversa.

**Cambios y pruebas**

9. Cambiar un contrato crítico (GATE0 §43) requiere un **ADR aprobado** por el propietario.
10. Cada corrección lleva una prueba que falla antes y pasa después.
11. `pnpm verify` y las suites completas en verde antes de cada commit.
12. Nunca saltar, desactivar ni poner en cuarentena una prueba.

**Estilo**

13. Código e identificadores en inglés. Interfaz, mensajes y documentación en español de México.

**Del propietario, vigentes**

- No escribir, borrar ni modificar datos de staging o producción sin aprobación expresa.
- No aplicar migraciones en bases compartidas sin aprobación. No configurar `MIGRATION_DATABASE_URL`.
- No desplegar sin aprobación. No contratar, no generar gastos, no activar pagos ni correos reales.
- No modificar cuentas ni permisos de staging.
- No hacer pruebas de carga ni de caos contra staging. No usar las vistas previas de Vercel para escribir.
- Nunca pedir contraseñas ni claves en el chat. Nunca poner secretos en el código.
- No reescribir historia ni hacer force-push. No cambiar la rama principal sin autorización.
- **Ignorar por completo la tienda `demo`** (no tocarla ni medirla).
- `docs/audit/incidente/` **nunca** se sube a Git. Está excluida en `.git/info/exclude`. Al formatear o correr suites, se aparta y se devuelve.
- Conservar la copia temporal de imágenes de staging hasta que el propietario confirme que guardó el paquete.
- Etiquetar las afirmaciones como [VERIFICADO], [MEDIDO], [ESTIMADO], [PROPUESTO] o [NO VERIFICADO]. No inventar nada.
- Un commit por tarea, con push y confirmación por `git ls-remote`. Actualizar `docs/plan/PROGRESS.md` y `docs/DECISIONS.md`.
- Las funciones nuevas para las tiendas, detrás de un interruptor apagado.
- El propietario trabaja desde el celular y no ejecuta comandos. Los informes finales deben ser cortos.

## 4. Decisiones que no deben modificarse

Todas están en `docs/DECISIONS.md`.

| Decisión                | Contenido                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Stack                   | Next.js 16 + Supabase (PostgreSQL con RLS) + Vercel. Lógica de dinero e inventario en SQL. Cola propia en `system.jobs` |
| ADR-041                 | Mercado Pago por tienda con OAuth                                                                                       |
| ADR-059 A               | Sin OXXO ni transferencia de Mercado Pago                                                                               |
| ADR-040                 | Importar solo las filas sin errores                                                                                     |
| ADR-033                 | Fotos por enlace con descargador seguro                                                                                 |
| ADR-044                 | Stripe Billing para los planes                                                                                          |
| ADR-045                 | Alta autoservicio **no aprobada**: la plataforma da de alta las tiendas                                                 |
| ADR-053                 | Lista de categorías bloqueadas: **rechazada**                                                                           |
| ADR-042                 | Política de contenido: **aplazada**                                                                                     |
| ADR-035 y ADR-036       | Colecciones y cupones por producto: **pospuestos**                                                                      |
| ADR-057 y ADR-058       | Guías con Skydropx y CFDI con Facturapi: aprobados; esperan cuentas de pruebas                                          |
| Todo o nada por archivo | GATE0 §26.1. Cambiarlo requiere un ADR                                                                                  |

## 5. Qué está construido [VERIFICADO]

**Tamaño**

- 72,758 líneas de TypeScript, 167 migraciones y 89 pantallas.
- 82 tablas en `public` con RLS forzado; 8 roles y 47 permisos; 36 tipos de trabajo.
- 14 plantillas por giro: abarrotes, belleza, blanco, electrónica, genérica, gourmet, hogar, joyería, juguetes, mascotas, papelería, regalos, ropa y suplementos.

**Funcionalidades**

98 inventariadas en `PRUVA_FEATURE_INVENTORY.md`: 84 implementadas, 3 parciales y 11 ausentes.

**Lo que sí está hecho**

- Multiempresa y alta de tiendas.
- Panel completo: catálogo con variantes, categorías, marcas, atributos, ofertas e inventario.
- Importación CSV, Shopify, Tiendanube y pegado desde Excel.
- Fotos.
- Apariencia y plantillas.
- Tienda pública con búsqueda, filtros y SEO.
- Checkout con envíos e impuestos.
- Pago manual y Mercado Pago.
- Pedidos y devoluciones; clientes y exportaciones.
- Correos (código listo).
- Reportes.
- Consola de plataforma.
- Salud.
- Respaldos en un comando.

## 6. Qué funciona de verdad

**Pruebas.** Última corrida completa, en local, sobre `producto/orden-10` (2026-11-13): 1,364 unitarias, 3,157 pgTAP y 447 de integración. Incluye la de 18,000 filas en 4 partes con falla en la 3.ª, corrección, caída del worker, publicación y aislamiento. El resultado de E2E está en `PRUVA_PRODUCTIZATION_EXECUTION_LOG.md`. Hay 0 pruebas omitidas.

**Capacidad.** Orden 06, medida en local con 4 núcleos (`docs/audit/EXECUTION_MASTER_LOG.md`):

- Aislamiento: 11,220 intentos cruzados y 0 fugas.
- Una tienda de 10,000 productos: el comprador recibe respuesta en menos de 160 ms; el panel, en menos de 70 ms.
- Importación de 10,000 con fallas, interrupción y reintento: sin duplicados ni productos a medias. Cada archivo de 5,000 tarda de 23 a 30 s.
- 10 tiendas a la vez: 0 fugas y 0 errores.
- 500,000 productos en 50 tiendas: sin degradación para el comprador.

**Staging** [VERIFICADO 2026-11-12]:

| Dato                     | Valor                                                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proyecto Supabase        | `pruva-staging` (`epgiglysldwoiulnwamf`), PostgreSQL 17.11, plan Free                                                                                                      |
| Esquema                  | `20261110000200` (162 migraciones)                                                                                                                                         |
| Contenido                | 2 organizaciones, 3 tiendas, 91 productos, **0 pedidos y 0 pagos**, 38 MB                                                                                                  |
| Cola                     | **3 trabajos atascados desde 2026-11-10 19:34 UTC**                                                                                                                        |
| Despliegue en Vercel     | Proyecto `ecomerse` (`prj_Zc88rZCri2w342wigEBaxqL3ngi6`, equipo `team_Ak79PEqCQo1ftKOvTEWekKPT`), commit `88edc6d` de la rama `claude/ecommerce-regulated-platform-41vu1e` |
| Dominios de demostración | `pruva-panel-demo.vercel.app`, `pruva-tienda-demo2.vercel.app`                                                                                                             |

**Lo que no funciona en real**

- Nunca ha salido un correo.
- Mercado Pago solo está probado con simulador.
- No existe un entorno de producción.
- Staging no tiene respaldos automáticos.
- La cola depende de un cron diario.

## 7. Qué está pendiente

**Dictamen: NO APTO TODAVÍA.** Pasa a «solo pilotos controlados» al cerrar RM-01 a RM-09.

**Bloqueos que dependen del propietario** (`PRUVA_TECHNICAL_DEBT_AND_RISKS.md`):

- RSK-01: producción.
- RSK-02: correo con Resend.
- RSK-03: credenciales de Mercado Pago.
- RSK-04: Vercel Pro con `CRON_SECRET` y cron cada minuto.
- RSK-08: respaldos, con Supabase Pro.
- RSK-09: abogado.
- RSK-10: repositorio privado con un solo titular.
- RSK-11: precios y un plan de 10,000 productos.
- RSK-14: asesor sanitario para suplementos.

**Sin desplegar**

- 10 migraciones:
  - `20261110000300` (rentabilidad);
  - `20261111000100` a `20261111000400` (Orden 06);
  - `20261112000100` (alertas);
  - `20261113000100` a `20261113000400` (Orden 10, mensaje 4).
- El código desde `88edc6d` hasta la punta de `producto/orden-10`.
- Migrar y desplegar van en la **misma ventana**: el código desplegado no conoce el trabajo de publicación por candidatos (runbook, sección 3).

**Brechas de producto para la carga eficiente** (estado al 2026-11-13)

- Resueltas en local:
  - más de 5,000 filas (ADR-064 A);
  - crear categorías (ADR-065 A);
  - revisor del archivo (ya existía);
  - hojas por giro y guion de 5 días;
  - fotos medidas (D-PROD-01);
  - «Publicado» en las hojas.
- Siguen: importar `.xlsx` directo (PB-11), el asistente «Llena tu tienda» (PB-12) y, en un lote, «importar solo lo que está bien».
- Con el cron diario de staging, un lote avanza una parte por pasada del runner, o mientras su página esté abierta. Vercel Pro con cron por minuto lo quitaría (RM-05).

## 8. Ramas

| Rama                                         | Commit    | Uso                                                                               |
| -------------------------------------------- | --------- | --------------------------------------------------------------------------------- |
| `producto/orden-10`                          | punta     | **Trabajo más reciente** (Orden 10, mensajes 1 a 4). Base recomendada para seguir |
| `producto/orden-09`                          | `b6cd725` | Orden 09; base de la Orden 10                                                     |
| `audit/hardening-capacity-2026-11`           | `cc7a855` | Orden 06 y 08                                                                     |
| `claude/ecommerce-regulated-platform-41vu1e` | `88edc6d` | **La que despliega Vercel**. Avanza solo con aprobación y sin reescribir historia |
| `mejoras/2026-11`                            | `532ac6e` | Ancestro de la de auditoría                                                       |
| `respaldo/pre-mejoras`                       | `255fa7f` | Respaldo                                                                          |
| `main`                                       | `ea0176f` | Antigua, 254 commits atrás. No usar                                               |

`vercel.json` tiene un `ignoreCommand` para que las ramas `audit/*` y `producto/*` no generen vista previa.

Remoto: `https://github.com/angelit0486/ecomerse`. El repositorio `angelii33/pruva` responde 403.

## 9. Siguiente trabajo y criterios de aceptación

> Al 2026-11-13, RM-10, RM-11, RM-12, RM-13, RM-14 y RM-15 están **hechos en local** (Órdenes 09 y 10). Lo que sigue depende sobre todo de autorizaciones (C y D). La lista A de abajo queda como historia.

**A. Ejecutable sin nuevas autorizaciones** (historia; hecho) (local, en una rama `audit/*` o nueva, sin tocar staging)

| ID    | Tarea                                                                                                                                                                                                                                                           | Criterio de aceptación                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| RM-10 | Medir 1,000 y 10,000 fotos sintéticas por la cola real (`src/server/media`, `src/server/jobs/run-now.ts`)                                                                                                                                                       | Informe con tiempo por foto, por pasada y total, más la frecuencia de cola necesaria para cumplir cinco días |
| RM-12 | Revisor del archivo antes de subir: un solo reporte en español con fila, error y arreglo (SKU repetidos, precios, categorías inexistentes, enlaces de foto que no abren). Reutilizar los validadores de `src/server/imports/products.ts`, sin cambiar contratos | Todos los errores de un archivo de 10,000 en un solo reporte en menos de 30 s; unitarias y E2E               |
| RM-14 | Plantilla de importación por giro (ropa y calzado: talla y color; hogar y belleza; abarrotes: presentación; suplementos: ficha) en `src/lib/templates` e `importar/plantilla`                                                                                   | Cada ejemplo importa sin errores en una tienda nueva de su giro                                              |
| RM-15 | Guion de implementación de 5 días en `docs/runbooks/implementacion-de-tienda.md`                                                                                                                                                                                | Una tienda sintética de cada giro queda lista siguiendo solo el guion                                        |

**B. Requiere ADR o decisión**

- RM-11: importación por partes en el servidor; cada parte todo o nada, con avance y reanudación.
- RM-13: crear categorías al importar.
- RM-04: rama principal única.

**C. Requiere al propietario**

RM-01 (correr el respaldo), RM-05, RM-06, RM-07, RM-09 y RM-16 a RM-21.

**D. Requiere autorización de migración, despliegue o gasto**

- RM-02: **10** migraciones en staging, con el runbook `docs/runbooks/despliegue-migraciones-2026-11.md` (sha256, verificación previa y posterior, ensayo local en verde).
- RM-03: despliegue de la punta de `producto/orden-10` en la misma ventana; luego volver a guardar las tarifas de `demo` (D1).
- RM-08: producción.

## 10. Archivos y pruebas que hay que consultar

| Tema              | Dónde                                                                                                                                                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reglas            | `CLAUDE.md`, GATE0 §43–44                                                                                                                                                                                                                                                                     |
| Decisiones        | `docs/DECISIONS.md` (D-MEJ-24 a D-MEJ-27 son las últimas)                                                                                                                                                                                                                                     |
| Avance y bloqueos | `docs/plan/PROGRESS.md`, `docs/plan/PENDIENTES-DEL-PROPIETARIO.md`                                                                                                                                                                                                                            |
| Capacidad         | `docs/audit/EXECUTION_MASTER_LOG.md`, `docs/audit/EXECUTION_BOARD.md`, `scripts/capacity/*`, `tests/capacity/import-10k.test.ts`                                                                                                                                                              |
| Importación       | `src/server/imports/products.ts`, `src/server/imports/handlers.ts`, `src/app/admin/[storeHandle]/productos/importar/*`, `supabase/migrations/20261015000600_imports.sql` y siguientes, `tests/integration/import-5k.test.ts`, `tests/e2e/imports.spec.ts`, `tests/e2e/paste-products.spec.ts` |
| Fotos             | `src/server/media/*`, `src/server/jobs/run-now.ts`, `tests/integration/media-worker.test.ts`, `tests/integration/remote-images.test.ts`, `tests/e2e/bulk-images.spec.ts`                                                                                                                      |
| Plantillas        | `src/lib/templates/store-templates.ts`, `tests/e2e/store-templates.spec.ts`                                                                                                                                                                                                                   |
| Seguridad         | `supabase/tests/database/00_schema_security.test.sql`, `scripts/capacity/t06-*.sql`                                                                                                                                                                                                           |
| Runbooks          | `docs/runbooks/*` (respaldos, correo, Mercado Pago, despliegue y pedidos)                                                                                                                                                                                                                     |

## 11. Comandos

```bash
cd /home/user/ecomerse
export PATH=/home/user/ecomerse/.stack/bin/node24/bin:$PATH   # Node 24
pg_ctlcluster 16 main start; rm -f .stack/run/*.pid; bash scripts/dev/stack.sh up
set -a; . ./.env.local; set +a; export PGPASSWORD=postgres
pnpm verify                      # lint + formato + tipos + unitarias + build
pnpm db:test                     # migraciones desde cero + pgTAP + integración
pnpm exec playwright test        # E2E (con la app en :3000)
bash scripts/capacity/t03.sh 10000     # una tienda de 10,000 (local)
bash scripts/capacity/t04.sh           # importación de 10,000 con fallas
bash scripts/capacity/t05.sh 10000 20  # diez tiendas a la vez
```

Para arrancar la app, compilar y levantarla igual que el paso «Compilar y arrancar la app» de `.github/workflows/ci.yml`.

## 12. Resultado esperado del siguiente bloque

1. Auditoría independiente del mensaje 4 de la Orden 10 (el agente se detuvo para esperarla).
2. Con autorización:
   - respaldo;
   - las 10 migraciones en staging;
   - despliegue en la misma ventana;
   - volver a guardar las tarifas de `demo`.
3. Después, el piloto con un comercio real (PB-31) para medir horas de persona.
