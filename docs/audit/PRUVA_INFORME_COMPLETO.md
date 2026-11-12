# PRUVA — Informe completo de estado (2026-11-12)

> **Para la IA que lea esto.** Este archivo es el punto de entrada. Resume todo el proyecto y enlaza cada documento con un enlace directo a su texto plano (raw), fijado al commit `bcaae829caf044f1908b0e46c15de4bfec695793` para que el contenido no cambie.
>
> Si solo puedes leer un documento más, lee `PRUVA_NEXT_PROMPT_CONTEXT.md` (sección 9).
>
> Etiquetas:
>
> - **[VERIFICADO]**: comprobado en el código o en staging, con consultas de solo lectura.
> - **[MEDIDO]**: cifra de una prueba ejecutada.
> - **[ESTIMADO]**: cálculo.
> - **[PROPUESTA]**: sin decidir.
> - **[NO VERIFICADO]**: sin acceso o sin servicio real.

## 1. Qué es PRUVA

PRUVA es una plataforma SaaS de comercio electrónico **multiempresa y de marca blanca** (Organización → Tienda) para comercios físicos de México.

- El operador da de alta y configura cada tienda.
- Cada tienda tiene su dirección, su diseño, su catálogo, sus pedidos y su propia cuenta de cobro: el dinero va directo al comercio.
- La plataforma cobra una mensualidad por planes.

**Objetivo comercial.** Visitar un comercio y entregarle en **cinco días hábiles** una tienda profesional, configurada y cargada, que el dueño maneje sin conocimientos técnicos.

**Giros iniciales:**

- ropa, calzado y accesorios;
- hogar, belleza y regalos;
- abarrotes;
- suplementos.

**Capacidad objetivo:** hasta 10,000 productos por tienda; 500 tiendas; 5,000,000 de productos en total. Son objetivos por validar; hoy está medido en local hasta 500,000 productos.

## 2. Dictamen

**NO APTO TODAVÍA para vender a un comercio que cobre a sus clientes.**

Ninguno de los motivos es un defecto de diseño; todos dependen del propietario o de terceros:

| Motivo                                       | Dato                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| No existe entorno de producción              | Solo el proyecto `pruva-staging` [VERIFICADO]                                              |
| Nunca ha salido un correo real               | Falta configurar Resend                                                                    |
| Mercado Pago solo probado con simulador      | 0 pedidos y 0 pagos en staging [VERIFICADO]                                                |
| La cola de trabajos de staging está atascada | 3 trabajos desde 2026-11-10 19:34 UTC; el cron de Vercel corre una vez al día [VERIFICADO] |
| Staging va 5 migraciones detrás del código   | Staging en `20261110000200` (162); repositorio en `20261111000400` (167) [VERIFICADO]      |
| Staging sin respaldos automáticos            | Supabase plan Free                                                                         |
| Textos legales sin revisión de abogado       | Dicen «PENDIENTE DE REVISIÓN»                                                              |

Al cerrar esos puntos (RM-01 a RM-09 del roadmap), el sistema queda **apto para pilotos controlados** con catálogos de hasta ~1,000 productos.

## 3. Qué existe [VERIFICADO en el código]

**Tamaño**

- 72,758 líneas de TypeScript, 167 migraciones SQL y 89 pantallas.
- 82 tablas con RLS forzado; 8 roles y 47 permisos; 36 tipos de trabajo en la cola.

**Funciones**

- 98 inventariadas: 85 implementadas, 2 parciales y 11 ausentes (10 por falta de construcción y 1 por decisión).
- 14 plantillas por giro: abarrotes, belleza, blanco, electrónica, genérica, gourmet, hogar, joyería, juguetes, mascotas, papelería, regalos, ropa y suplementos.

**Módulos**

- Panel de la tienda.
- Tienda pública con búsqueda, filtros y SEO.
- Consola de la plataforma.
- Catálogo con variantes, inventario e importación (CSV, Shopify, Tiendanube, pegar desde Excel).
- Fotos.
- Checkout con envíos e impuestos.
- Pago manual y Mercado Pago.
- Pedidos y devoluciones; clientes.
- Correos.
- Reportes (incluida la rentabilidad).
- Salud del sistema.
- Respaldos en un comando.

**Stack**

- Next.js 16.4.1, React 19.3.0, TypeScript 6.0.3.
- Supabase (PostgreSQL 17.11 en staging, con RLS) y Vercel.
- Node 24.

