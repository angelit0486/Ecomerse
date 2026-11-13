-- =============================================================================
-- Orden 10, mensaje 4 · D3 y D6 (auditoría independiente del bloque 1).
--
-- D3. Revisar los enlaces de las fotos de una importación (O10-04) dependía de
--     un enfriamiento en memoria, por instancia y por importación: una cuenta
--     podía repetir revisiones y hacer que el servidor consultara muchos hosts.
--     Ahora cada revisión queda registrada en la base y la base decide:
--       * reutiliza el resultado de la misma importación (24 h; una revisión
--         nueva a pedido solo si el último resultado tiene más de 10 minutos);
--       * una revisión a la vez por tienda y por importación;
--       * hasta 8 revisiones simultáneas en toda la plataforma (una tienda no
--         acapara la capacidad de las demás);
--       * 10 revisiones por hora por tienda (app.rate_limit_take, persistente);
--       * hasta 500 enlaces distintos por archivo (los demás quedan sin revisar);
--       * retención: 7 días (la purga diaria del ADR-060 borra los vencidos);
--       * los errores quedan registrados en la fila (status = 'failed').
--     Las protecciones SSRF del descargador no cambian (src/server/media).
-- D6. store_alerts exige el interruptor «Salud de tu tienda» también en la
--     base: con el interruptor apagado responde not_found (como profit_report).
--
-- Reversa: drop function public.imports_photo_check_finish(uuid, uuid, jsonb, text),
--   public.imports_photo_check_begin(uuid, uuid, boolean) y la tabla
--   public.import_photo_checks (solo resultados de revisión, desechables);
--   drop function system.purge_retention(integer) y
--   alter function system.purge_retention_base(integer) rename to purge_retention
--   (con su grant a system_worker); store_alerts como en 20261112000100.
-- =============================================================================

-- 1. Registro de revisiones (tabla de tienda: RLS forzado, FK compuesta, sin
--    escritura directa; solo lectura con imports.run).
create table public.import_photo_checks (
  id            uuid primary key default app.uuid_v7(),
  store_id      uuid not null references public.stores (id) on delete cascade,
  import_job_id uuid not null,
  status        text not null default 'running' check (status in ('running', 'done', 'failed')),
  requested_by  uuid references auth.users (id) on delete set null,
  links         integer not null default 0 check (links between 0 and 100000),
  result        jsonb check (result is null or jsonb_typeof(result) = 'object'),
  error         text check (error is null or char_length(error) <= 300),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  expires_at    timestamptz not null default now() + interval '7 days',
  unique (store_id, id),
  foreign key (store_id, import_job_id) references public.import_jobs (store_id, id) on delete cascade
);
create index import_photo_checks_job_idx on public.import_photo_checks (store_id, import_job_id, started_at desc);
create index import_photo_checks_running_idx on public.import_photo_checks (started_at) where status = 'running';
create index import_photo_checks_expires_idx on public.import_photo_checks (expires_at);
-- Toda FK con índice (118_keys_and_fk_indexes): borrar un usuario no recorre la tabla.
create index import_photo_checks_requested_by_idx on public.import_photo_checks (requested_by);

create trigger import_photo_checks_prevent_tenant_change before update on public.import_photo_checks
  for each row execute function app.prevent_tenant_change();

alter table public.import_photo_checks enable row level security;
alter table public.import_photo_checks force row level security;
revoke all on table public.import_photo_checks from public, anon, authenticated, service_role;
grant select on table public.import_photo_checks to authenticated;
create policy import_photo_checks_select on public.import_photo_checks for select to authenticated
  using (app.has_store_permission(store_id, 'imports.run'));

