-- =============================================================================
-- Publicación masiva por candidatos (Orden 10, mensaje 4; decisión del
-- propietario). La columna «Publicado» (o status = active) de una importación
-- es una INTENCIÓN, no un atajo: nunca se salta las reglas de publicación.
--
--  * Al aplicar la importación, cada producto que pide publicarse y no está
--    publicado queda como candidato (public.publish_run_items) en una corrida
--    (public.publish_runs, una por importación). Antes se publicaba dentro de la
--    misma transacción y un solo producto que no cumplía tumbaba el archivo.
--  * Un trabajo en segundo plano (catalog.publish_run → system.publish_run_step)
--    revisa los candidatos por tandas con las reglas de siempre
--    (app.validate_product_for_publish, incluido Cumplimiento) y publica los que
--    cumplen con public.catalog_publish_product, como quien importó (revalida
--    products.publish, CF-10). Los que no cumplen se quedan sin publicar con su
--    motivo. Nunca se publica un producto que incumpla Cumplimiento.
--  * Idempotente y reanudable: cada candidato se procesa una vez (pendiente →
--    publicado / ya estaba / bloqueado / omitido); una tanda interrumpida se
--    revierte entera y la siguiente sigue donde quedó. Seguro con dos workers:
--    la corrida se bloquea por tanda y los candidatos se toman con SKIP LOCKED.
--  * Aislado por tienda (FK compuestas, RLS forzado, lectura con imports.run) y
--    observable (totales por estado y por motivo, auditoría al terminar).
--
-- Reversa: volver a las definiciones de app.import_request_publish y
--   app.import_after_rows de 20261113000200 (publicar dentro de la importación);
--   drop de system.publish_run_step y de las tablas publish_run_items y
--   publish_runs (solo registros de la corrida; los productos publicados se
--   quedan publicados).
-- =============================================================================

create table public.publish_runs (
  id            uuid primary key default app.uuid_v7(),
  store_id      uuid not null references public.stores (id) on delete cascade,
  import_job_id uuid not null,
  requested_by  uuid references auth.users (id) on delete set null,
  status        text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  totals        jsonb not null default '{}'::jsonb check (jsonb_typeof(totals) = 'object'),
  error         text check (error is null or char_length(error) <= 300),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz,
  unique (store_id, id),
  unique (store_id, import_job_id),
  foreign key (store_id, import_job_id) references public.import_jobs (store_id, id) on delete cascade
);
create index publish_runs_requested_by_idx on public.publish_runs (requested_by);

create table public.publish_run_items (
  id           uuid primary key default app.uuid_v7(),
  store_id     uuid not null references public.stores (id) on delete cascade,
  run_id       uuid not null,
  product_id   uuid not null,
  status       text not null default 'pending'
               check (status in ('pending', 'published', 'already', 'blocked', 'skipped')),
  reasons      text[] not null default '{}' check (cardinality(reasons) <= 20),
  processed_at timestamptz,
  unique (store_id, id),
  unique (run_id, product_id),
  foreign key (store_id, run_id) references public.publish_runs (store_id, id) on delete cascade,
  foreign key (store_id, product_id) references public.products (store_id, id) on delete cascade
);
create index publish_run_items_pending_idx on public.publish_run_items (run_id, id) where status = 'pending';
create index publish_run_items_store_run_idx on public.publish_run_items (store_id, run_id, status);
create index publish_run_items_product_idx on public.publish_run_items (store_id, product_id);

create trigger publish_runs_set_updated_at before update on public.publish_runs
  for each row execute function app.set_updated_at();
create trigger publish_runs_prevent_tenant_change before update on public.publish_runs
  for each row execute function app.prevent_tenant_change();
create trigger publish_run_items_prevent_tenant_change before update on public.publish_run_items
  for each row execute function app.prevent_tenant_change();

alter table public.publish_runs enable row level security;
alter table public.publish_runs force row level security;
alter table public.publish_run_items enable row level security;
alter table public.publish_run_items force row level security;
revoke all on table public.publish_runs, public.publish_run_items from public, anon, authenticated, service_role;
grant select on table public.publish_runs, public.publish_run_items to authenticated;
create policy publish_runs_select on public.publish_runs for select to authenticated
  using (app.has_store_permission(store_id, 'imports.run'));
