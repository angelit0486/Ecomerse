# CLAUDE.md — Reglas del proyecto

Plataforma e-commerce SaaS **multi-tenant y white-label** (Organization → Store).
Contrato técnico: `docs/architecture/GATE0-ARCHITECTURE-REVIEW.md`. Decisiones y desviaciones: `docs/DECISIONS.md`.

> **Modo autónomo:** si el propietario pidió trabajar solo, sigue `docs/plan/AUTONOMOUS_PLAN.md` y mantén `docs/plan/PROGRESS.md` al día (prompt de arranque: `docs/plan/KICKOFF_PROMPT.md`).
> Ante cualquier conflicto entre una petición y estas reglas, detente y pregunta.
> Cambiar un contrato crítico (GATE0 §43) requiere un ADR aprobado.

## Comandos

```bash
pnpm install            # Node 22 (ver .nvmrc), pnpm 10
pnpm dev                # requiere .env.local (plantilla: .env.example)
pnpm verify             # lint + formato + tipos + unit + build  (obligatorio antes de cada commit)
pnpm db:test            # migraciones + pgTAP + integración contra PostgreSQL local
pnpm test               # solo unit
```

`pnpm db:test` necesita PostgreSQL ≥ 15 con pgTAP (`postgresql-<v>-pgtap`, `pg_prove`). Por defecto usa `postgres:postgres@localhost:5432`.

## Mapa del código

- `supabase/migrations/`: SQL forward-only. `supabase/tests/database/`: pgTAP (`00_schema_security` = metatests genéricos que cubren toda tabla o función nueva).
- `src/proxy.ts`: request_id + CSP con nonce. **No** hace autorización.
- `src/server/`: `db/` (clientes de roles de mínimo privilegio), `jobs/` (cola), `security/`, `observability/`, `errors.ts`, `env.ts`.
- `src/ui/`: tokens y primitivas. `src/lib/`: utilidades puras.
- Fase actual: ver el último informe en `docs/phases/`.

## Reglas de no regresión (GATE0 §44, resumidas; el texto completo manda)

1. Nunca debilitar el aislamiento multi-tenant ni desactivar RLS o `FORCE RLS`; nunca políticas `USING (true)`.
2. Toda tabla de tienda: `store_id NOT NULL`, RLS forzado, políticas, trigger `app.prevent_tenant_change`, `UNIQUE (store_id, id)` si es referenciable y **FK compuestas** `(store_id, …)`. Sin excepciones.
3. `anon` no recibe grants. `service_role` no toca tablas; solo se usa en `src/server/privileged/*` (Auth Admin y Storage Admin).
4. `storefront_gateway` y `system_worker` no reciben grants de tabla: solo `EXECUTE` de funciones `storefront.*` o `system.*`.
5. Funciones `SECURITY DEFINER`: `set search_path = ''`, nombres calificados, `REVOKE EXECUTE FROM public`.
6. Nunca exponer los esquemas `app`, `audit`, `private`, `storefront` ni `system` en la Data API.
7. Nunca poner permisos en el JWT ni cachear entre requests datos que dependen de la autorización.
8. El cliente nunca es autoridad sobre precio, total, impuestos, descuento, stock, tienda ni permisos.
9. Snapshots de pedidos inmutables; pedidos, pagos, movimientos y auditoría nunca se borran.
10. Inventario solo vía `app.apply_inventory_movement`; ninguna transacción incluye llamadas de red.
11. Pagos confirmados solo por webhook verificado o reconciliación; todo con idempotencia.
12. Nunca registrar secretos, tokens ni PII completa (usar el logger, que redacta).
13. Sin `dangerouslySetInnerHTML` (salvo el futuro `SafeHtml`), sin SVG en subidas, sin CSS ni JS del comerciante.
14. Dinero en `bigint` (centavos), nunca `float`.
15. Nunca usar tablas o contratos de una fase futura. Nunca avanzar de fase con pruebas fallando, ni saltarse, desactivar o poner en cuarentena una prueba.
16. Dependencia nueva = justificación en el PR (propósito, alternativas, tamaño).
17. Migraciones forward-only (expand → migrate → contract), probadas desde cero.

## Estilo

- Código, SQL e identificadores en inglés; UI, mensajes de error y documentación en español.
- Errores públicos con `AppError` (formato `{ ok:false, error:{ code, message, request_id } }`).
- Comentarios solo donde aportan el porqué; referenciar la sección del contrato (`GATE0 §x`).