-- 2. Empezar una revisión. Devuelve qué hacer:
--    start (con los enlaces), reuse (resultado guardado), running (esta
--    importación ya se revisa), busy (otra de la tienda), busy_platform,
--    rate_limited o no_links.
create function public.imports_photo_check_begin(p_store_id uuid, p_job_id uuid, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid;
  v_job     public.import_jobs;
  v_last    public.import_photo_checks;
  v_total   integer;
  v_links   jsonb;
  v_id      uuid;
  v_stale   constant interval := interval '2 minutes';
begin
  v_uid := app.require_store_permission(p_store_id, 'imports.run');
  perform app.require_store_permission(p_store_id, 'products.update');
  select * into v_job from public.import_jobs j where j.store_id = p_store_id and j.id = p_job_id for update;
  if v_job.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'import_job';
  end if;
  if v_job.status <> 'validated' then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'import_not_validated';
  end if;
  -- Una sola decisión a la vez en toda la plataforma (milisegundos): así los
  -- topes de simultáneas no se rebasan por dos peticiones al mismo tiempo.
  perform pg_advisory_xact_lock(hashtextextended('imports.photo_check', 0));

  -- Retención de la tienda (además de la purga diaria) y revisiones colgadas.
  delete from public.import_photo_checks c where c.store_id = p_store_id and c.expires_at < now();
  update public.import_photo_checks c
     set status = 'failed', error = 'expired', finished_at = now()
   where c.status = 'running' and c.started_at < now() - v_stale;

  if exists (select 1 from public.import_photo_checks c
              where c.store_id = p_store_id and c.import_job_id = p_job_id and c.status = 'running') then
    return jsonb_build_object('action', 'running');
  end if;

  -- Reutilizar: los enlaces de una vista previa no cambian.
  select * into v_last from public.import_photo_checks c
   where c.store_id = p_store_id and c.import_job_id = p_job_id and c.status = 'done'
     and c.finished_at > now() - interval '24 hours'
   order by c.finished_at desc limit 1;
  if v_last.id is not null
     and (not coalesce(p_force, false) or v_last.finished_at > now() - interval '10 minutes') then
    return jsonb_build_object('action', 'reuse', 'check_id', v_last.id, 'finished_at', v_last.finished_at,
                              'result', v_last.result,
                              'retry_after_seconds',
                              greatest(0, ceil(extract(epoch from (v_last.finished_at + interval '10 minutes' - now()))))::integer);
  end if;

  -- Enlaces distintos del archivo, en el orden de sus filas (máximo 500).
  with l as (
    select distinct on (u.url) u.url, r.row_number, coalesce(r.normalized ->> 'handle', '') as handle
      from public.import_job_rows r
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(r.normalized -> 'images') = 'array' then r.normalized -> 'images' else '[]'::jsonb end) as u(url)
     where r.store_id = p_store_id and r.import_job_id = p_job_id and r.normalized is not null
     order by u.url, r.row_number
  )
  select count(*)::integer,
         coalesce((select jsonb_agg(jsonb_build_object('url', x.url, 'row', x.row_number, 'handle', x.handle)
                                    order by x.row_number, x.url)
                     from (select * from l order by l.row_number, l.url limit 500) x), '[]'::jsonb)
    into v_total, v_links
    from l;
  if v_total = 0 then
    return jsonb_build_object('action', 'no_links');
  end if;

  -- Topes de simultáneas (después de saber que hay algo que revisar).
  if exists (select 1 from public.import_photo_checks c where c.store_id = p_store_id and c.status = 'running') then
    return jsonb_build_object('action', 'busy');
  end if;
  if (select count(*) from public.import_photo_checks c where c.status = 'running') >= 8 then
    return jsonb_build_object('action', 'busy_platform');
  end if;

  -- El tope por hora cuenta solo las revisiones que de verdad salen a internet.
  if not app.rate_limit_take('imports.photo_check:' || p_store_id::text, 10, 3600) then
    return jsonb_build_object('action', 'rate_limited');
  end if;

  insert into public.import_photo_checks (store_id, import_job_id, requested_by, links)
  values (p_store_id, p_job_id, v_uid, v_total)
  returning id into v_id;
  return jsonb_build_object('action', 'start', 'check_id', v_id, 'total_links', v_total, 'links', v_links);
end
$$;
revoke all on function public.imports_photo_check_begin(uuid, uuid, boolean) from public;
grant execute on function public.imports_photo_check_begin(uuid, uuid, boolean) to authenticated;

