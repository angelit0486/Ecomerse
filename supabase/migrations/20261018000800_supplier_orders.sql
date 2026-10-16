-- =============================================================================
-- ADR-025 (aprobado 2026-10-16) · Proveedores y despacho directo — paso 2:
-- despachos por proveedor y plazo del proveedor en la ficha.
--
-- 1. supplier_orders / supplier_order_items: lo que cada proveedor debe despachar
--    de un pedido. Nacen al confirmarse el pago (app.inventory_commit), a partir
--    de los renglones de la reserva que salieron de la ubicación del proveedor:
--    una sola fuente de verdad (el inventario), sin red en la transacción (§44.10).
-- 2. Estado propio, distinto del pedido y del pago:
--      pending → requested → confirmed → shipped → delivered
--    (se puede adelantar pasos), o failed / cancelled desde cualquiera no final;
--    failed puede volver a pending (reintento) o cancelarse. Nada se borra (§44.9).
-- 3. La v1 solo tiene el adaptador `manual`: la dueña marca «solicitado» cuando
--    ella le pidió el envío al proveedor. Ninguna pantalla dice «enviado al
--    proveedor» sin que alguien lo haya registrado.
-- 4. Si el pedido se cancela, los despachos aún `pending` se cancelan (nunca se
--    pidieron); los ya solicitados quedan como están y el panel avisa.
-- 5. Ficha: `ships_in_days` por variante cuando solo hay existencias del
--    proveedor y éste tiene plazo capturado. Nunca se publica el proveedor.
-- Permisos sin claves nuevas: leer con orders.read; cambiar estado con
-- orders.update. Costos: nunca aparecen en los despachos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tablas
-- -----------------------------------------------------------------------------
create table public.supplier_orders (
  id                 uuid primary key default app.uuid_v7(),
  store_id           uuid not null references public.stores (id) on delete restrict,
  order_id           uuid not null,
  supplier_id        uuid not null,
  status             text not null default 'pending'
                     check (status in ('pending', 'requested', 'confirmed', 'shipped', 'delivered', 'failed',
                                       'cancelled')),
  external_reference text check (external_reference is null or char_length(btrim(external_reference)) between 1 and 100),
  carrier            text check (carrier is null or char_length(carrier) <= 80),
  tracking_number    text check (tracking_number is null or tracking_number ~ '^[A-Za-z0-9 -]{3,60}$'),
  tracking_url       text check (tracking_url is null or (tracking_url ~ '^https://[^\s<>"]+$' and char_length(tracking_url) <= 500)),
  note               text check (note is null or char_length(note) <= 1000),
  requested_at       timestamptz,
  confirmed_at       timestamptz,
  shipped_at         timestamptz,
  delivered_at       timestamptz,
  closed_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, order_id, supplier_id),
  foreign key (store_id, order_id) references public.orders (store_id, id) on delete restrict,
  foreign key (store_id, supplier_id) references public.suppliers (store_id, id) on delete restrict
);
create index supplier_orders_status_idx on public.supplier_orders (store_id, status, created_at desc);
create index supplier_orders_supplier_idx on public.supplier_orders (store_id, supplier_id);

-- Snapshot de lo que se le pide al proveedor (el título y SKU del pedido).
create table public.supplier_order_items (
  id                uuid primary key default app.uuid_v7(),
  store_id          uuid not null references public.stores (id) on delete restrict,
  supplier_order_id uuid not null,
  order_item_id     uuid,
  variant_id        uuid,
  product_title     text not null check (char_length(product_title) between 1 and 200),
  variant_title     text check (variant_title is null or char_length(variant_title) <= 200),
  sku               text check (sku is null or char_length(sku) <= 64),
  supplier_sku      text check (supplier_sku is null or char_length(supplier_sku) <= 100),
  quantity          integer not null check (quantity between 1 and 100000),
  created_at        timestamptz not null default now(),
  unique (store_id, id),
  unique (supplier_order_id, variant_id),
  foreign key (store_id, supplier_order_id) references public.supplier_orders (store_id, id) on delete restrict,
  foreign key (store_id, order_item_id) references public.order_items (store_id, id) on delete restrict,
  foreign key (store_id, variant_id) references public.product_variants (store_id, id) on delete set null (variant_id)
);

