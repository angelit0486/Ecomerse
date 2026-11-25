-- =============================================================================
-- Promociones (ADR-070, PR #37): aplicar 20261125000100…0400 en STAGING
-- (pruva-staging, ref epgiglysldwoiulnwamf). NUNCA en producción.
-- Runbook: docs/runbooks/promociones-lanzamiento.md §4. Método: el mismo de
-- docs/runbooks/database-roles.md §7 (pg_net desde un commit fijo, sha256,
-- una sola transacción). Sin contraseñas ni llaves.
--
-- Se corre por pasos en el editor SQL (rol postgres). Cada paso es un bloque
-- aparte; NO pasar al siguiente si el anterior no da lo esperado.
-- Commit fijo de los archivos: 147682256ec5384cc2639583de1cee328c97929d
-- (las sumas del paso 3 son las del runbook; un archivo distinto se rechaza).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PASO 0 · Respaldo (runbook de respaldos): bash scripts/ops/backup-export.sh
-- contra staging desde una máquina de confianza, ANTES del paso 3. Staging en
-- plan Free no tiene respaldos automáticos. Las reversas (scripts/ops/reversa/
-- 2026112500*.reversa.sql) deshacen el esquema sin pérdida mientras no haya
-- promociones.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- PASO 1 · Comprobación previa (solo lectura). Todas las filas con ok = true.
-- ---------------------------------------------------------------------------
select 'versión del esquema' as comprobacion, public.app_schema_version() as valor,
       '20261119000100' as esperado, public.app_schema_version() = '20261119000100' as ok
union all
select 'ninguna de las 4 registrada',
       (select count(*)::text from supabase_migrations.schema_migrations where version like '2026112500%'),
       '0', not exists (select 1 from supabase_migrations.schema_migrations where version like '2026112500%')
union all
select 'tablas de promociones ausentes', coalesce(to_regclass('public.promotions')::text, '(vacío)'),
       '(vacío)', to_regclass('public.promotions') is null
union all
select 'registro con columna checksum',
       (select count(*)::text from information_schema.columns
         where table_schema = 'supabase_migrations' and table_name = 'schema_migrations' and column_name = 'checksum'),
       '1', exists (select 1 from information_schema.columns
         where table_schema = 'supabase_migrations' and table_name = 'schema_migrations' and column_name = 'checksum')
union all
select 'trabajos corriendo', (select count(*)::text from system.jobs where status = 'running'), '0',
       not exists (select 1 from system.jobs where status = 'running')
union all
select 'pg_net instalado', (select count(*)::text from pg_extension where extname = 'pg_net'), '1',
       exists (select 1 from pg_extension where extname = 'pg_net');

-- ---------------------------------------------------------------------------
-- PASO 2 · Pedir los 4 archivos (devuelve 4 request_id; anotarlos en orden).
-- ---------------------------------------------------------------------------
select f.n, f.file,
       net.http_get('https://raw.githubusercontent.com/angelit0486/Ecomerse/'
                    || '147682256ec5384cc2639583de1cee328c97929d/supabase/migrations/' || f.file) as request_id
from unnest(array['20261125000100_promotions.sql', '20261125000200_promotion_engine.sql',
                  '20261125000300_storefront_promotions.sql', '20261125000400_promotions_report.sql'])
     with ordinality as f(file, n)
order by f.n;

-- ---------------------------------------------------------------------------
-- PASO 3 · Comprobar las sumas (unos segundos después). Reemplazar los 4 ids.
-- Esperado: status_code 200 y ok = true en las 4 filas.
-- ---------------------------------------------------------------------------
with esperado(n, id, sha) as (values
  (1, 0 /* ID_0100 */, '73d3b27687cc0e77508510a66de1d98c356d48537a4fedd69686d675e02f5fa1'),
  (2, 0 /* ID_0200 */, 'ac458640605201cf97ee20a4203e4cef08c872c8e7ff836c52e78e6a1f48f675'),
  (3, 0 /* ID_0300 */, '98abdf159c670fb66d1ea74b6a277b59e77af1422f3c25ff5212a9b4d0cea735'),
  (4, 0 /* ID_0400 */, 'd61de62acf1d0d22567045a3f628a4e839459e93cc0bc6dc230e826a422307b8'))
select e.n, e.id, r.status_code, encode(sha256(convert_to(r.content, 'UTF8')), 'hex') = e.sha as ok
from esperado e left join net._http_response r on r.id = e.id
order by e.n;

-- ---------------------------------------------------------------------------
-- PASO 4 · Aplicar las 4 en orden, en UNA transacción (si una falla, no queda
-- ninguna). Reemplazar los 4 ids (los mismos del paso 3).
-- ---------------------------------------------------------------------------
do $$
declare
  v_ids   bigint[] := array[0 /* ID_0100 */, 0 /* ID_0200 */, 0 /* ID_0300 */, 0 /* ID_0400 */];
  v_vers  text[]   := array['20261125000100', '20261125000200', '20261125000300', '20261125000400'];
  v_names text[]   := array['promotions', 'promotion_engine', 'storefront_promotions', 'promotions_report'];
  v_shas  text[]   := array['73d3b27687cc0e77508510a66de1d98c356d48537a4fedd69686d675e02f5fa1',
                              'ac458640605201cf97ee20a4203e4cef08c872c8e7ff836c52e78e6a1f48f675',
                              '98abdf159c670fb66d1ea74b6a277b59e77af1422f3c25ff5212a9b4d0cea735',
                              'd61de62acf1d0d22567045a3f628a4e839459e93cc0bc6dc230e826a422307b8'];
  v_body  text;
  v_sha   text;
begin
  set local lock_timeout = '5s';
  if public.app_schema_version() <> '20261119000100' then
    raise exception 'versión inesperada: %', public.app_schema_version();
  end if;
  for i in 1 .. 4 loop
    if exists (select 1 from supabase_migrations.schema_migrations where version = v_vers[i]) then
      raise exception '% ya está registrada', v_vers[i];
    end if;
    select r.content into v_body from net._http_response r where r.id = v_ids[i] and r.status_code = 200;
    if v_body is null then
      raise exception 'sin respuesta 200 para % (id %)', v_vers[i], v_ids[i];
    end if;
    v_sha := encode(sha256(convert_to(v_body, 'UTF8')), 'hex');
    if v_sha <> v_shas[i] then
      raise exception 'suma distinta en %: %', v_vers[i], v_sha;
    end if;
    execute v_body;
    insert into supabase_migrations.schema_migrations (version, name, checksum)
    values (v_vers[i], v_names[i], v_sha);
    raise notice '✓ %_%', v_vers[i], v_names[i];
  end loop;
  if public.app_schema_version() <> '20261125000400' then
    raise exception 'versión final inesperada: %', public.app_schema_version();
  end if;
end
$$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- PASO 5 · Verificación posterior (solo lectura). Todas con ok = true.
-- Después: scripts/ops/ventana/04-aislamiento.sql (termina en ROLLBACK) y
-- get_advisors (sin ERROR nuevo).
-- ---------------------------------------------------------------------------
select 'versión' as comprobacion, public.app_schema_version() = '20261125000400' as ok
union all
select '4 registradas con suma',
       (select count(*) from supabase_migrations.schema_migrations
         where version like '2026112500%' and checksum is not null) = 4
union all
select 'RLS forzado en las 3 tablas nuevas',
       (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
         where oid in ('public.promotions'::regclass, 'public.promotion_targets'::regclass,
                       'public.order_promotions'::regclass))
union all
select 'ninguna promoción todavía', not exists (select 1 from public.promotions)
union all
select 'anon sin el reporte',
       not has_function_privilege('anon', 'public.promotions_report(uuid, date, date)', 'execute')
union all
select 'gateway con las lecturas de la tienda',
       has_function_privilege('storefront_gateway', 'storefront.product_promotions(uuid, uuid[])', 'execute')
union all
select 'RLS forzado en todo public',
       not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relkind in ('r', 'p')
                      and not (c.relrowsecurity and c.relforcerowsecurity));

-- ---------------------------------------------------------------------------
-- PASO 6 · Valores de los planes. PREFERIDO: Consola → Planes → editar
-- «Tienda» (Promociones activas 5, Reporte de promociones sin marcar) y
-- «Tienda Plus» (1000, marcado) → «Guardar plan» (queda en la bitácora).
-- Comprobación (solo lectura):
-- ---------------------------------------------------------------------------
select p.key, p.name,
       max(e.value_int) filter (where e.key = 'max_active_promotions') as promociones_activas,
       bool_or(e.value_bool) filter (where e.key = 'promotion_reports') as reporte
from public.plans p left join public.plan_entitlements e on e.plan_id = p.id
group by p.key, p.name, p.sort order by p.sort;