create policy publish_run_items_select on public.publish_run_items for select to authenticated
  using (app.has_store_permission(store_id, 'imports.run'));

-- Puntos de extensión de system.import_commit (20261113000200): ahora registran
-- candidatos en lugar de publicar dentro de la importación.
create or replace function app.import_request_publish(p_job_id uuid, p_store_id uuid, p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run uuid;
begin
  insert into public.publish_runs (store_id, import_job_id, requested_by)
  select p_store_id, p_job_id, j.commit_requested_by from public.import_jobs j
   where j.store_id = p_store_id and j.id = p_job_id
  on conflict (store_id, import_job_id) do nothing;
  select r.id into v_run from public.publish_runs r where r.store_id = p_store_id and r.import_job_id = p_job_id;
  insert into public.publish_run_items (store_id, run_id, product_id)
  values (p_store_id, v_run, p_product_id)
  on conflict (run_id, product_id) do nothing;
end
$$;
revoke all on function app.import_request_publish(uuid, uuid, uuid) from public;

create or replace function app.import_after_rows(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.publish_runs;
  v_n   integer;
begin
  select r.* into v_run from public.publish_runs r
    join public.import_jobs j on j.store_id = r.store_id and j.id = r.import_job_id
   where j.id = p_job_id;
  if v_run.id is null then
    return;
  end if;
  select count(*)::integer into v_n from public.publish_run_items i
   where i.store_id = v_run.store_id and i.run_id = v_run.id;
  update public.publish_runs
     set totals = jsonb_build_object('candidates', v_n, 'pending', v_n, 'published', 0, 'already', 0,
                                     'blocked', 0, 'skipped', 0, 'reasons', '{}'::jsonb, 'groups', '{}'::jsonb)
   where id = v_run.id;
  -- En la misma transacción que la importación: si no se aplica, no hay trabajo.
  perform app.enqueue_job('catalog.publish_run', jsonb_build_object('run_id', v_run.id), v_run.store_id,
                          'catalog.publish_run:' || v_run.id, now(), 5);
end
$$;
revoke all on function app.import_after_rows(uuid) from public;

-- Totales de una corrida a partir de sus candidatos (por estado, por motivo y por grupo).
create function app.publish_run_totals(p_run_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'candidates', count(*)::integer,
    'pending',    count(*) filter (where i.status = 'pending')::integer,
    'published',  count(*) filter (where i.status = 'published')::integer,
    'already',    count(*) filter (where i.status = 'already')::integer,
    'blocked',    count(*) filter (where i.status = 'blocked')::integer,
    'skipped',    count(*) filter (where i.status = 'skipped')::integer,
    'reasons', coalesce((select jsonb_object_agg(x.code, x.n) from (
                  select r as code, count(*)::integer as n
                    from public.publish_run_items b, unnest(b.reasons) r
                   where b.run_id = p_run_id and b.status = 'blocked' group by r) x), '{}'::jsonb),
    -- Por producto: un producto sin ficha y con precio 0 cuenta en los dos grupos.
    'groups', coalesce((select jsonb_object_agg(x.g, x.n) from (
                  select g, count(distinct b.id)::integer as n
                    from public.publish_run_items b
                    cross join lateral (select distinct
                        case when r like 'compliance%' then 'compliance'
                             when r in ('price_zero', 'compare_at_price_invalid') then 'price'
                             when r = 'no_active_variant' then 'variant'
                             when r = 'permission' then 'permission'
                             else 'other' end as g
                       from unnest(b.reasons) r) gg
                   where b.run_id = p_run_id and b.status = 'blocked' group by g) x), '{}'::jsonb))
    from public.publish_run_items i where i.run_id = p_run_id
$$;
revoke all on function app.publish_run_totals(uuid) from public;

-- Una tanda de la corrida (la llama el worker). Devuelve cuántos quedan.
create function system.publish_run_step(p_run_id uuid, p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run     public.publish_runs;
  v_item    record;
  v_product record;
  v_codes   text[];
  v_status  text;
  v_msg     text;
  v_hint    text;
  v_done    integer := 0;
  v_left    integer;
  v_totals  jsonb;
  v_limit   integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
begin
  -- Una tanda a la vez por corrida (dos workers no publican lo mismo dos veces).
  select * into v_run from public.publish_runs r where r.id = p_run_id for update;
  if v_run.id is null then
    return jsonb_build_object('status', 'missing', 'remaining', 0);
  end if;
  if v_run.status in ('completed', 'failed') then
    return jsonb_build_object('status', v_run.status, 'remaining', 0, 'replayed', true);
  end if;

  -- CF-10: quien importó debe CONSERVAR el permiso de publicar.
  if not coalesce(system.user_has_store_permission(v_run.requested_by, v_run.store_id, 'products.publish'), false) then
    update public.publish_run_items
       set status = 'blocked', reasons = array['permission'], processed_at = now()
     where store_id = v_run.store_id and run_id = v_run.id and status = 'pending';
    v_totals := app.publish_run_totals(v_run.id);
    update public.publish_runs
       set status = 'failed', totals = v_totals, finished_at = now(),
           error = 'Quien importó ya no puede publicar productos: no se publicó nada más.'
     where id = v_run.id;
    perform audit.record('catalog.publish_run', 'publish_run', v_run.id,
                         (select s.organization_id from public.stores s where s.id = v_run.store_id), v_run.store_id,
                         null, v_totals || jsonb_build_object('status', 'failed', 'import_job_id', v_run.import_job_id));
    return jsonb_build_object('status', 'failed', 'remaining', 0);
  end if;

  if v_run.status = 'queued' then
    update public.publish_runs set status = 'running' where id = v_run.id;
  end if;
  -- Las RPC del catálogo actúan como quien importó (sus permisos y su nombre en el historial).
  perform set_config('request.jwt.claims',
                     jsonb_build_object('sub', v_run.requested_by, 'role', 'authenticated', 'aal', 'aal2',
                                        'pruva_job', 'catalog.publish_run')::text, true);
  for v_item in
    select i.id, i.product_id from public.publish_run_items i
     where i.store_id = v_run.store_id and i.run_id = v_run.id and i.status = 'pending'
     order by i.id
     limit v_limit
     for update skip locked
  loop
    v_codes := '{}';
    select p.status, p.deleted_at into v_product from public.products p
     where p.store_id = v_run.store_id and p.id = v_item.product_id;
    if v_product.status is null or v_product.deleted_at is not null then
      v_status := 'skipped';
      v_codes := array['deleted'];
    elsif v_product.status = 'active' then
      v_status := 'already';
    elsif v_product.status <> 'draft' then
      -- Alguien lo archivó después de importar: no se publica a sus espaldas.
      v_status := 'skipped';
      v_codes := array[v_product.status];
    else
      v_codes := array(select v.code from app.validate_product_for_publish(v_item.product_id) v
                        where v.level = 'error' order by v.code);
      if cardinality(v_codes) > 0 then
        v_status := 'blocked';
      else
        begin
          perform public.catalog_publish_product(v_run.store_id, v_item.product_id);
          v_status := 'published';
        exception when others then
          -- Cambió algo entre la revisión y la publicación: se registra el motivo.
          get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
          v_status := 'blocked';
          v_codes := coalesce(nullif(regexp_split_to_array(coalesce(v_hint, ''), '\s*,\s*'), array['']),
                              array[left(v_msg, 60)]);
        end;
      end if;
    end if;
    update public.publish_run_items
       set status = v_status, reasons = v_codes[1:20], processed_at = now()
     where id = v_item.id;
    v_done := v_done + 1;
  end loop;
  perform set_config('request.jwt.claims', '', true);

  v_totals := app.publish_run_totals(v_run.id);
  v_left := (v_totals ->> 'pending')::integer;
  update public.publish_runs
     set totals = v_totals,
         status = case when v_left = 0 then 'completed' else 'running' end,
         finished_at = case when v_left = 0 then now() end
   where id = v_run.id;
  if v_left = 0 then
    perform audit.record('catalog.publish_run', 'publish_run', v_run.id,
                         (select s.organization_id from public.stores s where s.id = v_run.store_id), v_run.store_id,
                         null, v_totals || jsonb_build_object('status', 'completed', 'import_job_id', v_run.import_job_id));
  end if;
  return jsonb_build_object('status', case when v_left = 0 then 'completed' else 'running' end,
                            'processed', v_done, 'remaining', v_left);
end
$$;
revoke all on function system.publish_run_step(uuid, integer) from public;
grant execute on function system.publish_run_step(uuid, integer) to system_worker;

-- Versión del esquema (D-POR-06).
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261113000300'::text
$$;
