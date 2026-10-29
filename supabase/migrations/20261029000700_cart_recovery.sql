-- ADR-048 (aprobado el 2026-10-29, opción B; PENDIENTE DE REVISIÓN legal):
-- un solo recordatorio por correo a quien dejó su carrito con correo, 3 horas
-- después de su última actividad, con enlace para recuperarlo y enlace para no
-- recibir más. Cada tienda lo activa (viene apagado). Sin descuentos automáticos.

-- -----------------------------------------------------------------------------
-- 1. Ajuste por tienda y marcas del carrito.
-- -----------------------------------------------------------------------------
alter table public.store_notification_settings add column cart_recovery boolean not null default false;

alter table public.carts
  add column recovery_sent_at    timestamptz,
  add column recovery_token_hash bytea;
alter table public.carts
  add constraint carts_recovery_token_hash_check check (recovery_token_hash is null or octet_length(recovery_token_hash) = 32);
create unique index carts_recovery_token_uq on public.carts (recovery_token_hash) where recovery_token_hash is not null;
create index carts_recovery_due_idx on public.carts (last_activity_at)
  where status = 'active' and email is not null and recovery_sent_at is null;

-- Correos que pidieron no recibir recordatorios de esa tienda (solo el hash).
create table public.cart_recovery_optouts (
  id         uuid not null default app.uuid_v7() primary key,
  store_id   uuid not null references public.stores (id) on delete cascade,
  email_hash bytea not null check (octet_length(email_hash) = 32),
  created_at timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, email_hash)
);
alter table public.cart_recovery_optouts enable row level security;
alter table public.cart_recovery_optouts force row level security;
revoke all on table public.cart_recovery_optouts from public, anon, authenticated, service_role, storefront_gateway, system_worker;
grant select on table public.cart_recovery_optouts to authenticated;
create policy cart_recovery_optouts_select on public.cart_recovery_optouts for select to authenticated
  using (app.has_store_permission(store_id, 'notifications.manage'));
create trigger cart_recovery_optouts_prevent_tenant_change before update on public.cart_recovery_optouts
  for each row execute function app.prevent_tenant_change();

