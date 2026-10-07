-- =============================================================================
-- Fase 8 · Cuenta del comprador por tienda (F8-T01). Contrato: GATE0 §7.4,
-- §7.5, §21.5, T-21.
--
-- * Un solo pool de Supabase Auth; el comprador entra con un código por email en
--   el dominio de la tienda (cookies host-only). Sesión aal1: los permisos de
--   staff exigen aal2, así que una sesión de comprador nunca ve el panel.
-- * storefront_link_customer vincula (o crea) el cliente de ESA tienda con
--   user_id = auth.uid() solo si el email de la cuenta está verificado y es el
--   del cliente. Los pedidos de invitado con ese email aparecen en la cuenta.
-- * Lecturas y escrituras de la cuenta por RPC (account_*): los datos de
--   contacto de los pedidos no tienen grant de columna (D-F6-01), así que el
--   comprador los obtiene solo de SUS pedidos a través de funciones que lo
--   verifican (D-F8-01).
-- * Intento de acceso: antes de pedir el código, el servidor registra (store,
--   hash del email) para que el Send Email Hook use la marca de esa tienda
--   (D-F7-07). Vive 15 minutos; nunca guarda el email en claro.
-- =============================================================================

create table system.auth_login_intents (
  email_hash bytea not null check (octet_length(email_hash) = 32),
  store_id   uuid not null references public.stores (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index auth_login_intents_lookup on system.auth_login_intents (email_hash, created_at desc);
create trigger auth_login_intents_prevent_tenant_change before update on system.auth_login_intents
  for each row execute function app.prevent_tenant_change();
alter table system.auth_login_intents enable row level security;
alter table system.auth_login_intents force row level security;
revoke all on table system.auth_login_intents from public, anon, authenticated, service_role;

-- Registra el intento y aplica el límite de frecuencia (por email y tienda, y por IP).
create or replace function storefront.record_login_intent(p_store_id uuid, p_email text, p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_hash  bytea;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'client';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'email';
  end if;
  if not exists (select 1 from public.stores s where s.id = p_store_id and s.status = 'active') then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'store';
  end if;
  v_hash := sha256(convert_to(v_email, 'UTF8'));
  if not app.rate_limit_take('buyer_otp:ip:' || p_store_id || ':' || p_ip_hash, 10, 900)
     or not app.rate_limit_take('buyer_otp:email:' || p_store_id || ':' || encode(v_hash, 'hex'), 5, 900) then
    perform system.record_security_event('customer.login_rate_limited', 'warning', null, p_store_id, null, null, null,
                                         jsonb_build_object('ip_hash', left(p_ip_hash, 16)));
    return false;
  end if;
  delete from system.auth_login_intents where created_at < now() - interval '1 day';
  insert into system.auth_login_intents (email_hash, store_id) values (v_hash, p_store_id);
  return true;
end
$$;

-- Marca de la tienda del intento más reciente (≤ 15 min) para el Send Email Hook.
create or replace function system.login_intent_store(p_email text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'name', s.name, 'contact_email', s.contact_email,
    'logo_path', (select m.storage_path from public.store_themes t
                    join public.media m on m.store_id = t.store_id and m.id = t.logo_media_id
                   where t.store_id = s.id and m.status = 'ready' and m.deleted_at is null),
    'primary_color', (select t.settings -> 'colors' ->> 'primary' from public.store_themes t where t.store_id = s.id))
    from system.auth_login_intents i
    join public.stores s on s.id = i.store_id
   where i.email_hash = sha256(convert_to(lower(btrim(p_email)), 'UTF8'))
     and i.created_at > now() - interval '15 minutes' and s.status = 'active'
   order by i.created_at desc
   limit 1
$$;

-- Cliente de la cuenta en esta tienda (null si no está vinculada).
create or replace function app.account_customer(p_store_id uuid)
returns public.customers
language sql
stable
security definer
set search_path = ''
as $$
  select c.* from public.customers c
    join public.stores s on s.id = c.store_id and s.status = 'active'
   where c.store_id = p_store_id and c.user_id = auth.uid() and auth.uid() is not null
     and c.anonymized_at is null and c.deleted_at is null
$$;
revoke all on function app.account_customer(uuid) from public;

create or replace function app.require_account(p_store_id uuid)
returns public.customers
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.customers;
begin
  v := app.account_customer(p_store_id);
  if v.id is null then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'account';
  end if;
  return v;
end
$$;
revoke all on function app.require_account(uuid) from public;

-- Vincula la sesión verificada con el cliente de la tienda (T-21: solo tras OTP).
create or replace function public.storefront_link_customer(p_store_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_cust  public.customers;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'session';
  end if;
  -- El email de la cuenta, solo si Auth lo verificó (el código por email lo verifica).
  select lower(u.email) into v_email from auth.users u
   where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'email_unverified';
  end if;
  if not exists (select 1 from public.stores s where s.id = p_store_id and s.status = 'active') then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'store';
  end if;

  select * into v_cust from public.customers c where c.store_id = p_store_id and c.user_id = v_uid;
  if v_cust.id is not null then
    if v_cust.email <> v_email then
      -- La cuenta cambió de email: el cliente vinculado conserva su historial.
      raise exception using errcode = 'P0001', message = 'conflict', detail = 'email_changed';
    end if;
    return v_cust.id;
  end if;

  select * into v_cust from public.customers c where c.store_id = p_store_id and c.email = v_email for update;
  if v_cust.id is null then
    insert into public.customers (store_id, email, user_id) values (p_store_id, v_email, v_uid)
    returning * into v_cust;
  elsif v_cust.user_id is not null and v_cust.user_id <> v_uid then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'customer_linked';
  elsif v_cust.anonymized_at is not null or v_cust.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'customer_closed';
  else
    update public.customers set user_id = v_uid where id = v_cust.id;
  end if;
  perform audit.record('customer.account_linked', 'customer', v_cust.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, null);
  return v_cust.id;
end
$$;

-- Resumen de la cuenta: datos, pedidos (incluidos los de invitado con ese email) y direcciones.
create or replace function public.account_overview(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.customers;
begin
  v := app.account_customer(p_store_id);
  if v.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'customer', jsonb_build_object('email', v.email, 'first_name', v.first_name, 'last_name', v.last_name,
                                   'phone', v.phone, 'accepts_marketing', v.accepts_marketing),
    'orders', (select coalesce(jsonb_agg(x order by x ->> 'placed_at' desc), '[]'::jsonb) from (
                 select jsonb_build_object('id', o.id, 'display_number', o.display_number, 'placed_at', o.placed_at,
                                           'status', o.status, 'payment_status', o.payment_status,
                                           'fulfillment_status', o.fulfillment_status, 'total', o.total,
                                           'currency', o.currency) as x
                   from public.orders o
                  where o.store_id = v.store_id and o.customer_id = v.id
                  order by o.placed_at desc limit 50) q),
    'addresses', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', a.id, 'recipient_name', a.recipient_name, 'line1', a.line1, 'line2', a.line2,
                    'city', a.city, 'region', a.region, 'postal_code', a.postal_code, 'country', a.country,
                    'phone', a.phone, 'is_default', a.is_default) order by a.is_default desc, a.created_at), '[]'::jsonb)
                    from public.customer_addresses a where a.store_id = v.store_id and a.customer_id = v.id));
