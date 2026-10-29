# Resumen técnico (verificado el 2026-10-29)

## Qué es

Plataforma de comercio electrónico **multi-tenant y white-label** para México: una organización tiene una o varias tiendas, cada una con su dominio, catálogo, pagos, pedidos y diseño. Incluye panel para comerciantes, consola de plataforma (planes, suscripciones, soporte, salud) y tienda pública.

## Construcción

| Dato                             | Valor verificado                                                            |
| -------------------------------- | --------------------------------------------------------------------------- |
| Inicio del repositorio           | 2026-09-20                                                                  |
| Commits                          | 254                                                                         |
| Código de aplicación (TS/TSX)    | ≈ 62,000 líneas sin pruebas                                                 |
| Stack                            | Next.js 16.4.1, React, PostgreSQL (Supabase), Node 22                       |
| Dependencias                     | 21 de producción, 19 de desarrollo; `pnpm audit` sin hallazgos (2026-10-28) |
| Migraciones de base de datos     | 128, solo hacia adelante                                                    |
| Decisiones de arquitectura (ADR) | Hasta ADR-043; dos propuestas pendientes (042, 043)                         |

## Seguridad por diseño

- Aislamiento entre tiendas en la base: RLS forzado en todas las tablas y metatests que lo exigen para cualquier tabla nueva.
- Toda función expuesta verifica permisos (metatest con prueba negativa).
- Personal con segundo factor (TOTP) obligatorio.
- Llaves de Mercado Pago de cada comercio cifradas (AES-256-GCM).
- Webhooks firmados y con idempotencia.
- Detalle: `docs/phases/VENDIBLE-F1.9-SEGURIDAD.md`.

## Pruebas (última ronda completa, 2026-10-29)

| Suite                 | Resultado                        |
| --------------------- | -------------------------------- |
| Unitarias             | 1,018 / 1,018                    |
| Base de datos (pgTAP) | 2,440 / 2,440 (107 archivos)     |
| Integración           | 362 / 362 (25 archivos)          |
| Navegador (E2E + axe) | 110 / 110 (59 archivos)          |
| CI de GitHub Actions  | Verde en el último commit medido |

## Funciones principales

Catálogo con variantes e importación CSV; inventario por movimientos; checkout con Mercado Pago (cuenta propia de cada comercio) y pagos manuales; pedidos, envíos y reembolsos; cuentas de compradores; opiniones verificadas; editor de diseño por bloques con 6 plantillas por giro; dominios propios; planes y suscripciones; salud de la plataforma con alertas; módulo regulatorio para suplementos.
