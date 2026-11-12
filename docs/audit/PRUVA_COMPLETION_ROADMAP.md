# PRUVA — Roadmap de finalización (Orden 08, 2026-11-12)

Fases ordenadas por dependencias reales. Prioridad: aprovechar y terminar lo existente antes de construir algo nuevo.

**Autorización.** Indica qué hace falta antes de ejecutar cada tarea:

- **A**: cabe en los permisos actuales; trabajo local y en ramas, sin tocar staging.
- **B**: decisión de arquitectura o de producto (ADR).
- **C**: acceso, credenciales o colaboración del propietario.
- **D**: migraciones remotas, despliegues, infraestructura o gasto.

**Estimaciones.** Son de esfuerzo de ingeniería [ESTIMADO] y suponen que la dependencia ya está cumplida. No incluyen los tiempos de terceros (DNS, Mercado Pago, abogado).

## Fase 0 — Poner al día lo ya construido (sin desarrollo nuevo)

| ID    | Objetivo                             | Alcance                                                                    | Archivos o módulos                                                  | Depende de | Riesgo                               | Entregable                        | Pruebas                                                | Criterio de aceptación                                           | Estimación             | Autorización |
| ----- | ------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------- | ------------------------------------ | --------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------- | ------------ |
| RM-01 | Respaldo de staging antes de tocarlo | Correr `scripts/ops/backup-export.sh` desde la computadora del propietario | `docs/runbooks/respaldos.md`                                        | —          | Ninguno (solo lectura)               | Respaldo con evidencia            | `restore-check.sh` en local                            | Restauración local con 0 diferencias                             | 30 min del propietario | C            |
| RM-02 | Staging al día                       | Aplicar `20261110000300` y `20261111000100`…`400` con el método sha256     | `supabase/migrations/2026111*`                                      | RM-01      | Bajo (aditivas, probadas desde cero) | Staging en `20261111000400` (167) | `00_schema_security` contra staging; salud             | `app_schema_version() = 20261111000400`; asesores sin ERROR      | 1 h                    | D            |
| RM-03 | Desplegar el código corregido        | Avanzar la rama de Vercel a `cc7a855` sin reescribir historia              | rama `claude/ecommerce-regulated-platform-41vu1e`                   | RM-02      | Medio (cambia la versión publicada)  | Despliegue con salud «ok»         | Recorrido en `pruva-panel-demo` y `pruva-tienda-demo2` | Búsqueda y «disponibles» rápidas en staging; sin «mantenimiento» | 1 h                    | D            |
| RM-04 | Decidir la rama principal            | Una sola rama de verdad para desplegar                                     | `main` (`ea0176f`, 254 commits atrás), `mejoras/2026-11`, `audit/*` | RM-03      | Medio                                | Rama única documentada            | —                                                      | Un solo historial; las demás, archivadas                         | 1 h                    | B            |

## Fase 1 — Lo indispensable para el primer piloto (P0)

| ID    | Objetivo                         | Alcance                                                                                | Archivos o módulos                                                 | Depende de    | Riesgo | Entregable                    | Pruebas                                                | Criterio de aceptación                                            | Estimación | Autorización |
| ----- | -------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------- | ------ | ----------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- | ---------- | ------------ |
| RM-05 | Cola cada minuto                 | Vercel Pro, `CRON_SECRET`, cron `* * * * *`                                            | `vercel.json`, `src/app/api/jobs/run/route.ts`                     | Plan Pro      | Bajo   | Cola sin atasco               | `platform-health`                                      | 24 h sin `queue_stalled`; foto lista en menos de 2 min            | 1 h        | C + D        |
| RM-06 | Correo real                      | Resend, dominio con SPF/DKIM/DMARC, Send Email Hook                                    | `docs/runbooks/correo-resend.md`, `src/server/notifications`       | Dominio       | Bajo   | Correos saliendo              | Pedido de prueba; código de acceso                     | Confirmación, aviso a la tienda y código llegan a bandejas reales | 2 h + DNS  | C            |
| RM-07 | Mercado Pago real                | Credenciales de prueba, red permitida, 15 escenarios, compra real y reembolso          | `src/server/payments/mercadopago*.ts`, `mercadopago-escenarios.md` | RM-05, RM-06  | Medio  | Evidencia por escenario       | Escenarios del runbook                                 | 15 de 15 en modo prueba y una compra real reembolsada             | 1 día      | C            |
| RM-08 | Producción separada              | Supabase Pro con PITR, Vercel de producción, dominio, migraciones desde cero, secretos | `docs/runbooks/despliegue-y-rollback.md`                           | RM-02 a RM-07 | Medio  | Producción vacía y sana       | `00_schema_security`, salud, simulacro de restauración | Restauración probada en un proyecto aparte                        | 1 día      | D (gasto)    |
| RM-09 | Revisión legal y plan del piloto | Abogado revisa los textos; el propietario fija precio y plan                           | `docs/legal/*`, `public.plans`                                     | —             | —      | Textos aprobados; plan creado | —                                                      | Sin «PENDIENTE DE REVISIÓN»                                       | Externo    | C            |

## Fase 2 — Carga del catálogo eficiente y sin errores (P1)

Responde al pedido del propietario del 2026-11-12: 10,000 productos, sin errores, entregados en menos de una semana.