## 4. Qué funciona de verdad

**Última corrida completa en local.** Commit `87622f2`, más el bloque 1 de la Orden 09:

- 1,296 pruebas unitarias;
- 2,983 pgTAP;
- 438 de integración;
- E2E: 150 de 153 en la corrida completa. Fallaron 2 pruebas nuevas por errores de la propia prueba y 1 no corrió por depender de una de ellas. Ya corregidas, 7 de 7.
- 0 pruebas omitidas.

**Mediciones [MEDIDO en local, 4 núcleos].** Detalle en `EXECUTION_MASTER_LOG.md`.

| Qué                                                            | Resultado                                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Aislamiento entre tiendas                                      | 11,220 intentos cruzados con 5 roles; 0 fugas                                                                       |
| Una tienda de 10,000 productos                                 | Comprador en menos de 160 ms; panel en menos de 70 ms                                                               |
| 500,000 productos en 50 tiendas                                | Sin degradación para el comprador                                                                                   |
| Importar 10,000 productos con fallas, interrupción y reintento | Sin duplicados ni productos a medias; 23 a 30 s por archivo de 5,000 filas                                          |
| Diez tiendas a la vez                                          | 10,766 operaciones; 0 errores; 0 fugas                                                                              |
| Fotos                                                          | 0.25 s por foto de catálogo y 1.0 s por foto de celular; el límite es la frecuencia de la cola, no el procesamiento |

**Lo que no se ha probado con servicios reales:** pagos, correo, Storage alojado de Supabase, Skydropx y Facturapi.

## 5. Trabajo reciente, por orden

| Orden        | Qué se hizo                                                                                                                                                                                                        | Commits                         | Desplegado             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ---------------------- |
| 06           | Capacidad: generador sintético, pruebas T01–T06, escalones de 10,000 a 500,000 productos; 5 defectos de escala corregidos (búsqueda, disponibilidad, importación, búsqueda del panel y candados de la importación) | `2aa04c4` a `cc7a855`           | No                     |
| 08           | Informe maestro de estado y 6 anexos (inventario, trazabilidad, riesgos, preparación comercial, roadmap, contexto)                                                                                                 | `dd85fbc`                       | No aplica (documentos) |
| 09, bloque 1 | Vista «Fotos en proceso», fotos medidas, hoja de Excel con tallas y colores, hoja de inicio por giro, guion de 5 días, costos y propuesta de planes                                                                | `c061048`, `b48a2c6`, `bcaae82` | No                     |

La Orden 07 no existe como archivo. Sus requisitos se reconstruyeron dentro de la Orden 09.

## 6. Costos y precios

Precios oficiales leídos el 2026-11-12 [VERIFICADO]:

| Servicio                           | Costo                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Supabase Pro                       | 25 USD al mes; recuperación a un punto en el tiempo (PITR), 100 USD más |
| Vercel Pro                         | 20 USD al mes (cron cada minuto)                                        |
| Resend Pro                         | 20 USD al mes (50,000 correos)                                          |
| Mercado Pago                       | 3.49 % + 4 MXN + IVA; lo paga el comercio                               |
| Tiendanube (referencia de mercado) | 149, 374 y 999 MXN al mes                                               |

Costo de infraestructura por tienda [ESTIMADO]: de 660 MXN al mes con 5 tiendas a 86 MXN con 50.

Lo que decide el precio son las horas de implementación y soporte, no la infraestructura. Planes propuestos [PROPUESTA]:

| Plan        | Productos | Mensualidad     | Implementación (una vez) |
| ----------- | --------- | --------------- | ------------------------ |
| Básico      | 1,000     | 399–499 MXN     | 2,500–4,000 MXN          |
| Profesional | 5,000     | 799–999 MXN     | 6,000–9,000 MXN          |
| Avanzado    | 10,000    | 1,499–1,999 MXN | 12,000–20,000 MXN        |

Escenarios a 12 meses: conservador, base y optimista, en `05-modelo-comercial-y-costos.md`.

## 7. Bloqueos y decisiones pendientes del propietario

**Decisiones**

1. ADR-064, importar más de 5,000 filas. Recomendada la opción A: partir el archivo y que cada parte sea todo o nada.
2. ADR-065, crear categorías al importar. Recomendada la opción A: casilla apagada por defecto, con vista previa.
3. El valor de su hora y los precios finales.