-- Transiciones válidas (también para escrituras directas como superusuario).
create or replace function app.supplier_orders_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_rank constant text[] := array['pending', 'requested', 'confirmed', 'shipped', 'delivered'];
begin
  if new.status is distinct from old.status then
    if old.status in ('delivered', 'cancelled')
       or (old.status = 'failed' and new.status not in ('pending', 'cancelled'))
       or (old.status <> 'failed' and new.status in ('pending', 'requested', 'confirmed', 'shipped', 'delivered')
           and array_position(v_rank, new.status) <= array_position(v_rank, old.status)) then
      raise exception using errcode = '23514', message = 'invalid_transition',
        detail = format('supplier_order %s → %s', old.status, new.status);
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.supplier_orders_guard() from public;

create trigger supplier_orders_set_updated_at before update on public.supplier_orders
  for each row execute function app.set_updated_at();
create trigger supplier_orders_prevent_tenant_change before update on public.supplier_orders
  for each row execute function app.prevent_tenant_change();
create trigger supplier_orders_immutable before update on public.supplier_orders
  for each row execute function app.prevent_column_change('order_id', 'supplier_id', 'created_at');
create trigger supplier_orders_guard before update on public.supplier_orders
  for each row execute function app.supplier_orders_guard();
create trigger supplier_orders_no_delete before delete on public.supplier_orders
  for each row execute function app.forbid_mutation();
create trigger supplier_order_items_append_only before update or delete on public.supplier_order_items
  for each row execute function app.forbid_mutation();

alter table public.supplier_orders enable row level security;
alter table public.supplier_orders force row level security;
alter table public.supplier_order_items enable row level security;
alter table public.supplier_order_items force row level security;
revoke all on table public.supplier_orders, public.supplier_order_items from public, anon, authenticated, service_role;
grant select on table public.supplier_orders, public.supplier_order_items to authenticated;
create policy supplier_orders_select on public.supplier_orders for select to authenticated
  using (app.has_store_permission(store_id, 'orders.read'));
create policy supplier_order_items_select on public.supplier_order_items for select to authenticated
  using (app.has_store_permission(store_id, 'orders.read'));

-- -----------------------------------------------------------------------------
-- 2. Alta de despachos al confirmarse el pago
-- -----------------------------------------------------------------------------
-- Idempotente: un despacho por (pedido, proveedor); si ya existe no se toca.
create or replace function app.supplier_orders_ensure(p_store_id uuid, p_reservation_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_sup      record;
  v_so       uuid;
  v_count    integer := 0;
begin
  select r.order_id into v_order_id from public.inventory_reservations r
   where r.store_id = p_store_id and r.id = p_reservation_id;
  if v_order_id is null then
    return 0;
  end if;
  for v_sup in
    select s.id, s.name
      from public.suppliers s
     where s.store_id = p_store_id
       and exists (select 1 from public.inventory_reservation_items i
                     join public.inventory_levels l on l.store_id = i.store_id and l.id = i.level_id
                    where i.store_id = p_store_id and i.reservation_id = p_reservation_id
                      and l.location_id = s.location_id and i.quantity - i.released_quantity > 0)
     order by s.created_at, s.id
  loop
    insert into public.supplier_orders (store_id, order_id, supplier_id)
    values (p_store_id, v_order_id, v_sup.id)
    on conflict (store_id, order_id, supplier_id) do nothing
    returning id into v_so;
    continue when v_so is null;

    insert into public.supplier_order_items (store_id, supplier_order_id, order_item_id, variant_id,
                                             product_title, variant_title, sku, supplier_sku, quantity)
    select p_store_id, v_so, oi.id, x.variant_id,
           coalesce(oi.product_title, '(sin título)'), oi.variant_title, oi.sku, sv.supplier_sku, x.quantity
      from (select l.variant_id, sum(i.quantity - i.released_quantity)::integer as quantity
              from public.inventory_reservation_items i
              join public.inventory_levels l on l.store_id = i.store_id and l.id = i.level_id
              join public.suppliers s on s.store_id = l.store_id and s.location_id = l.location_id
             where i.store_id = p_store_id and i.reservation_id = p_reservation_id and s.id = v_sup.id
             group by l.variant_id
            having sum(i.quantity - i.released_quantity) > 0) x
      left join lateral (select oi.* from public.order_items oi
                          where oi.store_id = p_store_id and oi.order_id = v_order_id
                            and oi.variant_id = x.variant_id
                          order by oi.position, oi.id limit 1) oi on true
      left join public.supplier_variants sv
        on sv.store_id = p_store_id and sv.supplier_id = v_sup.id and sv.variant_id = x.variant_id;

    insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, metadata)
    values (p_store_id, v_order_id, 'supplier_order.created',
            left('Despacho pendiente con ' || v_sup.name, 1000), false, 'system',
            jsonb_build_object('supplier_order_id', v_so));
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;
revoke all on function app.supplier_orders_ensure(uuid, uuid) from public;