| ID    | Objetivo                           | Alcance                                                                                                                       | Archivos o módulos                                                                             | Depende de              | Riesgo                                   | Entregable                                           | Pruebas                                       | Criterio de aceptación                                                        | Estimación | Autorización                 |
| ----- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------- | ---------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------- | ---------- | ---------------------------- |
| RM-10 | Medir las fotos                    | 1,000 y 10,000 fotos sintéticas por la cola real en local; tiempo por foto y por pasada                                       | `src/server/media`, `scripts/capacity/`                                                        | —                       | Bajo                                     | Cifras **medidas** y la frecuencia de cola necesaria | Prueba de capacidad nueva                     | Informe con tiempos y propuesta                                               | 1 día      | **A**                        |
| RM-11 | Importación por partes             | El servidor parte el archivo en bloques de hasta 5,000 filas, cada uno todo o nada, con avance, reanudación y un solo informe | `src/app/admin/[storeHandle]/productos/importar/*`, `system.import_commit`, `public.imports_*` | ADR nuevo               | Medio (cambia GATE0 §26.1)               | 18,000 filas en una sola subida                      | Unitarias, pgTAP, `import-10k`, E2E `imports` | Sin duplicados ni productos a medias tras un error en el bloque 3             | 3–4 días   | **B**                        |
| RM-12 | Revisor del archivo antes de subir | Un reporte en español con fila, error y arreglo: SKU repetidos, precios, categorías, enlaces de fotos que no abren            | `src/server/imports/products.ts` (reutiliza los validadores)                                   | —                       | Bajo (solo lectura, no cambia contratos) | Pantalla «Revisar archivo»                           | Unitarias con archivos malos; E2E             | Todos los errores de un archivo de 10,000 en un solo reporte en menos de 30 s | 2–3 días   | **A**                        |
| RM-13 | Categorías al importar             | Crear las categorías que falten, opcional y con vista previa                                                                  | `app.import_resolve_base` y relacionadas                                                       | Decisión de producto    | Bajo                                     | Opción «Crear categorías nuevas»                     | pgTAP y E2E                                   | Un archivo con categorías nuevas importa sin error y sin duplicarlas          | 1–2 días   | B (cambio de comportamiento) |
| RM-14 | Plantilla de importación por giro  | CSV de ejemplo y columnas por giro (ropa: talla y color; abarrotes: presentación; suplementos: ficha)                         | `src/lib/templates`, `importar/plantilla`                                                      | —                       | Bajo                                     | 3 plantillas descargables                            | Unitarias; importar cada ejemplo              | Cada ejemplo importa sin errores en una tienda nueva de su giro               | 1 día      | A                            |
| RM-15 | Guion de implementación de 5 días  | Runbook: qué pide el comercio, cómo se carga, tiempos y checklist                                                             | `docs/runbooks/implementacion-de-tienda.md` (nuevo)                                            | RM-10 a RM-14           | —                                        | Runbook                                              | Ensayo con una tienda sintética de cada giro  | Una tienda de cada giro lista siguiendo solo el guion                         | 1 día      | A                            |
| RM-16 | Planes comerciales                 | Planes con 1,000, 5,000 y 10,000 productos                                                                                    | `public.plans` (datos)                                                                         | Precios del propietario | Bajo                                     | Planes en producción                                 | `plans.spec`                                  | El comercio ve su límite                                                      | 2 h        | C + D                        |

## Fase 3 — Operar varias tiendas (P1 y P2)

| ID    | Objetivo                                       | Depende de            | Entregable                   | Criterio de aceptación                      | Autorización |
| ----- | ---------------------------------------------- | --------------------- | ---------------------------- | ------------------------------------------- | ------------ |
| RM-17 | Monitoreo de errores con Sentry                | DSN                   | Errores visibles             | Un error de prueba aparece en el tablero    | C            |
| RM-18 | Topes de gasto y alertas                       | Acceso a las consolas | Spend cap y Spend Management | Alertas al 50, 80 y 100 %                   | C            |
| RM-19 | Firewall de Vercel                             | Acceso a Vercel       | Reglas por IP                | Ráfaga bloqueada en prueba                  | C + D        |
| RM-20 | Cobro de planes con Stripe real                | Cuenta y precios      | Suscripción real             | Alta, cambio de plan y cancelación probados | C            |
| RM-21 | Repositorio privado con un solo titular        | Decisión legal        | Repositorio unificado        | Un titular claro                            | C            |
| RM-22 | ADR pendientes: 051, 052, 054, 055             | Decisión              | ADR resueltos                | —                                           | B            |
| RM-23 | Repetir T03–T05 en producción antes de abrirla | RM-08                 | Cifras reales                | Dentro del objetivo                         | D            |

## Fase 4 — Escalar (P2 y P3)

| ID    | Objetivo                                          | Depende de             | Autorización |
| ----- | ------------------------------------------------- | ---------------------- | ------------ |
| RM-24 | Guías con Skydropx                                | Cuenta y documentación | C            |
| RM-25 | CFDI con Facturapi                                | Cuenta de pruebas      | C            |
| RM-26 | Tiendas de más de 10,000 productos (CAP-12)       | Decisión de producto   | B            |
| RM-27 | Escalones de 1 a 5 millones en un entorno aislado | Presupuesto            | D            |
| RM-28 | Suplementos: reglas sanitarias reales (R0)        | Asesor regulatorio     | C            |

## Orden recomendado

1. **Ya, sin esperar a nadie**: RM-10 y RM-12, después RM-14 y RM-15. Son de tipo A.
2. **En paralelo, del propietario**:
   1. RM-01, después RM-02 y RM-03 (autorizaciones);
   2. RM-05, RM-06, RM-07 y RM-09.
3. **Con el ADR aprobado**: RM-11 y RM-13.
4. **Producción**: RM-08 y RM-16, después RM-23.
5. **Primer piloto**: una tienda de un giro objetivo con hasta 1,000 productos.
6. Después: fases 3 y 4.