**Autorizaciones**

- Respaldo de staging.
- Aplicar 5 migraciones en staging.
- Desplegar el código nuevo.

**Servicios**

- Vercel Pro con `CRON_SECRET`.
- Resend con dominio.
- Credenciales de prueba de Mercado Pago.
- Producción en Supabase Pro.
- Sentry.

**Terceros**

- Abogado.
- Asesor sanitario, para suplementos.

**Riesgo abierto: el repositorio es público** (R-08). Por eso estos enlaces funcionan sin iniciar sesión, pero cualquiera puede leer el código.

## 8. Siguiente trabajo sin autorizaciones nuevas

1. Ensayar el guion de 5 días con una tienda de prueba de cada giro.
2. Alertas accionables en Inicio: sin existencias, sin foto, baja rotación.
3. Catálogo compartible por WhatsApp y código QR.
4. Importación de más de 5,000 filas, en cuanto se decida el ADR-064.

## 9. Enlaces directos (texto plano, fijados al commit `bcaae82`)

Base: `https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/`

### Empieza aquí

- Contexto autosuficiente para la siguiente orden: https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/docs/audit/PRUVA_NEXT_PROMPT_CONTEXT.md
- Informe maestro (13 capítulos): https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/docs/audit/PRUVA_MASTER_STATE_REPORT.md

### Estado y plan (Orden 08)

- Inventario de 98 funciones con evidencia: https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/docs/audit/PRUVA_FEATURE_INVENTORY.md
- Matriz de trazabilidad (35 requisitos): https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/docs/audit/PRUVA_TRACEABILITY_MATRIX.md
- Riesgos, defectos y deuda técnica: https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/docs/audit/PRUVA_TECHNICAL_DEBT_AND_RISKS.md
- Preparación comercial: https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/docs/audit/PRUVA_COMMERCIAL_READINESS.md
- Roadmap de 28 tareas: https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/docs/audit/PRUVA_COMPLETION_ROADMAP.md

### Productización (Orden 09)

- Tablero: https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/docs/audit/PRUVA_PRODUCTIZATION_BOARD.md
- Bitácora: https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/docs/audit/PRUVA_PRODUCTIZATION_EXECUTION_LOG.md
- Guion de implementación de 5 días: https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/docs/runbooks/implementacion-de-tienda.md
- Modelo comercial y costos: https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/docs/venta/05-modelo-comercial-y-costos.md

### Capacidad y pruebas (Orden 06)

- Bitácora con todas las mediciones: https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/docs/audit/EXECUTION_MASTER_LOG.md
- Tablero de la Orden 06: https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/docs/audit/EXECUTION_BOARD.md

### Reglas, decisiones y pendientes

- Reglas del proyecto: https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/CLAUDE.md
- Decisiones y ADR (los más recientes, al final): https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/docs/DECISIONS.md
- Avance: https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/docs/plan/PROGRESS.md
- Pendientes del propietario: https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/docs/plan/PENDIENTES-DEL-PROPIETARIO.md
- Contrato técnico GATE0 (2,812 líneas): https://raw.githubusercontent.com/angelit0486/Ecomerse/bcaae829caf044f1908b0e46c15de4bfec695793/docs/architecture/GATE0-ARCHITECTURE-REVIEW.md

### Para navegar el código

- Rama de trabajo actual: https://github.com/angelit0486/Ecomerse/tree/producto/orden-09
- Commits recientes: https://github.com/angelit0486/Ecomerse/commits/producto/orden-09
- Comparación con lo desplegado en staging (`88edc6d`): https://github.com/angelit0486/Ecomerse/compare/88edc6df6a323db5299cd7d4e80eac0ff453752f...producto/orden-09

### Ramas

| Rama                                         | Commit               | Uso                               |
| -------------------------------------------- | -------------------- | --------------------------------- |
| `producto/orden-09`                          | Trabajo más reciente | Base para seguir                  |
| `audit/hardening-capacity-2026-11`           | `dd85fbc`            | Orden 06 y Orden 08               |
| `claude/ecommerce-regulated-platform-41vu1e` | `88edc6d`            | La que despliega Vercel (staging) |
| `mejoras/2026-11`                            | `532ac6e`            | Anterior                          |
| `main`                                       | `ea0176f`            | Antigua; no usar                  |
