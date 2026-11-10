-- =============================================================================
-- ADR-062 opción A (aprobada por el propietario el 2026-11-10, «Continúa con lo
-- más recomendado»): vigencia del enlace del pedido de invitado.
--
-- 1. El enlace vale 180 días desde la última actividad del pedido: su creación o
--    cualquier cambio del pedido (pago, envío, cancelación, reembolso), de sus
--    envíos o de sus devoluciones, o la última renovación del enlace.
-- 2. Vencido, la página ofrece «Mandarme un enlace nuevo»: la app calcula el
--    token de la generación siguiente (la base no conoce el secreto), la base
--    guarda solo su sha256 en `order_guest_links` y encola el correo al email del
--    pedido. El enlace anterior deja de servir (queda como «reemplazado» para
--    decirlo en la página). Uno por hora por pedido.
-- 3. Ver el pedido, opinar y pedir devoluciones exigen el enlace vigente
--    (`app.guest_order_access = 'ok'`). Reintentar el pago no cambia: un pedido
--    sin pagar vence en horas, mucho antes que el enlace.
--
-- Los pedidos no se tocan (siguen inmutables); el token nunca se guarda en claro.
-- Reversa: crear la migración que vuelva a definir las 5 funciones con la
-- comparación directa del hash; la tabla nueva puede quedarse.
-- =============================================================================

create table public.order_guest_links (
  store_id      uuid not null references public.stores (id) on delete restrict,
  order_id      uuid not null,
  generation    integer not null check (generation between 1 and 10000),
  token_hash    bytea not null check (octet_length(token_hash) = 32),
  previous_hash bytea check (previous_hash is null or octet_length(previous_hash) = 32),
  renewed_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  primary key (store_id, order_id),
  foreign key (store_id, order_id) references public.orders (store_id, id) on delete restrict
);
create trigger order_guest_links_prevent_tenant_change before update on public.order_guest_links
  for each row execute function app.prevent_tenant_change();
create trigger order_guest_links_no_delete before delete on public.order_guest_links
  for each row execute function app.forbid_mutation();

alter table public.order_guest_links enable row level security;
alter table public.order_guest_links force row level security;
revoke all on table public.order_guest_links from public, anon, authenticated, service_role;
grant select on table public.order_guest_links to authenticated;
create policy order_guest_links_select on public.order_guest_links for select to authenticated
  using (app.has_store_permission(store_id, 'orders.read'));

-- Última actividad del pedido (los updated_at suben con cada cambio).
create function app.order_last_activity(p_store_id uuid, p_order_id uuid)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select greatest(o.created_at, o.updated_at,
    (select max(s.updated_at) from public.shipments s where s.store_id = o.store_id and s.order_id = o.id),
    (select max(r.updated_at) from public.return_requests r where r.store_id = o.store_id and r.order_id = o.id),
    (select l.renewed_at from public.order_guest_links l where l.store_id = o.store_id and l.order_id = o.id))
    from public.orders o
   where o.store_id = p_store_id and o.id = p_order_id
$$;
revoke all on function app.order_last_activity(uuid, uuid) from public;

-- 'ok' (vigente) | 'expired' (vencido) | 'replaced' (ya se mandó uno nuevo) | null (no coincide).
create function app.guest_order_access(p_store_id uuid, p_order_id uuid, p_token_hash bytea)
returns text
language sql
stable
set search_path = ''
as $$
  select case
           when p_token_hash is null then null
           when coalesce(l.token_hash, o.guest_access_token_hash) = p_token_hash then
             case when app.order_last_activity(o.store_id, o.id) >= now() - interval '180 days'
                  then 'ok' else 'expired' end
           when l.previous_hash = p_token_hash then 'replaced'
         end
    from public.orders o
    left join public.order_guest_links l on l.store_id = o.store_id and l.order_id = o.id
   where o.store_id = p_store_id and o.id = p_order_id
$$;
revoke all on function app.guest_order_access(uuid, uuid, bytea) from public;

-- La página del pedido: ¿vigente, vencido o reemplazado? (sin datos del pedido).
create function storefront.guest_link_state(p_store_id uuid, p_order_id uuid, p_token_hash bytea)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select app.guest_order_access(p_store_id, p_order_id, p_token_hash)
$$;

-- Para calcular el token de la generación siguiente: solo con un enlace vencido o reemplazado.
create function storefront.guest_link_renewal(p_store_id uuid, p_order_id uuid, p_token_hash bytea)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('key', o.checkout_idempotency_key, 'generation', coalesce(l.generation, 0) + 1)
    from public.orders o
    left join public.order_guest_links l on l.store_id = o.store_id and l.order_id = o.id
   where o.store_id = p_store_id and o.id = p_order_id and o.checkout_idempotency_key is not null
     and app.guest_order_access(p_store_id, p_order_id, p_token_hash) in ('expired', 'replaced')
