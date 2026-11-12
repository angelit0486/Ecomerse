# PRUVA — Contexto para el siguiente superprompt (autosuficiente, 2026-11-12)

> Este archivo se puede leer solo. Resume, con evidencia, todo lo que un agente nuevo necesita para continuar sin repetir trabajo.
> Al 2026-11-12 cada afirmación está verificada en el repositorio (`cc7a855`) o en staging, con consultas de solo lectura.
> El detalle está en los otros seis archivos `docs/audit/PRUVA_*.md`.

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

**Pruebas.** Última corrida completa, en local, sobre el commit `87622f2` (2026-11-12): 1,280 unitarias, 2,983 pgTAP, 438 de integración y 149 de 149 E2E. Hay 0 pruebas omitidas.

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

- Las migraciones `20261110000300` (rentabilidad) y `20261111000100` a `20261111000400` (Orden 06: búsqueda, disponibilidad, búsqueda del panel y candados de la importación).
- El código desde `88edc6d` hasta `cc7a855`.

**Brechas de producto para la carga eficiente**

- Tope de 5,000 filas por archivo (CAP-04).
- La importación no crea categorías nuevas.
- Sin revisor del archivo previo a la subida.
- Sin plantilla de importación por giro.
- Rendimiento de 10,000 fotos sin medir: la cola procesa un trabajo a la vez, en pasadas de unos 45 s.
- Sin guion de implementación.

## 8. Ramas

| Rama                                         | Commit    | Uso                                                                               |
| -------------------------------------------- | --------- | --------------------------------------------------------------------------------- |
| `audit/hardening-capacity-2026-11`           | `cc7a855` | Trabajo más reciente. Base recomendada para seguir                                |
| `claude/ecommerce-regulated-platform-41vu1e` | `88edc6d` | **La que despliega Vercel**. Avanza solo con aprobación y sin reescribir historia |
| `mejoras/2026-11`                            | `532ac6e` | Ancestro de la de auditoría                                                       |
| `respaldo/pre-mejoras`                       | `255fa7f` | Respaldo                                                                          |
| `main`                                       | `ea0176f` | Antigua, 254 commits atrás. No usar                                               |

`vercel.json` tiene un `ignoreCommand` para que las ramas `audit/*` no generen vista previa.

Remoto: `https://github.com/angelit0486/ecomerse`. El repositorio `angelii33/pruva` responde 403.

## 9. Siguiente trabajo y criterios de aceptación

**A. Ejecutable sin nuevas autorizaciones** (local, en una rama `audit/*` o nueva, sin tocar staging)

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

- RM-02: 5 migraciones en staging, con el método sha256 de `docs/runbooks/database-roles.md` §7.
- RM-03: despliegue de `cc7a855`.
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

1. RM-10, RM-12, RM-14 y RM-15 hechos en una rama, con pruebas y suites en verde, subidos y anotados en `PROGRESS.md` y `DECISIONS.md`.
2. El ADR de RM-11 redactado para que lo apruebe el propietario.
3. Un mensaje corto al propietario con las autorizaciones pendientes de C y D, en orden.