-- Mismo contrato que antes (20261011000200) + alta de despachos en la transición.
create or replace function app.inventory_commit(p_store_id uuid, p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.inventory_reservations;
begin
  select * into v from public.inventory_reservations r
   where r.id = p_reservation_id and r.store_id = p_store_id for update;
  if v.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'reservation';
  end if;
  if v.status = 'committed' or v.status = 'fulfilled' then
    return;
  end if;
  if v.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'conflict', detail = v.status;
  end if;
  update public.inventory_reservations set status = 'committed', committed_at = now() where id = v.id;
  perform app.supplier_orders_ensure(p_store_id, v.id);
end
$$;
revoke all on function app.inventory_commit(uuid, uuid) from public;

-- Pedido cancelado: los despachos que nunca se pidieron se cancelan.
create or replace function app.supplier_orders_on_order_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with c as (
    update public.supplier_orders so set status = 'cancelled', closed_at = now()
     where so.store_id = new.store_id and so.order_id = new.id and so.status = 'pending'
    returning 1
  ) select count(*)::integer into v_count from c;
  if v_count > 0 then
    insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type)
    values (new.store_id, new.id, 'supplier_order.cancelled',
            'Despachos pendientes con proveedor cancelados por la cancelación del pedido', false, 'system');
  end if;
  return null;
end
$$;
revoke all on function app.supplier_orders_on_order_cancel() from public;

create trigger orders_cancel_supplier_orders after update of status on public.orders
  for each row when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function app.supplier_orders_on_order_cancel();

-- -----------------------------------------------------------------------------
-- 3. RPC del panel
-- -----------------------------------------------------------------------------
create or replace function app.supplier_order_json(p_so public.supplier_orders)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_so.id, 'order_id', p_so.order_id, 'status', p_so.status,
    'supplier', (select jsonb_build_object('id', s.id, 'name', s.name, 'adapter', s.adapter,
                                           'lead_time_min_days', s.lead_time_min_days,
                                           'lead_time_max_days', s.lead_time_max_days,
                                           'shipping_terms', s.shipping_terms)
                   from public.suppliers s where s.store_id = p_so.store_id and s.id = p_so.supplier_id),
    'order', (select jsonb_build_object('display_number', o.display_number, 'status', o.status,
                                        'payment_status', o.payment_status, 'placed_at', o.placed_at)
                from public.orders o where o.store_id = p_so.store_id and o.id = p_so.order_id),
    'external_reference', p_so.external_reference, 'carrier', p_so.carrier,
    'tracking_number', p_so.tracking_number, 'tracking_url', p_so.tracking_url, 'note', p_so.note,
    'requested_at', p_so.requested_at, 'confirmed_at', p_so.confirmed_at, 'shipped_at', p_so.shipped_at,
    'delivered_at', p_so.delivered_at, 'closed_at', p_so.closed_at,
    'created_at', p_so.created_at, 'updated_at', p_so.updated_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                          'variant_id', i.variant_id, 'order_item_id', i.order_item_id,
                          'product_title', i.product_title, 'variant_title', i.variant_title,
                          'sku', i.sku, 'supplier_sku', i.supplier_sku, 'quantity', i.quantity)
                        order by i.product_title, i.variant_title, i.id)
                         from public.supplier_order_items i
                        where i.store_id = p_so.store_id and i.supplier_order_id = p_so.id), '[]'::jsonb)
  )