create function app.email_hash(p_email text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select sha256(convert_to(lower(btrim(p_email)), 'UTF8'))
$$;
revoke all on function app.email_hash(text) from public;

-- -----------------------------------------------------------------------------
-- 2. Activar o apagar desde Ajustes → Notificaciones.
-- -----------------------------------------------------------------------------
create function public.notifications_set_cart_recovery(p_store_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'notifications.manage');
  if p_enabled is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'enabled';
  end if;
  insert into public.store_notification_settings (store_id, cart_recovery)
  values (p_store_id, p_enabled)
  on conflict (store_id) do update set cart_recovery = excluded.cart_recovery;
  perform audit.record('store.cart_recovery_' || case when p_enabled then 'enabled' else 'disabled' end, 'store',
                       p_store_id, (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('cart_recovery', p_enabled));
end
$$;
revoke all on function public.notifications_set_cart_recovery(uuid, boolean) from public;
grant execute on function public.notifications_set_cart_recovery(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Carritos que toca recordar: los marca (una sola vez) y entrega el token del
--    enlace al worker, que solo lo usa para el correo (en la base queda su hash).
-- -----------------------------------------------------------------------------
create function system.cart_recovery_due(p_limit integer default 50)
returns table (cart_id uuid, store_id uuid, email text, token text, store jsonb, items jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart  public.carts;
  v_token text;
begin
  for v_cart in
    select c.* from public.carts c
      join public.stores s on s.id = c.store_id and s.status = 'active'
      join public.organizations o on o.id = s.organization_id and o.status = 'active'
      join public.store_notification_settings n on n.store_id = c.store_id and n.cart_recovery
     where c.status = 'active' and c.email is not null and c.recovery_sent_at is null
       -- Entre 3 y 48 horas sin actividad: al activarlo no se escribe a carritos viejos.
       and c.last_activity_at between now() - interval '48 hours' and now() - interval '3 hours'
       and c.expires_at > now() + interval '1 hour'
       and exists (select 1 from public.cart_items i where i.cart_id = c.id)
       and not exists (select 1 from public.orders od where od.store_id = c.store_id and od.cart_id = c.id)
       and not exists (select 1 from public.cart_recovery_optouts x
                        where x.store_id = c.store_id and x.email_hash = app.email_hash(c.email))
     order by c.last_activity_at
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
     for update of c skip locked
  loop
    -- 32 bytes aleatorios (dos UUID v4) en base64url sin relleno: 43 caracteres.
    v_token := translate(encode(decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'),
                                'base64'), '+/=', '-_');
    update public.carts c
       set recovery_sent_at = now(), recovery_token_hash = sha256(convert_to(v_token, 'UTF8'))
     where c.id = v_cart.id;
    cart_id := v_cart.id;
    store_id := v_cart.store_id;
    email := v_cart.email;
    token := v_token;
    select jsonb_build_object(
             'name', s.name, 'handle', s.handle, 'locale', s.locale, 'organization_id', s.organization_id,
             'hostname', (select d.hostname from public.store_domains d
                           where d.store_id = s.id and d.is_primary and d.status = 'active'))
      into store from public.stores s where s.id = v_cart.store_id;
    select coalesce(jsonb_agg(jsonb_build_object('title', p.title, 'quantity', i.quantity) order by i.created_at), '[]'::jsonb)
      into items
      from public.cart_items i
      join public.product_variants v on v.store_id = i.store_id and v.id = i.variant_id
      join public.products p on p.store_id = v.store_id and p.id = v.product_id
     where i.cart_id = v_cart.id;
    return next;
  end loop;
end
$$;
revoke all on function system.cart_recovery_due(integer) from public;
grant execute on function system.cart_recovery_due(integer) to system_worker;

-- -----------------------------------------------------------------------------
-- 4. Tienda: recuperar el carrito con el enlace (un solo uso; rota el token de
--    la cookie) y darse de baja de los recordatorios.
-- -----------------------------------------------------------------------------
create function storefront.cart_recover(p_store_id uuid, p_recovery_token text, p_new_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart uuid;
begin
  if p_recovery_token is null or p_recovery_token !~ '^[A-Za-z0-9_-]{43}$'
     or p_new_token is null or p_new_token !~ '^[A-Za-z0-9_-]{43}$' then
    return false;
  end if;
  update public.carts c
     set token_hash = app.cart_token_hash(p_new_token), recovery_token_hash = null, last_activity_at = now()
   where c.store_id = p_store_id and c.recovery_token_hash = sha256(convert_to(p_recovery_token, 'UTF8'))
     and c.status = 'active' and c.expires_at > now()
  returning c.id into v_cart;
  return v_cart is not null;
end
$$;
revoke all on function storefront.cart_recover(uuid, text, text) from public;
grant execute on function storefront.cart_recover(uuid, text, text) to storefront_gateway;

-- El enlace del correo lleva el hash del correo (no el correo) firmado con HMAC por
-- el servidor, que verifica la firma antes de llamar; aquí solo se guarda el hash.
create function storefront.cart_recovery_optout(p_store_id uuid, p_email_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_email_hash is null or p_email_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'email_hash';
  end if;
  if not exists (select 1 from public.stores s where s.id = p_store_id) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'store';
  end if;
  insert into public.cart_recovery_optouts (store_id, email_hash)
  values (p_store_id, decode(p_email_hash, 'hex'))
  on conflict (store_id, email_hash) do nothing;
end
$$;
revoke all on function storefront.cart_recovery_optout(uuid, text) from public;
grant execute on function storefront.cart_recovery_optout(uuid, text) to storefront_gateway;

-- -----------------------------------------------------------------------------
-- 5. Mantenimiento: encola el envío cada 15 minutos (misma función que 20261029000600 + el paso nuevo).
-- -----------------------------------------------------------------------------
create or replace function system.enqueue_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.enqueue_job('media.purge_orphans', '{}'::jsonb, null,
                          'media.purge_orphans:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
  perform app.enqueue_job('orders.expire', '{}'::jsonb, null,
                          'orders.expire:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'), now(), 3);
  perform app.enqueue_job('rate_limits.purge', '{}'::jsonb, null,
                          'rate_limits.purge:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
  perform app.enqueue_job('payments.reconcile', '{}'::jsonb, null,
                          'payments.reconcile:' || to_char(date_trunc('hour', now() at time zone 'utc')
                            + floor(extract(minute from now() at time zone 'utc') / 10) * interval '10 minutes',
                            'YYYY-MM-DD"T"HH24:MI'), now(), 3);
  perform app.enqueue_job('orders.complete', '{}'::jsonb, null,
                          'orders.complete:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
  -- Tanda 7: publicaciones programadas que ya vencieron.
  perform app.enqueue_job('catalog.publish_scheduled', '{}'::jsonb, null,
                          'catalog.publish_scheduled:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'),
                          now(), 3);
  -- ADR-030: ofertas con fechas que empiezan o terminan.
  perform app.enqueue_job('catalog.apply_sales', '{}'::jsonb, null,
                          'catalog.apply_sales:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'),
                          now(), 3);
  -- Paso 8: copias en varios tamaños de las fotos que aún no las tienen (por hora).
  if exists (select 1 from public.media m
              where m.status = 'ready' and not m.variants_done and m.deleted_at is null) then
    perform app.enqueue_job('media.backfill_variants', '{}'::jsonb, null,
                            'media.backfill_variants:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24'),
                            now(), 3);
  end if;
  perform system.fail_stuck_imports();
  -- F10: periodos vencidos → pago pendiente → pausa (§19.4). Solo toca filas vencidas.
  perform system.subscriptions_advance();
  -- ADR-041: llaves de Mercado Pago de los comercios que vencen en menos de 30 días.
  perform system.mercadopago_enqueue_refresh();
  -- ADR-046: datos personales de tiendas cerradas hace más de 30 días.
  perform system.anonymize_closed_stores(5);
  -- ADR-048: recordatorios de carritos (cada 15 minutos; solo tiendas que lo activaron).
  if exists (select 1 from public.store_notification_settings n where n.cart_recovery) then
    perform app.enqueue_job('carts.recover', '{}'::jsonb, null,
                            'carts.recover:' || to_char(date_trunc('hour', now() at time zone 'utc')
                              + floor(extract(minute from now() at time zone 'utc') / 15) * interval '15 minutes',
                              'YYYY-MM-DD"T"HH24:MI'), now(), 3);
  end if;
  -- Misión vendible F1.6: revisión de salud cada 15 minutos (el job solo avisa si hay problemas).
  perform app.enqueue_job('platform.health_check', '{}'::jsonb, null,
                          'platform.health_check:' || to_char(date_trunc('hour', now() at time zone 'utc')
                            + floor(extract(minute from now() at time zone 'utc') / 15) * interval '15 minutes',
                            'YYYY-MM-DD"T"HH24:MI'), now(), 3);
end
$$;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261029000700'::text
$$;