$$;

-- «Mandarme un enlace nuevo»: guarda el hash de la generación siguiente y encola el correo.
-- Devuelve 'sent', 'too_soon' (uno por hora), 'ok' (el enlace sigue vigente) o null (no coincide).
create function storefront.renew_guest_link(p_store_id uuid, p_order_id uuid, p_token_hash bytea,
                                            p_new_hash bytea, p_generation integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state   text;
  v_current public.order_guest_links;
begin
  if p_new_hash is null or octet_length(p_new_hash) <> 32 or p_generation is null or p_generation < 1 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'guest_link';
  end if;
  -- Una renovación a la vez por pedido.
  perform 1 from public.orders o where o.store_id = p_store_id and o.id = p_order_id for update;
  v_state := app.guest_order_access(p_store_id, p_order_id, p_token_hash);
  if v_state is null or v_state = 'ok' then
    return v_state;
  end if;
  select * into v_current from public.order_guest_links l where l.store_id = p_store_id and l.order_id = p_order_id;
  if p_generation <> coalesce(v_current.generation, 0) + 1 then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'guest_link';
  end if;
  if not app.rate_limit_take('guest_link:' || p_order_id, 1, 3600) then
    return 'too_soon';
  end if;
  insert into public.order_guest_links (store_id, order_id, generation, token_hash, previous_hash, renewed_at)
  values (p_store_id, p_order_id, p_generation, p_new_hash,
          (select o.guest_access_token_hash from public.orders o where o.store_id = p_store_id and o.id = p_order_id),
          now())
  on conflict (store_id, order_id) do update
     set generation = excluded.generation, previous_hash = public.order_guest_links.token_hash,
         token_hash = excluded.token_hash, renewed_at = excluded.renewed_at;
  perform app.enqueue_job('order.link_renewed', jsonb_build_object('order_id', p_order_id, 'generation', p_generation),
                          p_store_id, 'order.link_renewed:' || p_order_id || ':' || p_generation);
  perform audit.record('order.guest_link_renewed', 'order', p_order_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('generation', p_generation));
  return 'sent';
end
$$;

revoke all on function storefront.guest_link_state(uuid, uuid, bytea) from public;
revoke all on function storefront.guest_link_renewal(uuid, uuid, bytea) from public;
revoke all on function storefront.renew_guest_link(uuid, uuid, bytea, bytea, integer) from public;
grant execute on function storefront.guest_link_state(uuid, uuid, bytea) to storefront_gateway;
grant execute on function storefront.guest_link_renewal(uuid, uuid, bytea) to storefront_gateway;
grant execute on function storefront.renew_guest_link(uuid, uuid, bytea, bytea, integer) to storefront_gateway;

-- -----------------------------------------------------------------------------
-- Las funciones del enlace exigen que esté vigente (misma definición; solo cambia
-- la comparación del hash por app.guest_order_access(...) = 'ok').
-- -----------------------------------------------------------------------------
create or replace function storefront.get_order_for_guest(p_store_id uuid, p_order_id uuid, p_token_hash bytea)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'display_number', o.display_number, 'status', o.status, 'payment_status', o.payment_status,
    'fulfillment_status', o.fulfillment_status, 'placed_at', o.placed_at, 'paid_at', o.paid_at,
    'cancelled_at', o.cancelled_at, 'cancel_reason', o.cancel_reason,
    'email', o.email, 'customer_name', o.customer_name, 'shipping_address', o.shipping_address,
    'currency', o.currency, 'prices_include_tax', o.prices_include_tax,
    'subtotal', o.subtotal, 'discount_total', o.discount_total, 'shipping_total', o.shipping_total,
    'tax_total', o.tax_total, 'total', o.total, 'shipping', o.shipping_snapshot,
    'discount', o.discount_snapshot - 'value',
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'product_title', i.product_title, 'variant_title', i.variant_title, 'quantity', i.quantity,
                'unit_price', i.unit_price, 'line_total', i.line_total, 'image_path', i.image_path)
                order by i.position), '[]'::jsonb)
                from public.order_items i where i.store_id = o.store_id and i.order_id = o.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('type', e.type, 'to_value', e.to_value,
                                                            'message', e.message, 'created_at', e.created_at)
                                         order by e.created_at), '[]'::jsonb)
                 from public.order_events e
                where e.store_id = o.store_id and e.order_id = o.id and e.customer_visible),
    'payment', (select jsonb_build_object('id', p.id, 'provider', p.provider, 'status', p.status,
                                          'expires_at', p.expires_at, 'display_name', a.display_name,
                                          'instructions', a.public_config ->> 'instructions')
                  from public.payments p
                  join public.payment_accounts a on a.store_id = p.store_id and a.id = p.payment_account_id
                 where p.store_id = o.store_id and p.order_id = o.id
                 order by p.created_at desc limit 1))
    from public.orders o
   where o.store_id = p_store_id and o.id = p_order_id
     and app.guest_order_access(o.store_id, o.id, p_token_hash) = 'ok'