-- 3. Guardar el resultado (o el error) de una revisión. Solo quien la empezó, y
--    solo mientras sigue en curso; la forma del resultado se valida aquí.
create function public.imports_photo_check_finish(p_store_id uuid, p_check_id uuid, p_result jsonb,
                                                  p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid;
  v_check public.import_photo_checks;
  v_known constant text[] := array['ok', 'blocked', 'not_found', 'no_domain', 'too_large', 'failed',
                                   'not_image', 'not_checked'];
begin
  v_uid := app.require_store_permission(p_store_id, 'imports.run');
  select * into v_check from public.import_photo_checks c
   where c.store_id = p_store_id and c.id = p_check_id for update;
  if v_check.id is null or v_check.requested_by is distinct from v_uid then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'photo_check';
  end if;
  if v_check.status <> 'running' then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'photo_check_finished';
  end if;
  if p_error is not null then
    update public.import_photo_checks
       set status = 'failed', error = left(p_error, 300), finished_at = now()
     where id = v_check.id;
    return;
  end if;
  if jsonb_typeof(p_result) is distinct from 'object'
     or jsonb_typeof(p_result -> 'total') is distinct from 'number'
     or jsonb_typeof(p_result -> 'checked') is distinct from 'number'
     or jsonb_typeof(p_result -> 'counts') is distinct from 'object'
     or jsonb_typeof(p_result -> 'problems') is distinct from 'array'
     or jsonb_array_length(p_result -> 'problems') > 200
     or octet_length(p_result::text) > 131072
     or exists (select 1 from jsonb_each(p_result -> 'counts') e
                 where not (e.key = any (v_known)) or jsonb_typeof(e.value) <> 'number')
     or exists (select 1 from jsonb_array_elements(p_result -> 'problems') x
                 where jsonb_typeof(x) <> 'object'
                    or jsonb_typeof(x -> 'row') is distinct from 'number'
                    or not ((x ->> 'status') = any (v_known))
                    or char_length(coalesce(x ->> 'handle', '')) > 200
                    or char_length(coalesce(x ->> 'link', '')) > 300) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'photo_check_result';
  end if;
  update public.import_photo_checks
     set status = 'done', result = p_result, finished_at = now()
   where id = v_check.id;
end
$$;
revoke all on function public.imports_photo_check_finish(uuid, uuid, jsonb, text) from public;
grant execute on function public.imports_photo_check_finish(uuid, uuid, jsonb, text) to authenticated;

-- 4. Retención: la purga diaria del ADR-060 también borra las revisiones vencidas.
alter function system.purge_retention(integer) rename to purge_retention_base;
revoke all on function system.purge_retention_base(integer) from public, system_worker;

create function system.purge_retention(p_batch integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch  integer := least(greatest(coalesce(p_batch, 5000), 1), 50000);
  v_result jsonb := system.purge_retention_base(p_batch);
  v_checks integer;
begin
  delete from public.import_photo_checks c
   where c.id in (select c2.id from public.import_photo_checks c2
                   where c2.expires_at < now() order by c2.expires_at limit v_batch);
  get diagnostics v_checks = row_count;
  return v_result || jsonb_build_object('photo_checks', v_checks,
                                        'more', coalesce((v_result ->> 'more')::boolean, false) or v_checks = v_batch);
end
$$;
revoke all on function system.purge_retention(integer) from public;
grant execute on function system.purge_retention(integer) to system_worker;

-- 5. D6: el interruptor también en la base.
create or replace function public.store_alerts(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stock   boolean;
  v_out     integer;
  v_photo   integer;
  v_low     integer;
  v_nocat   integer;
begin
  perform app.require_store_permission(p_store_id, 'products.read');
  -- D6 (Orden 10): sin «Salud de tu tienda» encendida no hay alertas, ni por la API.
  if not app.flag_enabled('store_health', p_store_id) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'feature';
  end if;
  v_stock := app.has_store_permission(p_store_id, 'inventory.read');

  -- Mismos criterios que catalog_search_products (p_status = 'active').
  select count(*) filter (where not exists (
           select 1 from public.media m where m.store_id = p.store_id and m.product_id = p.id
              and m.status = 'ready' and m.deleted_at is null)),
         count(*) filter (where not exists (
           select 1 from public.product_categories pc where pc.store_id = p.store_id and pc.product_id = p.id)),
         count(*) filter (where v_stock and exists (
           select 1 from public.product_variants v
            where v.store_id = p.store_id and v.product_id = p.id and v.deleted_at is null and v.status = 'active'
              and v.track_inventory and v.inventory_policy = 'deny'
              and coalesce((select sum(l.available) from public.inventory_levels l
                              join public.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id and loc.is_active
                             where l.store_id = v.store_id and l.variant_id = v.id), 0) <= 0)),
         count(*) filter (where v_stock and exists (
           select 1 from public.product_variants v
             join public.inventory_levels l on l.store_id = v.store_id and l.variant_id = v.id
             join public.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id and loc.is_active
            where v.store_id = p.store_id and v.product_id = p.id and v.deleted_at is null and v.status = 'active'
              and v.track_inventory and l.low_stock_threshold is not null
              and l.available > 0 and l.available <= l.low_stock_threshold))
    into v_photo, v_nocat, v_out, v_low
    from public.products p
   where p.store_id = p_store_id and p.status = 'active' and p.deleted_at is null;

  return jsonb_build_object(
    'out_of_stock', case when v_stock then v_out end,
    'low_stock', case when v_stock then v_low end,
    'without_photo', v_photo,
    'without_category', v_nocat);
end
$$;

-- Versión del esquema (D-POR-06).
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261113000100'::text
$$;
