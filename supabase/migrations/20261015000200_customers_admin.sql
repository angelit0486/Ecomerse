-- =============================================================================
-- Fase 8 · Clientes en el panel (F8-T02). Contrato: GATE0 §8 (matriz: customers.read
-- enmascarado, customers.pii.read completo, customers.update, customers.delete =
-- anonimizar), §9 (customers), §29 (auditoría sin PII completa).
--
-- * Todo por RPC: sin customers.pii.read el email, el teléfono y el nombre salen
--   enmascarados, no hay búsqueda (revelaría quién compra) ni direcciones ni nota.
-- * El staff no puede dar consentimiento de marketing por el cliente: solo retirarlo.
-- * Anonimizar: el cliente y sus direcciones quedan sin datos personales y sin
--   cuenta vinculada; los pedidos conservan su snapshot (inmutable, §44.9; la
--   retención legal de pedidos queda para la revisión legal, R-18) (D-F8-02).
-- =============================================================================

create or replace function app.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_email is null or position('@' in p_email) = 0 then null
              else left(split_part(p_email, '@', 1), 2) || '***@' || split_part(p_email, '@', 2) end
$$;

create or replace function app.mask_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_phone is null then null
              else '••• ' || right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 4) end
$$;

create or replace function app.mask_name(p_first text, p_last text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(concat_ws(' ', nullif(left(btrim(p_first), 1) || '.', '.'),
                                     nullif(left(btrim(p_last), 1) || '.', '.'))), '')
$$;

revoke all on function app.mask_email(text) from public;
revoke all on function app.mask_phone(text) from public;
revoke all on function app.mask_name(text, text) from public;

-- Vista de un cliente para el panel según el permiso de PII del lector.
create or replace function app.customer_admin_view(p_c public.customers, p_pii boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_c.id,
    'email', case when p_pii then p_c.email else app.mask_email(p_c.email) end,
    'name', case when p_pii then nullif(btrim(concat_ws(' ', p_c.first_name, p_c.last_name)), '')
                 else app.mask_name(p_c.first_name, p_c.last_name) end,
    'phone', case when p_pii then p_c.phone else app.mask_phone(p_c.phone) end,
    'has_account', p_c.user_id is not null,
    'accepts_marketing', p_c.accepts_marketing,
    'orders_count', p_c.orders_count,
    'total_spent', p_c.total_spent,
    'anonymized', p_c.anonymized_at is not null,
    'created_at', p_c.created_at,
    'masked', not p_pii)
$$;
revoke all on function app.customer_admin_view(public.customers, boolean) from public;

-- Listado paginado por cursor (created_at, id) descendente.
create or replace function public.customers_list(p_store_id uuid, p_query text, p_cursor text, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pii    boolean;
  v_q      text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit  integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_at     timestamptz;
  v_id     uuid;
  v_rows   jsonb;
begin
  perform app.require_store_permission(p_store_id, 'customers.read');
  v_pii := app.has_store_permission(p_store_id, 'customers.pii.read');
  if v_q is not null and (not v_pii or char_length(v_q) > 100) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'query';
  end if;
  if p_cursor is not null then
    begin
      v_at := split_part(p_cursor, '|', 1)::timestamptz;
      v_id := split_part(p_cursor, '|', 2)::uuid;
    exception when others then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'cursor';
    end;
  end if;
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');

  with page as (
    select c as cust, c.created_at, c.id from public.customers c
     where c.store_id = p_store_id and c.deleted_at is null
       and (v_q is null or c.email like lower(v_q) || '%'
            or concat_ws(' ', c.first_name, c.last_name) ilike '%' || v_q || '%')
       and (v_at is null or (c.created_at, c.id) < (v_at, v_id))
     order by c.created_at desc, c.id desc
     limit v_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by created_at desc, id desc) as rn, count(*) over () as total from page
  )
  select coalesce(jsonb_agg(app.customer_admin_view(cust, v_pii) order by created_at desc, id desc)
                    filter (where rn <= v_limit), '[]'::jsonb),
         max(case when rn = v_limit and total > v_limit then created_at::text || '|' || id end)
    into v_rows, p_cursor
    from numbered;
  return jsonb_build_object('items', v_rows, 'next_cursor', p_cursor);
end
$$;