$$;

create or replace function storefront.order_reviewables(p_store_id uuid, p_order_id uuid, p_token_hash bytea)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', x.product_id, 'title', x.product_title,
           'reviewed', exists (select 1 from public.product_reviews r
                                where r.store_id = p_store_id and r.order_id = p_order_id
                                  and r.product_id = x.product_id))
           order by x.position), '[]'::jsonb)
    from (select distinct on (i.product_id) i.product_id, i.product_title, i.position
            from public.orders o
            join public.order_items i on i.store_id = o.store_id and i.order_id = o.id
            join public.products p on p.store_id = i.store_id and p.id = i.product_id and p.deleted_at is null
           where o.store_id = p_store_id and o.id = p_order_id
             and app.guest_order_access(o.store_id, o.id, p_token_hash) = 'ok'
             and app.order_reviewable(p_store_id, p_order_id)
           order by i.product_id, i.position) x
$$;

create or replace function storefront.submit_review(p_store_id uuid, p_order_id uuid, p_token_hash bytea,
                                                    p_product_id uuid, p_review jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order  public.orders;
  v_rating integer;
  v_title  text := nullif(btrim(p_review ->> 'title'), '');
  v_body   text := btrim(coalesce(p_review ->> 'body', ''));
  v_id     uuid;
begin
  select * into v_order from public.orders o
   where o.store_id = p_store_id and o.id = p_order_id
     and app.guest_order_access(o.store_id, o.id, p_token_hash) = 'ok';
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'order';
  end if;
  if not app.order_reviewable(p_store_id, p_order_id) then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'order_not_delivered';
  end if;
  if not exists (select 1 from public.order_items i
                  join public.products p on p.store_id = i.store_id and p.id = i.product_id and p.deleted_at is null
                 where i.store_id = p_store_id and i.order_id = p_order_id and i.product_id = p_product_id) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'product';
  end if;
  if not app.rate_limit_take('review:' || p_order_id, 20, 3600) then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;
  begin
    v_rating := (p_review ->> 'rating')::integer;
  exception when others then
    v_rating := null;
  end;
  if v_rating is null or v_rating not between 1 and 5 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rating';
  end if;
  if v_title is not null and char_length(v_title) > 120 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'title';
  end if;
  if char_length(v_body) not between 10 and 2000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'body';
  end if;
  insert into public.product_reviews (store_id, product_id, order_id, rating, title, body, author_name)
  values (p_store_id, p_product_id, p_order_id, v_rating, v_title, v_body,
          app.review_author_name(v_order.customer_name))
  on conflict (store_id, order_id, product_id) do nothing
  returning id into v_id;
  if v_id is null then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'already_reviewed';
  end if;
  return jsonb_build_object('status', 'pending');
end
$$;

create or replace function storefront.return_options(p_store_id uuid, p_order_id uuid, p_token_hash bytea)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order    public.orders;
  v_deadline timestamptz;
  v_last     public.return_requests;
begin
  if not app.flag_enabled('returns', p_store_id) then
    return null;
  end if;
  select * into v_order from public.orders o
   where o.store_id = p_store_id and o.id = p_order_id
     and app.guest_order_access(o.store_id, o.id, p_token_hash) = 'ok';
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'order';
  end if;
  v_deadline := app.return_deadline(p_store_id, p_order_id);
  select * into v_last from public.return_requests q
   where q.store_id = p_store_id and q.order_id = p_order_id
   order by q.requested_at desc, q.id desc limit 1;
  return jsonb_build_object(
    'deadline', v_deadline,
    -- La base decide si el plazo ya pasó (la página no compara con su reloj).
    'window_closed', v_deadline is not null and now() > v_deadline,
    'open', v_deadline is not null and now() <= v_deadline
            and v_order.payment_status in ('paid', 'partially_refunded')
            and (v_last.id is null or v_last.status in ('rejected', 'closed')),
    'window_days', (select s.return_window_days from public.stores s where s.id = p_store_id),
    'last', case when v_last.id is null then null else app.return_public(v_last) end,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                'order_item_id', i.id, 'title', i.product_title, 'variant', i.variant_title,
                'available', a.available) order by i.position), '[]'::jsonb)
                from app.return_available(p_store_id, p_order_id) a
                join public.order_items i on i.store_id = p_store_id and i.id = a.order_item_id
               where a.available > 0));
