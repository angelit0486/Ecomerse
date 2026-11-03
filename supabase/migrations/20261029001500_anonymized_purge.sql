-- =============================================================================
-- ADR-046, paso 2 (aprobado por el propietario el 2026-10-29): después de
-- anonimizar una tienda cerrada se borran
--   1. sus archivos en Storage (fotos publicadas, copias por tamaño y subidas
--      pendientes): todo objeto de `store-media` y `store-uploads` bajo su id;
--   2. las cuentas de Auth de sus compradores que nadie más usa (ni otra tienda,
--      ni un equipo, ni la plataforma). Aquí solo se anotan y se decide cuáles;
--      borrarlas amplía SR-1 (GATE0 §11.5) y espera ADR-055. Anotarlas ahora es
--      necesario porque el vínculo con la tienda se pierde al anonimizar.
-- El borrado lo hace el worker con Storage Admin (src/server/privileged, SR-2);
-- la base decide QUÉ se borra y solo para tiendas anonimizadas. Las filas de
-- `media` se conservan (sin datos personales; borrarlas chocaría con las FK del
-- catálogo, que no se toca). Pedidos y auditoría no cambian (regla 9).
-- =============================================================================

alter table public.stores add column files_purged_at timestamptz;

-- Cuentas por revisar. Sin datos personales: solo el id de Auth.
create table system.auth_user_purge_queue (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  queued_at timestamptz not null default now()
);
alter table system.auth_user_purge_queue enable row level security;
alter table system.auth_user_purge_queue force row level security;
revoke all on table system.auth_user_purge_queue from public, anon, authenticated, service_role;

create or replace function system.anonymize_closed_stores(p_limit integer default 5)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
  v_count integer := 0;
  v_orders integer;
  v_customers integer;
begin
  for v_store in
    select s.* from public.stores s
     where s.status = 'closed' and s.anonymized_at is null and s.closed_at < now() - interval '30 days'
     order by s.closed_at
     limit least(greatest(coalesce(p_limit, 5), 1), 50)
     for update skip locked
  loop
    perform set_config('app.anonymizing', 'on', true);

    update public.orders o
       set email = 'anonimo-' || replace(o.id::text, '-', '') || '@anonimizado.invalid',
           customer_name = 'Anónimo', phone = null, customer_note = null,
           shipping_address = app.anonymous_address(o.shipping_address),
           billing_address = app.anonymous_address(o.billing_address)
     where o.store_id = v_store.id
       and o.email <> 'anonimo-' || replace(o.id::text, '-', '') || '@anonimizado.invalid';
    get diagnostics v_orders = row_count;

    -- Paso 2: las cuentas de Auth de sus compradores se revisan después (el
    -- vínculo se pierde al anonimizar). Solo se borra la que nadie más usa.
    insert into system.auth_user_purge_queue (user_id)
    select distinct c.user_id from public.customers c
     where c.store_id = v_store.id and c.user_id is not null
    on conflict (user_id) do nothing;

    delete from public.customer_addresses a where a.store_id = v_store.id;
    -- Mismo resultado que «Borrar datos» de un cliente (customers_anonymize).
    update public.customers c
       set email = 'anonimo-' || replace(c.id::text, '-', '') || '@anonimizado.invalid',
           first_name = null, last_name = null, phone = null, note = null, user_id = null,
           accepts_marketing = false, marketing_consent_at = null, marketing_consent_source = null,
           anonymized_at = now()
     where c.store_id = v_store.id and c.anonymized_at is null;
    get diagnostics v_customers = row_count;

    update public.carts c set email = null, shipping_address = null
     where c.store_id = v_store.id and (c.email is not null or c.shipping_address is not null);
    update public.product_reviews r set author_name = 'Anónimo'
     where r.store_id = v_store.id and r.author_name is distinct from 'Anónimo';

    perform set_config('app.anonymizing', 'off', true);
    update public.stores s set anonymized_at = now() where s.id = v_store.id;
    perform audit.record('store.anonymized', 'store', v_store.id, v_store.organization_id, v_store.id, null,
                         jsonb_build_object('orders', v_orders, 'customers', v_customers),
                         'ADR-046: 30 días después del cierre');
    v_count := v_count + 1;
  end loop;
  -- Paso 2: archivos pendientes de tiendas ya anonimizadas (cada hora). Las
  -- cuentas en cola esperan ADR-055; el job no se encola solo por ellas.
  if exists (select 1 from public.stores s where s.anonymized_at is not null and s.files_purged_at is null) then
    perform app.enqueue_job('privacy.purge_anonymized', '{}'::jsonb, null,
                            'privacy.purge_anonymized:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24'),
                            now(), 3);
  end if;
  return v_count;