end
$$;

-- Detalle de un pedido de la cuenta (mismo formato que el enlace del invitado).
create or replace function public.account_get_order(p_store_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v       public.customers;
  v_token bytea;
begin
  v := app.require_account(p_store_id);
  select o.guest_access_token_hash into v_token from public.orders o
   where o.store_id = p_store_id and o.id = p_order_id and o.customer_id = v.id;
  if not found then
    return null;   -- otro cliente, otra tienda o inexistente: indistinguibles
  end if;
  return storefront.get_order_for_guest(p_store_id, p_order_id, v_token)
         || jsonb_build_object('shipments', (
              select coalesce(jsonb_agg(jsonb_build_object('status', sh.status, 'carrier', sh.carrier,
                                                           'tracking_number', sh.tracking_number,
                                                           'tracking_url', sh.tracking_url, 'shipped_at', sh.shipped_at,
                                                           'delivered_at', sh.delivered_at) order by sh.created_at),
                              '[]'::jsonb)
                from public.shipments sh where sh.store_id = p_store_id and sh.order_id = p_order_id));
end
$$;

create or replace function public.account_update_profile(p_store_id uuid, p_first_name text, p_last_name text,
                                                         p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.customers;
begin
  v := app.require_account(p_store_id);
  if char_length(coalesce(p_first_name, '')) > 80 or char_length(coalesce(p_last_name, '')) > 80 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'name';
  end if;
  if nullif(btrim(p_phone), '') is not null and btrim(p_phone) !~ '^\+?[0-9 ()-]{7,20}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'phone';
  end if;
  update public.customers
     set first_name = nullif(btrim(p_first_name), ''), last_name = nullif(btrim(p_last_name), ''),
         phone = nullif(btrim(p_phone), '')
   where id = v.id;
end
$$;

-- Alta o edición de una dirección propia (máximo 10).
create or replace function public.account_save_address(p_store_id uuid, p_address_id uuid, p_address jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v       public.customers;
  v_id    uuid;
  v_def   boolean := coalesce((p_address ->> 'is_default')::boolean, false);
begin
  v := app.require_account(p_store_id);
  if jsonb_typeof(p_address) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'address';
  end if;
  if p_address_id is null
     and (select count(*) from public.customer_addresses a where a.customer_id = v.id) >= 10 then
    raise exception using errcode = 'P0001', message = 'limit_reached', detail = 'addresses';
  end if;
  if v_def then
    update public.customer_addresses set is_default = false
     where store_id = p_store_id and customer_id = v.id and is_default and id is distinct from p_address_id;
  end if;
  begin
    if p_address_id is null then
      insert into public.customer_addresses (store_id, customer_id, recipient_name, line1, line2, city, region,
                                             postal_code, country, phone, is_default)
      values (p_store_id, v.id, btrim(p_address ->> 'recipient_name'), btrim(p_address ->> 'line1'),
              nullif(btrim(p_address ->> 'line2'), ''), btrim(p_address ->> 'city'), btrim(p_address ->> 'region'),
              upper(btrim(p_address ->> 'postal_code')), upper(btrim(p_address ->> 'country')),
              nullif(btrim(p_address ->> 'phone'), ''), v_def)
      returning id into v_id;
    else
      update public.customer_addresses
         set recipient_name = btrim(p_address ->> 'recipient_name'), line1 = btrim(p_address ->> 'line1'),
             line2 = nullif(btrim(p_address ->> 'line2'), ''), city = btrim(p_address ->> 'city'),
             region = btrim(p_address ->> 'region'), postal_code = upper(btrim(p_address ->> 'postal_code')),
             country = upper(btrim(p_address ->> 'country')), phone = nullif(btrim(p_address ->> 'phone'), ''),
             is_default = v_def
       where store_id = p_store_id and customer_id = v.id and id = p_address_id
      returning id into v_id;
      if v_id is null then
        raise exception using errcode = 'P0001', message = 'not_found', detail = 'address';
      end if;
    end if;
  exception when check_violation or not_null_violation then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'address';
  end;
  return v_id;
end
$$;

create or replace function public.account_delete_address(p_store_id uuid, p_address_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.customers;
begin
  v := app.require_account(p_store_id);
  delete from public.customer_addresses
   where store_id = p_store_id and customer_id = v.id and id = p_address_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'address';
  end if;
end
$$;

-- La nota interna del staff sobre el cliente no se lee por la tabla: el comprador
-- ve su propia fila (customers_select_self, §7.4) y no debe ver esa nota. El
-- panel la leerá por RPC con customers.pii.read (F8-T02).
revoke select on public.customers from authenticated;
grant select (id, store_id, user_id, email, first_name, last_name, phone, accepts_marketing, marketing_consent_at,
              marketing_consent_source, orders_count, total_spent, anonymized_at, deleted_at, created_at, updated_at)
  on public.customers to authenticated;

revoke all on function storefront.record_login_intent(uuid, text, text) from public;
revoke all on function system.login_intent_store(text) from public;
revoke all on function public.storefront_link_customer(uuid) from public;
revoke all on function public.account_overview(uuid) from public;
revoke all on function public.account_get_order(uuid, uuid) from public;
revoke all on function public.account_update_profile(uuid, text, text, text) from public;
revoke all on function public.account_save_address(uuid, uuid, jsonb) from public;
revoke all on function public.account_delete_address(uuid, uuid) from public;
grant execute on function storefront.record_login_intent(uuid, text, text) to storefront_gateway;
grant execute on function system.login_intent_store(text) to system_worker;
grant execute on function public.storefront_link_customer(uuid) to authenticated;
grant execute on function public.account_overview(uuid) to authenticated;
grant execute on function public.account_get_order(uuid, uuid) to authenticated;
grant execute on function public.account_update_profile(uuid, text, text, text) to authenticated;
grant execute on function public.account_save_address(uuid, uuid, jsonb) to authenticated;
grant execute on function public.account_delete_address(uuid, uuid) to authenticated;