end
$$;

create or replace function storefront.request_return(p_store_id uuid, p_order_id uuid, p_token_hash bytea, p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order    public.orders;
  v_deadline timestamptz;
  v_reason   text := p_request ->> 'reason';
  v_note     text := nullif(btrim(coalesce(p_request ->> 'note', '')), '');
  v_items    jsonb := p_request -> 'items';
  v_line     record;
  v_return   public.return_requests;
begin
  if not app.flag_enabled('returns', p_store_id) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'returns';
  end if;
  select * into v_order from public.orders o
   where o.store_id = p_store_id and o.id = p_order_id
     and app.guest_order_access(o.store_id, o.id, p_token_hash) = 'ok'
   for update;
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'order';
  end if;
  if not app.rate_limit_take('return:' || p_order_id, 10, 3600) then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;
  v_deadline := app.return_deadline(p_store_id, p_order_id);
  if v_order.payment_status not in ('paid', 'partially_refunded') or v_deadline is null or now() > v_deadline then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'return_window';
  end if;
  if exists (select 1 from public.return_requests q
              where q.store_id = p_store_id and q.order_id = p_order_id
                and q.status in ('requested', 'approved', 'received')) then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'return_open';
  end if;
  if v_reason is null or v_reason not in ('damaged', 'wrong_item', 'not_as_described', 'no_longer_needed', 'other') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'reason';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'note';
  end if;
  -- Partidas: renglones del pedido, sin repetir, enteros positivos y no más de lo disponible.
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) not between 1 and 100
     or exists (select 1 from jsonb_array_elements(v_items) x
                 where jsonb_typeof(x) <> 'object' or coalesce(jsonb_typeof(x -> 'quantity'), '') <> 'number'
                    or (x ->> 'quantity')::numeric <> floor((x ->> 'quantity')::numeric)
                    or (x ->> 'quantity')::numeric < 1)
     or (select count(*) from jsonb_array_elements(v_items))
        <> (select count(distinct x ->> 'order_item_id') from jsonb_array_elements(v_items) x) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'items';
  end if;
  for v_line in
    select x ->> 'order_item_id' as item, (x ->> 'quantity')::integer as q, a.available
      from jsonb_array_elements(v_items) x
      left join app.return_available(p_store_id, p_order_id) a on a.order_item_id::text = x ->> 'order_item_id'
  loop
    if v_line.available is null or v_line.q > v_line.available then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'items';
    end if;
  end loop;
  insert into public.return_requests (store_id, order_id, reason, customer_note, items)
  values (p_store_id, p_order_id, v_reason, v_note,
          (select jsonb_agg(jsonb_build_object('order_item_id', (x ->> 'order_item_id')::uuid,
                                               'quantity', (x ->> 'quantity')::integer))
             from jsonb_array_elements(v_items) x))
  returning * into v_return;
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, metadata)
  values (p_store_id, p_order_id, 'return.requested', 'Devolución solicitada', true, 'customer',
          jsonb_build_object('return_id', v_return.id, 'reason', v_reason));
  perform app.enqueue_job('return.requested',
                          jsonb_build_object('order_id', p_order_id, 'return_id', v_return.id), p_store_id,
                          'return.requested:' || v_return.id);
  return app.return_public(v_return);
end
$$;