end
$$;

-- ¿Sigue usándose la cuenta? (otra tienda, un equipo o la plataforma).
create function app.auth_user_in_use(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.customers c where c.user_id = p_user_id)
      or exists (select 1 from public.organization_members m where m.user_id = p_user_id)
      or exists (select 1 from public.platform_staff p where p.user_id = p_user_id)
$$;
revoke all on function app.auth_user_in_use(uuid) from public;

-- Cuentas que se pueden borrar. Las que siguen en uso salen de la cola sin borrarse.
create function system.auth_user_purge_batch(p_limit integer default 50)
returns table (user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from system.auth_user_purge_queue q where app.auth_user_in_use(q.user_id);
  return query
    select q.user_id from system.auth_user_purge_queue q
     order by q.queued_at, q.user_id
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end
$$;

-- Justo antes de borrar: la cuenta sigue en la cola y nadie la usa.
create function system.auth_user_purge_claim(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from system.auth_user_purge_queue q where q.user_id = p_user_id)
     and not app.auth_user_in_use(p_user_id)
$$;

create function system.auth_user_purge_done(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from system.auth_user_purge_queue q where q.user_id = p_user_id;
  perform audit.record('privacy.buyer_account_deleted', 'user', p_user_id, null, null, null, null,
                       'ADR-046 paso 2: cuenta de comprador de tiendas anonimizadas');
end
$$;

-- Tiendas anonimizadas con archivos por borrar.
create function system.anonymized_stores_with_files(p_limit integer default 5)
returns table (store_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.stores s
   where s.anonymized_at is not null and s.files_purged_at is null
   order by s.anonymized_at, s.id
   limit least(greatest(coalesce(p_limit, 5), 1), 50)
$$;

-- Archivos de UNA tienda anonimizada (de otra tienda nunca devuelve nada).
create function system.anonymized_store_files(p_store_id uuid, p_limit integer default 500)
returns table (bucket text, path text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id in ('store-media', 'store-uploads')
     and o.name like p_store_id::text || '/%'
     and exists (select 1 from public.stores s
                  where s.id = p_store_id and s.anonymized_at is not null and s.files_purged_at is null)
   order by o.bucket_id, o.name
   limit least(greatest(coalesce(p_limit, 500), 1), 1000)
$$;

-- Marca la tienda como limpia solo si ya no le queda ningún archivo.
create function system.anonymized_store_files_done(p_store_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
begin
  select * into v_store from public.stores s
   where s.id = p_store_id and s.anonymized_at is not null and s.files_purged_at is null for update;
  if not found then
    return false;
  end if;
  if exists (select 1 from storage.objects o
              where o.bucket_id in ('store-media', 'store-uploads') and o.name like p_store_id::text || '/%') then
    return false;
  end if;
  update public.stores s set files_purged_at = now() where s.id = p_store_id;
  perform audit.record('store.files_purged', 'store', p_store_id, v_store.organization_id, p_store_id, null, null,
                       'ADR-046 paso 2: archivos de la tienda anonimizada');
  return true;
end
$$;

revoke all on function system.auth_user_purge_batch(integer) from public;
revoke all on function system.auth_user_purge_claim(uuid) from public;
revoke all on function system.auth_user_purge_done(uuid) from public;
revoke all on function system.anonymized_stores_with_files(integer) from public;
revoke all on function system.anonymized_store_files(uuid, integer) from public;
revoke all on function system.anonymized_store_files_done(uuid) from public;
grant execute on function system.auth_user_purge_batch(integer) to system_worker;
grant execute on function system.auth_user_purge_claim(uuid) to system_worker;
grant execute on function system.auth_user_purge_done(uuid) to system_worker;
grant execute on function system.anonymized_stores_with_files(integer) to system_worker;
grant execute on function system.anonymized_store_files(uuid, integer) to system_worker;
grant execute on function system.anonymized_store_files_done(uuid) to system_worker;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261029001500'::text
$$;
