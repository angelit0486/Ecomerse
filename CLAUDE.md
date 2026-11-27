# CLAUDE.md — Reglas del proyecto

Plataforma e-commerce SaaS **multi-tenant y white-label** (Organization → Store).
Contrato técnico: `docs/architecture/GATE0-ARCHITECTURE-REVIEW.md`. Decisiones y desviaciones: `docs/DECISIONS.md`.

> **Modo autónomo:** si el propietario pidió trabajar solo, sigue `docs/plan/AUTONOMOUS_PLAN.md` y mantén `docs/plan/PROGRESS.md` al día (prompt de arranque: `docs/plan/KICKOFF_PROMPT.md`).
> Ante cualquier conflicto entre una petición y estas reglas, detente y pregunta.
> Cambiar un contrato crítico (GATE0 §43) requiere un ADR aprobado.

## Comandos

```bash
pnpm install            # Node 24 (ver .nvmrc), pnpm 10
pnpm dev                # requiere .env.local (plantilla: .env.example)
pnpm verify             # lint + formato + tipos + unit + build  (obligatorio antes de cada commit)
pnpm db:test            # migraciones + pgTAP + integración contra PostgreSQL local
pnpm test               # solo unit
pnpm stack up           # stack local sin Docker (Auth + PostgREST + Mailpit); ver docs/runbooks/local-stack.md
pnpm test:stack         # extremo a extremo contra ese stack
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

## Reglas de operación con agentes (Grok CTO → Claude Code)

Estas reglas complementan a las anteriores; ante conflicto gana la más restrictiva.

**Prohibido sin autorización explícita del propietario (y bloqueado en `.claude/settings.json`):**

- `git push`, `git merge`, `git rebase`, `gh pr merge`/`create`, trabajar sobre `main`. El push y el PR los hace el orquestador.
- Desplegar (`vercel`, `npx vercel`) o cualquier acción contra producción o staging.
- Migraciones remotas (`supabase db push`, `supabase link`, `pnpm deploy:migrate`, SQL contra bases remotas) o escrituras en Supabase remoto. Solo se permite PostgreSQL/Supabase **local** (`pnpm db:test`, `supabase start`, reset local).
- Leer, imprimir o editar `.env*`, llaves `service_role` o cualquier secreto. Nunca exponer secretos en código, logs ni commits.
- `curl`/`wget`, `sudo`, `rm -rf` y comandos destructivos fuera del worktree.

**Tiendas demo: solo lectura.** No modificar las tiendas demo, sus datos ni los seeds/scripts que las afectan (`scripts/dev/demo-seed.mjs` y relacionados). No ejecutar `pnpm demo:seed*`.

**Continuidad:** nunca reconstruir ni reemplazar la arquitectura existente sin justificación y ADR; no eliminar funciones existentes. Mejorar lo que hay, en cambios pequeños y revisables.

**Aislamiento:** mantener RLS forzado y aislamiento multi-tenant. Todo SQL o RPC nuevo va en un archivo nuevo de `supabase/migrations/` (solo local, forward-only) con pruebas pgTAP que demuestren el aislamiento entre al menos dos tiendas.

**Definición de terminado para cada función:** propósito, estados (carga, vacío, error, sin permiso), validaciones, manejo de errores explícito (sin ceros engañosos ni tarjetas que desaparecen), permisos respetados, persistencia real y pruebas (unit; pgTAP si hay SQL; E2E si es factible). UI y textos en español.

**Informe por tarea (obligatorio):** cada prompt ejecutado termina con un informe técnico consecutivo en `docs/reports/` (`PRUVA_INFORME_<NNN>_<DESCRIPCION>.md`, más `.docx` si se puede), escrito antes de declarar la tarea terminada, incluso si quedó bloqueada. El protocolo completo y el índice están en `docs/reports/README.md`.

**Evidencia:** no declarar nada terminado sin evidencia. Al terminar, reportar archivos cambiados, comandos ejecutados y sus resultados reales (número de pruebas que pasan/fallan), y lo que no se pudo verificar y por qué.
