# Documentación

| Documento                                                                                | Qué es                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`architecture/GATE0-ARCHITECTURE-REVIEW.md`](architecture/GATE0-ARCHITECTURE-REVIEW.md) | **Contrato técnico oficial** (48 secciones). Aprobado por el propietario el 2026-10-05 con los defaults de Gate 0 (`APPROVED WITH CHANGES`). El estado "BLOCKED" del final del documento es el registro histórico anterior a esa aprobación; la aprobación consta en `DECISIONS.md`. |
| [`architecture/BLUEPRINT-v0.1.md`](architecture/BLUEPRINT-v0.1.md)                       | Planeación inicial. Gate 0 la corrige y la cita ("v0.1 §x"); ante cualquier diferencia, manda Gate 0.                                                                                                                                                                                |
| [`DECISIONS.md`](DECISIONS.md)                                                           | Aprobación del propietario, decisiones de implementación y desviaciones declaradas.                                                                                                                                                                                                  |
| [`runbooks/database-roles.md`](runbooks/database-roles.md)                               | Habilitar y rotar roles de base de datos; disparo del runner de jobs.                                                                                                                                                                                                                |
| [`phases/`](phases/)                                                                     | Informe de cierre de cada fase.                                                                                                                                                                                                                                                      |

## Índice por tema (secciones del contrato)

Sustituye a los 19 documentos separados del Anexo A (decisión D-F1-14).

| Tema                                | Secciones de Gate 0                           |
| ----------------------------------- | --------------------------------------------- |
| Producto y alcance (PRODUCT_SPEC)   | §1, §6, §41 (trazabilidad); blueprint §3, §31 |
| Arquitectura (ARCHITECTURE)         | §11, §28, §37                                 |
| Base de datos (DATABASE)            | §9, §10, §13                                  |
| Multi-tenancy y RLS (MULTI_TENANCY) | §6, §11, §12                                  |
| Seguridad (SECURITY)                | §11.5, §30, §44                               |
| RBAC                                | §7, §8                                        |
| Catálogo (CATALOG)                  | §14, §23                                      |
| Inventario (INVENTORY)              | §15                                           |
| Pedidos (ORDERS)                    | §16                                           |
| Checkout                            | §17                                           |
| Pagos (PAYMENTS)                    | §18                                           |
| Storefront y dominios (STOREFRONT)  | §21, §22, §24                                 |
| Panel (ADMIN)                       | blueprint §16                                 |
| White-label (THEMING)               | §20, §32                                      |
| API                                 | §31                                           |
| Analítica (ANALYTICS)               | blueprint §20                                 |
| Pruebas (TESTING)                   | §34                                           |
| Roadmap                             | §38, §42                                      |
| ADR                                 | §39 + `DECISIONS.md`                          |
| Riesgos (RISKS)                     | §40                                           |
| Contratos críticos                  | §43                                           |
| Reglas de no regresión              | §44 (también en `/CLAUDE.md`)                 |