-- El correo del pedido lleva el enlace de la generación vigente.
create or replace function system.order_notification(p_order_id uuid, p_shipment_id uuid default null,
                                                     p_refund_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'store', jsonb_build_object(
      'id', s.id, 'handle', s.handle, 'name', s.name, 'locale', s.locale, 'currency', s.currency, 'contact_email', s.contact_email,
      'organization_id', s.organization_id,
      'hostname', coalesce(
        (select d.hostname from public.store_domains d where d.store_id = s.id and d.is_primary and d.status = 'active'),
        (select d.hostname from public.store_domains d where d.store_id = s.id and d.type = 'platform_subdomain'
                                                         and d.status = 'active' order by d.created_at limit 1)),
      'logo_path', (select m.storage_path from public.store_themes t
                      join public.media m on m.store_id = t.store_id and m.id = t.logo_media_id
                     where t.store_id = s.id and m.status = 'ready' and m.deleted_at is null),
      'primary_color', (select t.settings -> 'colors' ->> 'primary' from public.store_themes t where t.store_id = s.id)),
    'order', jsonb_build_object(
      'id', o.id, 'display_number', o.display_number, 'email', o.email, 'customer_name', o.customer_name,
      'status', o.status, 'payment_status', o.payment_status, 'checkout_idempotency_key', o.checkout_idempotency_key,
      -- ADR-062: generación del enlace (0 = el del checkout; sube con cada «enlace nuevo»).
      'guest_link_generation', coalesce((select l.generation from public.order_guest_links l
                                          where l.store_id = o.store_id and l.order_id = o.id), 0),
      'subtotal', o.subtotal, 'discount_total', o.discount_total, 'shipping_total', o.shipping_total,
      'tax_total', o.tax_total, 'total', o.total, 'prices_include_tax', o.prices_include_tax,
      'shipping_name', o.shipping_snapshot ->> 'name', 'cancel_reason', o.cancel_reason,
      -- Tiempo estimado de la tarifa elegida (copia del pedido, no la tarifa de hoy).
      'estimated_days', case when o.shipping_snapshot ? 'est_days_max' then jsonb_build_object(
        'min', (o.shipping_snapshot ->> 'est_days_min')::integer,
        'max', (o.shipping_snapshot ->> 'est_days_max')::integer) end,
      -- Misión vendible F1.5: la confirmación lleva la dirección completa (sin teléfono).
      'shipping_address', case when o.shipping_address is not null then jsonb_build_object(
        'recipient_name', o.shipping_address ->> 'recipient_name', 'line1', o.shipping_address ->> 'line1',
        'line2', o.shipping_address ->> 'line2', 'postal_code', o.shipping_address ->> 'postal_code',
        'city', o.shipping_address ->> 'city', 'region', o.shipping_address ->> 'region',
        'country', o.shipping_address ->> 'country') end),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('title', i.product_title, 'variant', i.variant_title,
                                                           'quantity', i.quantity, 'line_total', i.line_total,
                                                           'unit_price', i.unit_price, 'image_path', i.image_path)
                                        order by i.position), '[]'::jsonb)
                from public.order_items i where i.store_id = o.store_id and i.order_id = o.id),
    'payment', (select jsonb_build_object('provider', p.provider, 'status', p.status, 'method', p.method,
                                          'display_name', a.display_name,
                                          'instructions', a.public_config ->> 'instructions')
                  from public.payments p
                  join public.payment_accounts a on a.store_id = p.store_id and a.id = p.payment_account_id
                 where p.store_id = o.store_id and p.order_id = o.id order by p.created_at desc limit 1),
    'shipment', (select jsonb_build_object('carrier', sh.carrier, 'tracking_number', sh.tracking_number,
                                           'tracking_url', sh.tracking_url,
                                           -- Lo que va en este paquete y si queda algo por enviar.
                                           'items', (select coalesce(jsonb_agg(jsonb_build_object(
                                                       'title', i.product_title, 'variant', i.variant_title,
                                                       'quantity', si.quantity) order by i.position), '[]'::jsonb)
                                                       from public.shipment_items si
                                                       join public.order_items i on i.store_id = si.store_id
                                                                                and i.id = si.order_item_id
                                                      where si.store_id = sh.store_id and si.shipment_id = sh.id),
                                           'partial', exists (select 1 from public.order_items i
                                                               where i.store_id = o.store_id and i.order_id = o.id
                                                                 and i.requires_shipping
                                                                 and i.fulfilled_quantity < i.quantity - i.cancelled_quantity))
                   from public.shipments sh where sh.store_id = o.store_id and sh.id = p_shipment_id),
    'refund', (select jsonb_build_object('amount', r.amount) from public.refunds r
                where r.store_id = o.store_id and r.id = p_refund_id and r.status = 'succeeded'),
    'staff', jsonb_build_object(
      'emails', coalesce(nullif((select n.staff_emails from public.store_notification_settings n where n.store_id = s.id),
                                '{}'::text[]),
                         case when s.contact_email is not null then array[s.contact_email] else '{}'::text[] end),
      'notify_new_order', coalesce((select n.notify_new_order from public.store_notification_settings n
                                     where n.store_id = s.id), true),
      'notify_paid', coalesce((select n.notify_paid from public.store_notification_settings n where n.store_id = s.id), true)))
    from public.orders o
    join public.stores s on s.id = o.store_id
   where o.id = p_order_id
$$;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261110000100'::text
$$;