create or replace function public.customers_get(p_store_id uuid, p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c   public.customers;
  v_pii boolean;
begin
  perform app.require_store_permission(p_store_id, 'customers.read');
  v_pii := app.has_store_permission(p_store_id, 'customers.pii.read');
  select * into v_c from public.customers c
   where c.store_id = p_store_id and c.id = p_customer_id and c.deleted_at is null;
  if v_c.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'customer';
  end if;
  return app.customer_admin_view(v_c, v_pii) || jsonb_build_object(
    'first_name', case when v_pii then v_c.first_name end,
    'last_name', case when v_pii then v_c.last_name end,
    'note', case when v_pii then v_c.note end,
    'marketing_consent_at', v_c.marketing_consent_at,
    'marketing_consent_source', v_c.marketing_consent_source,
    'addresses', case when v_pii then (
        select coalesce(jsonb_agg(jsonb_build_object('recipient_name', a.recipient_name, 'line1', a.line1,
                                                     'line2', a.line2, 'city', a.city, 'region', a.region,
                                                     'postal_code', a.postal_code, 'country', a.country,
                                                     'is_default', a.is_default) order by a.is_default desc),
                        '[]'::jsonb)
          from public.customer_addresses a where a.store_id = p_store_id and a.customer_id = v_c.id)
      else '[]'::jsonb end,
    'orders', case when app.has_store_permission(p_store_id, 'orders.read') then (
        select coalesce(jsonb_agg(x order by x ->> 'placed_at' desc), '[]'::jsonb) from (
          select jsonb_build_object('id', o.id, 'display_number', o.display_number, 'placed_at', o.placed_at,
                                    'status', o.status, 'payment_status', o.payment_status,
                                    'fulfillment_status', o.fulfillment_status, 'total', o.total) as x
            from public.orders o where o.store_id = p_store_id and o.customer_id = v_c.id
           order by o.placed_at desc limit 20) q)
      else '[]'::jsonb end);
end
$$;

create or replace function public.customers_update(p_store_id uuid, p_customer_id uuid, p_first_name text,
                                                   p_last_name text, p_phone text, p_note text,
                                                   p_accepts_marketing boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.customers;
begin
  perform app.require_store_permission(p_store_id, 'customers.update');
  -- Solo se editan los datos que el lector puede ver.
  perform app.require_store_permission(p_store_id, 'customers.pii.read');
  select * into v_c from public.customers c
   where c.store_id = p_store_id and c.id = p_customer_id and c.deleted_at is null for update;
  if v_c.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'customer';
  end if;
  if v_c.anonymized_at is not null then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'customer_anonymized';
  end if;
  if char_length(coalesce(p_first_name, '')) > 80 or char_length(coalesce(p_last_name, '')) > 80 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'name';
  end if;
  if nullif(btrim(p_phone), '') is not null and btrim(p_phone) !~ '^\+?[0-9 ()-]{7,20}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'phone';
  end if;
  if char_length(coalesce(p_note, '')) > 2000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'note';
  end if;
  -- El consentimiento lo da el cliente (checkout); la tienda solo puede retirarlo.
  if coalesce(p_accepts_marketing, v_c.accepts_marketing) and not v_c.accepts_marketing then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'accepts_marketing';
  end if;
  update public.customers
     set first_name = nullif(btrim(p_first_name), ''), last_name = nullif(btrim(p_last_name), ''),
         phone = nullif(btrim(p_phone), ''), note = nullif(btrim(p_note), ''),
         accepts_marketing = coalesce(p_accepts_marketing, accepts_marketing)
   where id = v_c.id;
  perform audit.record('customer.updated', 'customer', v_c.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('accepts_marketing', v_c.accepts_marketing),
                       jsonb_build_object('accepts_marketing', coalesce(p_accepts_marketing, v_c.accepts_marketing),
                                          'fields', 'contact'));
end
$$;

create or replace function public.customers_anonymize(p_store_id uuid, p_customer_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c      public.customers;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform app.require_store_permission(p_store_id, 'customers.delete');
  if char_length(v_reason) not between 3 and 500 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'reason';
  end if;
  select * into v_c from public.customers c
   where c.store_id = p_store_id and c.id = p_customer_id and c.deleted_at is null for update;
  if v_c.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'customer';
  end if;
  if v_c.anonymized_at is not null then
    return jsonb_build_object('customer_id', v_c.id, 'replayed', true);
  end if;
  delete from public.customer_addresses where store_id = p_store_id and customer_id = v_c.id;
  update public.customers
     set email = 'anonimo-' || replace(v_c.id::text, '-', '') || '@anonimizado.invalid',
         first_name = null, last_name = null, phone = null, note = null, user_id = null,
         accepts_marketing = false, marketing_consent_at = null, marketing_consent_source = null,
         anonymized_at = now()
   where id = v_c.id;
  perform audit.record('customer.anonymized', 'customer', v_c.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('email', app.mask_email(v_c.email)), null, v_reason);
  return jsonb_build_object('customer_id', v_c.id, 'replayed', false);
end
$$;

revoke all on function public.customers_list(uuid, text, text, integer) from public;
revoke all on function public.customers_get(uuid, uuid) from public;
revoke all on function public.customers_update(uuid, uuid, text, text, text, text, boolean) from public;
revoke all on function public.customers_anonymize(uuid, uuid, text) from public;
grant execute on function public.customers_list(uuid, text, text, integer) to authenticated;
grant execute on function public.customers_get(uuid, uuid) to authenticated;
grant execute on function public.customers_update(uuid, uuid, text, text, text, text, boolean) to authenticated;
grant execute on function public.customers_anonymize(uuid, uuid, text) to authenticated;