$$;
revoke all on function app.supplier_order_json(public.supplier_orders) from public;

-- Despachos de un pedido (ficha del pedido).
create or replace function public.orders_supplier_orders(p_store_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'orders.read');
  return coalesce((select jsonb_agg(app.supplier_order_json(so) order by so.created_at, so.id)
                     from public.supplier_orders so
                    where so.store_id = p_store_id and so.order_id = p_order_id), '[]'::jsonb);
end
$$;
revoke all on function public.orders_supplier_orders(uuid, uuid) from public;
grant execute on function public.orders_supplier_orders(uuid, uuid) to authenticated;

-- Bandeja de despachos: `open` = los que aún requieren acción (pending, requested,
-- confirmed, shipped, failed); o un estado concreto. Máximo 200, recientes primero.
create or replace function public.supplier_orders_list(p_store_id uuid, p_status text default 'open',
                                                       p_supplier_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text := coalesce(nullif(p_status, ''), 'open');
begin
  perform app.require_store_permission(p_store_id, 'orders.read');
  if v_status not in ('open', 'all', 'pending', 'requested', 'confirmed', 'shipped', 'delivered', 'failed',
                      'cancelled') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
  return jsonb_build_object(
    'counts', coalesce((select jsonb_object_agg(c.status, c.n)
                          from (select so.status, count(*) as n from public.supplier_orders so
                                 where so.store_id = p_store_id
                                   and (p_supplier_id is null or so.supplier_id = p_supplier_id)
                                 group by so.status) c), '{}'::jsonb),
    'items', coalesce((select jsonb_agg(app.supplier_order_json(x) order by x.created_at desc, x.id desc)
                         from (select so.* from public.supplier_orders so
                                where so.store_id = p_store_id
                                  and (p_supplier_id is null or so.supplier_id = p_supplier_id)
                                  and case v_status
                                        when 'all' then true
                                        when 'open' then so.status in ('pending', 'requested', 'confirmed',
                                                                       'shipped', 'failed')
                                        else so.status = v_status end
                                order by so.created_at desc, so.id desc
                                limit 200) x), '[]'::jsonb)
  );
end
$$;
revoke all on function public.supplier_orders_list(uuid, text, uuid) from public;
grant execute on function public.supplier_orders_list(uuid, text, uuid) to authenticated;

-- Registrar el avance que informa el proveedor (adaptador manual).
-- p_data: {external_reference, carrier, tracking_number, tracking_url, note}; las
-- claves ausentes conservan su valor.
create or replace function public.supplier_orders_set_status(p_store_id uuid, p_supplier_order_id uuid,
                                                             p_status text, p_data jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_store_permission(p_store_id, 'orders.update');
  v_so     public.supplier_orders;
  v_data   jsonb := coalesce(p_data, '{}'::jsonb);
  v_ref    text;
  v_car    text;
  v_trk    text;
  v_url    text;
  v_note   text;
  v_sup    text;
  v_labels constant jsonb := '{"pending":"pendiente","requested":"solicitado al proveedor",
    "confirmed":"confirmado por el proveedor","shipped":"enviado por el proveedor","delivered":"entregado",
    "failed":"con problema","cancelled":"cancelado"}';
begin
  if jsonb_typeof(v_data) <> 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'data';
  end if;
  if p_status is null or not (v_labels ? p_status) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
  select * into v_so from public.supplier_orders so
   where so.store_id = p_store_id and so.id = p_supplier_order_id for update;
  if v_so.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'supplier_order';
  end if;

  v_ref  := case when v_data ? 'external_reference' then nullif(btrim(v_data ->> 'external_reference'), '')
                 else v_so.external_reference end;
  v_car  := case when v_data ? 'carrier' then nullif(btrim(v_data ->> 'carrier'), '') else v_so.carrier end;
  v_trk  := case when v_data ? 'tracking_number' then nullif(btrim(v_data ->> 'tracking_number'), '')
                 else v_so.tracking_number end;
  v_url  := case when v_data ? 'tracking_url' then nullif(btrim(v_data ->> 'tracking_url'), '')
                 else v_so.tracking_url end;
  v_note := case when v_data ? 'note' then nullif(btrim(v_data ->> 'note'), '') else v_so.note end;
  if v_ref is not null and (char_length(v_ref) > 100 or v_ref ~ '[[:cntrl:]]') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'external_reference';
  end if;
  if v_car is not null and (char_length(v_car) > 80 or v_car ~ '[[:cntrl:]]') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'carrier';
  end if;
  if v_trk is not null and v_trk !~ '^[A-Za-z0-9 -]{3,60}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'tracking_number';
  end if;
  if v_url is not null and (v_url !~ '^https://[^\s<>"]+$' or char_length(v_url) > 500) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'tracking_url';
  end if;
  if v_note is not null and (char_length(v_note) > 1000 or v_note ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'note';
  end if;

  if p_status = v_so.status and v_ref is not distinct from v_so.external_reference
     and v_car is not distinct from v_so.carrier and v_trk is not distinct from v_so.tracking_number
     and v_url is not distinct from v_so.tracking_url and v_note is not distinct from v_so.note then
    return app.supplier_order_json(v_so);
  end if;

  begin
    update public.supplier_orders
       set status = p_status, external_reference = v_ref, carrier = v_car, tracking_number = v_trk,
           tracking_url = v_url, note = v_note,
           requested_at = case when p_status in ('requested', 'confirmed', 'shipped', 'delivered')
                               then coalesce(requested_at, now()) else requested_at end,
           confirmed_at = case when p_status in ('confirmed', 'shipped', 'delivered')
                               then coalesce(confirmed_at, now()) else confirmed_at end,
           shipped_at   = case when p_status in ('shipped', 'delivered') then coalesce(shipped_at, now())
                               else shipped_at end,
           delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
           closed_at    = case when p_status in ('delivered', 'cancelled') then now()
                               when p_status = 'pending' then null else closed_at end
     where id = v_so.id
     returning * into v_so;
  exception when check_violation then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'invalid_transition';
  end;

  select s.name into v_sup from public.suppliers s where s.store_id = p_store_id and s.id = v_so.supplier_id;
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, actor_user_id,
                                   metadata)
  values (p_store_id, v_so.order_id, 'supplier_order.updated',
          left(format('Despacho con %s: %s', v_sup, v_labels ->> p_status), 1000), false, 'staff', v_uid,
          jsonb_build_object('supplier_order_id', v_so.id, 'status', p_status));
  perform audit.record('supplier_order.updated', 'supplier_order', v_so.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('status', p_status, 'order_id', v_so.order_id));
  return app.supplier_order_json(v_so);
end
$$;
revoke all on function public.supplier_orders_set_status(uuid, uuid, text, jsonb) from public;
grant execute on function public.supplier_orders_set_status(uuid, uuid, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Ficha: plazo del proveedor
-- -----------------------------------------------------------------------------
-- Solo si la variante controla inventario, no tiene existencias propias libres y
-- algún proveedor activo sí las tiene con plazo capturado: el del primero que la
-- reserva tomaría (mismo orden que app.inventory_reserve).
create or replace function app.variant_supplier_lead_time(p_store_id uuid, p_variant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when v.track_inventory
     and not exists (select 1 from public.inventory_levels l
                       join public.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id
                      where l.store_id = v.store_id and l.variant_id = v.id and loc.is_active and loc.kind = 'own'
                        and l.available > 0)
    then (select jsonb_build_object('min', s.lead_time_min_days, 'max', s.lead_time_max_days)
            from public.inventory_levels l
            join public.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id
            join public.suppliers s on s.store_id = loc.store_id and s.location_id = loc.id
           where l.store_id = v.store_id and l.variant_id = v.id and loc.is_active and s.status = 'active'
             and l.available > 0
           order by loc.created_at, l.id
           limit 1)
  end
  from public.product_variants v
  where v.store_id = p_store_id and v.id = p_variant_id
$$;
revoke all on function app.variant_supplier_lead_time(uuid, uuid) from public;

-- Mismo contrato que 20261017000400 + `ships_in_days` por variante ({min,max} o null).
create or replace function storefront.get_product(p_store_id uuid, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'title', p.title, 'description_html', p.description_html,
    'tags', to_jsonb(p.tags), 'seo_title', p.seo_title, 'seo_description', p.seo_description,
    'min_price', p.min_price, 'max_price', p.max_price, 'updated_at', p.updated_at,
    'published_at', p.published_at,
    'availability', app.product_state(p.store_id, p.id),
    'brand', (select jsonb_build_object('name', b.name, 'slug', b.slug) from public.brands b
               where b.store_id = p.store_id and b.id = p.brand_id and b.deleted_at is null),
    'options', coalesce((select jsonb_agg(jsonb_build_object('name', o.name, 'values',
                  (select coalesce(jsonb_agg(ov.value order by ov.position, ov.value), '[]'::jsonb)
                     from public.product_option_values ov where ov.option_id = o.id)) order by o.position, o.name)
                from public.product_options o where o.product_id = p.id), '[]'::jsonb),
    'variants', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', v.id, 'signature', v.option_signature, 'sku', v.sku, 'barcode', v.barcode,
                    'price', v.price, 'compare_at_price', v.compare_at_price,
                    'availability', s.state,
                    'ships_in_days', case when s.state <> 'out_of_stock'
                                          then (select case when lt ->> 'min' is not null and lt ->> 'max' is not null
                                                            then lt end
                                                  from app.variant_supplier_lead_time(v.store_id, v.id) lt) end,
                    'image', (select jsonb_build_object('path', m.storage_path, 'width', m.width,
                                                        'height', m.height, 'alt', m.alt_text)
                                from public.media m
                               where m.store_id = v.store_id and m.id = v.image_id and m.status = 'ready'
                                 and m.deleted_at is null)) order by v.position, v.option_signature)
                 from public.product_variants v
                 join app.variant_states(p.store_id, p.id) s on s.variant_id = v.id), '[]'::jsonb),
    'images', coalesce((select jsonb_agg(jsonb_build_object('path', m.storage_path, 'width', m.width,
                                                            'height', m.height, 'alt', m.alt_text)
                                         order by m.position, m.id)
                 from public.media m
                where m.store_id = p.store_id and m.product_id = p.id and m.status = 'ready'
                  and m.deleted_at is null), '[]'::jsonb),
    'breadcrumb', coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'path', a.path) order by a.depth)
                   from public.product_categories pc
                   join public.categories c on c.store_id = pc.store_id and c.id = pc.category_id
                   join public.categories a on a.store_id = c.store_id and a.deleted_at is null and a.is_visible
                    and (c.path = a.path or c.path like a.path || '/%')
                  where pc.product_id = p.id and pc.is_primary and c.deleted_at is null
                    and app.category_public(p.store_id, c.id)), '[]'::jsonb)
  )
    from public.products p
   where p.store_id = p_store_id and p.slug = p_slug and p.status = 'active' and p.deleted_at is null
     and app.store_publicly_readable(p_store_id)
$$;
revoke all on function storefront.get_product(uuid, text) from public;
grant execute on function storefront.get_product(uuid, text) to storefront_gateway;
