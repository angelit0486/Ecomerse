-- =============================================================================
-- ADR-025 (aprobado 2026-10-16) · Proveedores y despacho directo — paso 1:
-- proveedores, sus variantes y su disponibilidad como inventario.
--
-- 1. inventory_locations.kind: `own` (bodega de la tienda) o `supplier`. La
--    ubicación principal siempre es propia.
-- 2. suppliers (cada uno con su ubicación de inventario) y supplier_variants
--    (SKU y costo del proveedor, disponibilidad informada, última sincronización).
-- 3. La disponibilidad del proveedor entra como existencias de su ubicación, solo
--    por app.apply_inventory_movement (§44.10): reservas, «Agotado» y checkout no
--    necesitan código aparte. Un proveedor inactivo desactiva su ubicación.
-- 4. app.inventory_reserve reparte la reserva entre ubicaciones activas (primero
--    la principal, luego las propias, luego proveedores, en orden de alta), con
--    los niveles bloqueados en ese orden. Sin existencias suficientes: con
--    'deny', insufficient_stock; con 'continue', el resto queda en la principal
--    (como antes). Con una sola ubicación el comportamiento es el mismo.
-- 5. app.inventory_fulfill descuenta lo enviado de los renglones de reserva de
--    cada variante (en el mismo orden) y es idempotente por envío completo.
-- Permisos sin claves nuevas (PermissionKey es contrato crítico): leer requiere
-- products.cost.read; dar de alta y editar, además products.update; cambiar
-- existencias, además inventory.adjust. Ninguna llamada de red: la v1 solo tiene
-- el adaptador `manual` (la dueña captura lo que le informa el proveedor).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tipo de ubicación
-- -----------------------------------------------------------------------------
alter table public.inventory_locations
  add column kind text not null default 'own' check (kind in ('own', 'supplier')),
  add constraint inventory_locations_default_own check (not is_default or kind = 'own');

-- -----------------------------------------------------------------------------
-- 2. Tablas
-- -----------------------------------------------------------------------------
create table public.suppliers (
  id                 uuid primary key default app.uuid_v7(),
  store_id           uuid not null references public.stores (id) on delete cascade,
  name               text not null check (char_length(btrim(name)) between 1 and 120),
  code               text not null check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(code) <= 60),
  status             text not null default 'active' check (status in ('active', 'inactive')),
  lead_time_min_days integer check (lead_time_min_days is null or lead_time_min_days between 0 and 365),
  lead_time_max_days integer check (lead_time_max_days is null or lead_time_max_days between 0 and 365),
  shipping_terms     text check (shipping_terms is null or char_length(btrim(shipping_terms)) between 1 and 1000),
  adapter            text not null default 'manual' check (adapter in ('manual')),
  location_id        uuid not null,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, code),
  unique (store_id, location_id),
  foreign key (store_id, location_id) references public.inventory_locations (store_id, id),
  constraint suppliers_lead_time check (lead_time_min_days is null or lead_time_max_days is null
                                        or lead_time_min_days <= lead_time_max_days)
);

create table public.supplier_variants (
  id                uuid primary key default app.uuid_v7(),
  store_id          uuid not null references public.stores (id) on delete cascade,
  supplier_id       uuid not null,
  variant_id        uuid not null,
  supplier_sku      text check (supplier_sku is null or char_length(btrim(supplier_sku)) between 1 and 100),
  unit_cost         bigint check (unit_cost is null or unit_cost >= 0),
  availability      text not null default 'unknown'
                    check (availability in ('available', 'limited', 'unavailable', 'unknown')),
  reported_quantity integer check (reported_quantity is null or reported_quantity between 0 and 1000000),
  last_synced_at    timestamptz,
  sync_source       text not null default 'manual' check (sync_source in ('manual', 'csv', 'adapter')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, supplier_id, variant_id),
  foreign key (store_id, supplier_id) references public.suppliers (store_id, id) on delete cascade,
  foreign key (store_id, variant_id) references public.product_variants (store_id, id) on delete cascade
);
create index supplier_variants_variant_idx on public.supplier_variants (store_id, variant_id);

create trigger suppliers_set_updated_at before update on public.suppliers
  for each row execute function app.set_updated_at();
create trigger supplier_variants_set_updated_at before update on public.supplier_variants
  for each row execute function app.set_updated_at();
create trigger suppliers_prevent_tenant_change before update on public.suppliers
  for each row execute function app.prevent_tenant_change();
create trigger supplier_variants_prevent_tenant_change before update on public.supplier_variants
  for each row execute function app.prevent_tenant_change();
-- Auditoría explícita en las RPC, sin costos (la Actividad la leen roles que no ven
-- costos).

alter table public.suppliers enable row level security;
alter table public.suppliers force row level security;
alter table public.supplier_variants enable row level security;
alter table public.supplier_variants force row level security;
revoke all on table public.suppliers, public.supplier_variants from public, anon, authenticated, service_role;
grant select on table public.suppliers, public.supplier_variants to authenticated;
-- Datos comerciales sensibles (costos del proveedor): como variant_costs.
create policy suppliers_select on public.suppliers for select to authenticated
  using (app.has_store_permission(store_id, 'products.cost.read'));
create policy supplier_variants_select on public.supplier_variants for select to authenticated
  using (app.has_store_permission(store_id, 'products.cost.read'));

-- -----------------------------------------------------------------------------
-- 3. Reserva repartida entre ubicaciones
-- -----------------------------------------------------------------------------
create or replace function app.inventory_reserve(
  p_store_id   uuid,
  p_order_id   uuid,
  p_items      jsonb,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid;
  v_item     record;
  v_lvl      record;
  v_need     integer;
  v_take     integer;
  v_default  uuid;
  v_plan     jsonb;
  v_step     jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0
     or p_expires_at is null or p_expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'items';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) x
              where coalesce(jsonb_typeof(x -> 'quantity'), '') <> 'number' or (x ->> 'quantity')::integer <= 0
                 or coalesce(jsonb_typeof(x -> 'variant_id'), '') <> 'string') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'quantity';
  end if;

  begin
    insert into public.inventory_reservations (store_id, order_id, expires_at)
    values (p_store_id, p_order_id, p_expires_at) returning id into v_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'reservation_exists';
  end;

  for v_item in
    select v.id as variant_id, v.inventory_policy = 'continue' as continue_policy,
           sum(x.quantity)::integer as quantity
      from (select (e ->> 'variant_id')::uuid as variant_id, (e ->> 'quantity')::integer as quantity
              from jsonb_array_elements(p_items) e) x
      join public.product_variants v on v.store_id = p_store_id and v.id = x.variant_id and v.deleted_at is null
     where v.track_inventory
     group by v.id, v.inventory_policy
     order by v.id
  loop
    v_default := app.default_level(p_store_id, v_item.variant_id);
    if v_default is null then
      raise exception using errcode = 'P0001', message = 'not_found', detail = 'inventory_level';
    end if;
    v_need := v_item.quantity;
    v_plan := '{}'::jsonb;
    -- Niveles activos en orden fijo (principal, propias, proveedores) y bloqueados en
    -- ese orden: dos reservas simultáneas nunca se cruzan ni sobrevenden.
    for v_lvl in
      select l.id, l.available
        from public.inventory_levels l
        join public.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id
       where l.store_id = p_store_id and l.variant_id = v_item.variant_id and loc.is_active
       order by loc.is_default desc, (loc.kind = 'own') desc, loc.created_at, l.id
         for update of l
    loop
      exit when v_need = 0;
      v_take := least(v_need, greatest(v_lvl.available, 0));
      if v_take > 0 then
        v_plan := v_plan || jsonb_build_object(v_lvl.id::text, v_take);
        v_need := v_need - v_take;
      end if;
    end loop;
    if v_need > 0 then
      if not v_item.continue_policy then
        raise exception using errcode = 'P0001', message = 'insufficient_stock', detail = v_item.variant_id::text;
      end if;
      -- 'continue' (bajo pedido): el resto queda en la principal, como antes.
      v_plan := v_plan || jsonb_build_object(v_default::text,
                                             coalesce((v_plan ->> v_default::text)::integer, 0) + v_need);
    end if;

    for v_step in select jsonb_build_object('level', e.key, 'quantity', e.value) from jsonb_each(v_plan) e
                   order by e.key loop
      insert into public.inventory_reservation_items (store_id, reservation_id, level_id, quantity)
      values (p_store_id, v_id, (v_step ->> 'level')::uuid, (v_step ->> 'quantity')::integer);
      begin
        perform app.apply_inventory_movement(p_store_id, (v_step ->> 'level')::uuid, 'reservation', 0,
                                             (v_step ->> 'quantity')::integer, null, 'order', p_order_id,
                                             'reservation:' || v_id || ':' || (v_step ->> 'level'), 'system');
      exception when sqlstate 'P0001' then
        if sqlerrm = 'insufficient_stock' then
          raise exception using errcode = 'P0001', message = 'insufficient_stock', detail = v_item.variant_id::text;
        end if;
        raise;
      end;
    end loop;
  end loop;

  -- Toda variante pedida debe existir en la tienda (aunque no tenga seguimiento).
  if exists (select 1 from jsonb_array_elements(p_items) e
              where not exists (select 1 from public.product_variants v
                                 where v.store_id = p_store_id and v.id = (e ->> 'variant_id')::uuid
                                   and v.deleted_at is null)) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'variant';
  end if;
  return v_id;
end
$$;
revoke all on function app.inventory_reserve(uuid, uuid, jsonb, timestamptz) from public;

-- -----------------------------------------------------------------------------
-- 4. Envío: descuenta de los renglones de reserva de cada variante
-- -----------------------------------------------------------------------------
create or replace function app.inventory_fulfill(
  p_store_id       uuid,
  p_reservation_id uuid,
  p_shipment_id    uuid,
  p_items          jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v      public.inventory_reservations;
  v_req  record;
  v_item record;
  v_need integer;
  v_take integer;
begin
  select * into v from public.inventory_reservations r
   where r.id = p_reservation_id and r.store_id = p_store_id for update;
  if v.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'reservation';
  end if;
  if v.status not in ('committed', 'fulfilled') then
    raise exception using errcode = 'P0001', message = 'conflict', detail = v.status;
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or p_shipment_id is null
     or exists (select 1 from jsonb_array_elements(p_items) x
                 where coalesce(jsonb_typeof(x -> 'quantity'), '') <> 'number' or (x ->> 'quantity')::integer <= 0
                    or coalesce(jsonb_typeof(x -> 'variant_id'), '') <> 'string') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'items';
  end if;
  -- Envío ya registrado (se aplica completo en una transacción): no se descuenta dos veces.
  if exists (select 1 from public.inventory_movements m
              where m.store_id = p_store_id and m.reference_type = 'order' and m.reference_id = v.order_id
                and m.idempotency_key like 'sale:' || p_shipment_id || ':%') then
    return;
  end if;

  for v_req in
    select (e ->> 'variant_id')::uuid as variant_id, sum((e ->> 'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) e
     group by 1
     order by 1
  loop
    v_need := v_req.quantity;
    -- Solo variantes con renglones de reserva (las sin seguimiento no tienen).
    continue when not exists (select 1 from public.inventory_reservation_items i
                                join public.inventory_levels l on l.store_id = i.store_id and l.id = i.level_id
                               where i.reservation_id = v.id and l.variant_id = v_req.variant_id);
    for v_item in
      select i.id, i.level_id, i.quantity - i.fulfilled_quantity - i.released_quantity as remaining
        from public.inventory_reservation_items i
        join public.inventory_levels l on l.store_id = i.store_id and l.id = i.level_id
        join public.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id
       where i.reservation_id = v.id and l.variant_id = v_req.variant_id
         and i.quantity - i.fulfilled_quantity - i.released_quantity > 0
       order by loc.is_default desc, (loc.kind = 'own') desc, loc.created_at, l.id
    loop
      exit when v_need = 0;
      v_take := least(v_need, v_item.remaining);
      perform app.apply_inventory_movement(p_store_id, v_item.level_id, 'sale', -v_take, -v_take,
                                           null, 'order', v.order_id,
                                           'sale:' || p_shipment_id || ':' || v_item.level_id, 'system');
      update public.inventory_reservation_items set fulfilled_quantity = fulfilled_quantity + v_take
       where id = v_item.id;
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'quantity';
    end if;
  end loop;

  if not exists (select 1 from public.inventory_reservation_items i
                  where i.reservation_id = v.id and i.quantity - i.fulfilled_quantity - i.released_quantity > 0) then
    update public.inventory_reservations set status = 'fulfilled' where id = v.id and status <> 'fulfilled';
  end if;
end
$$;
revoke all on function app.inventory_fulfill(uuid, uuid, uuid, jsonb) from public;

-- -----------------------------------------------------------------------------
-- 5. RPC del panel
-- -----------------------------------------------------------------------------
create or replace function public.suppliers_list(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'products.cost.read');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'name', s.name, 'code', s.code, 'status', s.status,
             'lead_time_min_days', s.lead_time_min_days, 'lead_time_max_days', s.lead_time_max_days,
             'shipping_terms', s.shipping_terms, 'adapter', s.adapter,
             'variants', (select count(*) from public.supplier_variants sv
                           where sv.store_id = s.store_id and sv.supplier_id = s.id),
             'last_synced_at', (select max(sv.last_synced_at) from public.supplier_variants sv
                                 where sv.store_id = s.store_id and sv.supplier_id = s.id))
           order by lower(s.name), s.id)
      from public.suppliers s where s.store_id = p_store_id), '[]'::jsonb);
end
$$;
revoke all on function public.suppliers_list(uuid) from public;
grant execute on function public.suppliers_list(uuid) to authenticated;

create or replace function public.suppliers_save(p_store_id uuid, p_supplier jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_store_permission(p_store_id, 'products.update');
  v_id     uuid;
  v_name   text := btrim(coalesce(p_supplier ->> 'name', ''));
  v_code   text;
  v_status text := coalesce(nullif(p_supplier ->> 'status', ''), 'active');
  v_terms  text := nullif(btrim(coalesce(p_supplier ->> 'shipping_terms', '')), '');
  v_min    integer;
  v_max    integer;
  v_loc    uuid;
  v_before public.suppliers;
begin
  perform app.require_store_permission(p_store_id, 'products.cost.read');
  if p_supplier is null or jsonb_typeof(p_supplier) <> 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'supplier';
  end if;
  begin
    v_id := nullif(p_supplier ->> 'id', '')::uuid;
    v_min := nullif(p_supplier ->> 'lead_time_min_days', '')::integer;
    v_max := nullif(p_supplier ->> 'lead_time_max_days', '')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'lead_time';
  end;
  if char_length(v_name) not between 1 and 120 or v_name ~ '[[:cntrl:]]' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'name';
  end if;
  if v_status not in ('active', 'inactive') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
  if (v_min is not null and v_min not between 0 and 365) or (v_max is not null and v_max not between 0 and 365)
     or (v_min is not null and v_max is not null and v_min > v_max) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'lead_time';
  end if;
  if v_terms is not null and (char_length(v_terms) > 1000 or v_terms ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'shipping_terms';
  end if;

  if v_id is null then
    v_code := left(nullif(btrim(coalesce(p_supplier ->> 'code', '')), ''), 60);
    v_code := coalesce(v_code, left(app.slugify(v_name), 60));
    if v_code is null or v_code !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'code';
    end if;
    if exists (select 1 from public.suppliers s where s.store_id = p_store_id and s.code = v_code) then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'code';
    end if;
    insert into public.inventory_locations (store_id, name, kind, is_active)
    values (p_store_id, left('Proveedor: ' || v_name, 120), 'supplier', v_status = 'active')
    returning id into v_loc;
    insert into public.suppliers (store_id, name, code, status, lead_time_min_days, lead_time_max_days,
                                  shipping_terms, location_id, created_by)
    values (p_store_id, v_name, v_code, v_status, v_min, v_max, v_terms, v_loc, v_uid)
    returning id into v_id;
  else
    select * into v_before from public.suppliers s where s.store_id = p_store_id and s.id = v_id for update;
    if v_before.id is null then
      raise exception using errcode = 'P0001', message = 'not_found', detail = 'supplier';
    end if;
    update public.suppliers
       set name = v_name, status = v_status, lead_time_min_days = v_min, lead_time_max_days = v_max,
           shipping_terms = v_terms
     where id = v_id;
    -- Un proveedor inactivo no aporta disponibilidad (su ubicación se desactiva).
    update public.inventory_locations
       set name = left('Proveedor: ' || v_name, 120), is_active = v_status = 'active'
     where store_id = p_store_id and id = v_before.location_id;
  end if;
  perform audit.record(case when v_before.id is null then 'supplier.created' else 'supplier.updated' end,
                       'supplier', v_id, (select s.organization_id from public.stores s where s.id = p_store_id),
                       p_store_id,
                       case when v_before.id is not null then
                         jsonb_build_object('name', v_before.name, 'status', v_before.status) end,
                       jsonb_build_object('name', v_name, 'status', v_status));
  return v_id;
end
$$;
revoke all on function public.suppliers_save(uuid, jsonb) from public;
grant execute on function public.suppliers_save(uuid, jsonb) to authenticated;

create or replace function public.suppliers_variants(p_store_id uuid, p_supplier_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_loc uuid;
begin
  perform app.require_store_permission(p_store_id, 'products.cost.read');
  select s.location_id into v_loc from public.suppliers s where s.store_id = p_store_id and s.id = p_supplier_id;
  if v_loc is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'supplier';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'variant_id', v.id, 'product_id', p.id, 'product_title', p.title,
             'option_signature', v.option_signature, 'sku', v.sku,
             'supplier_sku', sv.supplier_sku, 'unit_cost', sv.unit_cost, 'availability', sv.availability,
             'reported_quantity', sv.reported_quantity, 'last_synced_at', sv.last_synced_at,
             'sync_source', sv.sync_source, 'on_hand', l.on_hand, 'reserved', l.reserved)
           order by p.title, v.position, v.id)
      from public.supplier_variants sv
      join public.product_variants v on v.store_id = sv.store_id and v.id = sv.variant_id and v.deleted_at is null
      join public.products p on p.store_id = v.store_id and p.id = v.product_id and p.deleted_at is null
      left join public.inventory_levels l on l.store_id = v.store_id and l.variant_id = v.id and l.location_id = v_loc
     where sv.store_id = p_store_id and sv.supplier_id = p_supplier_id), '[]'::jsonb);
end
$$;
revoke all on function public.suppliers_variants(uuid, uuid) from public;
grant execute on function public.suppliers_variants(uuid, uuid) to authenticated;

-- Vincula una variante con el proveedor y registra lo que informó. Las
-- existencias de su ubicación quedan en la cantidad informada (`available`,
-- `limited`) o en 0 (`unavailable`, `unknown`: no se promete lo que no se
-- sabe), nunca por debajo de lo ya reservado. Devuelve las existencias que
-- quedaron y si hubo que respetar reservas.
create or replace function public.suppliers_set_variant(p_store_id uuid, p_supplier_id uuid, p_variant_id uuid,
                                                        p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier public.suppliers;
  v_avail    text := coalesce(nullif(p_data ->> 'availability', ''), 'unknown');
  v_sku      text := nullif(btrim(coalesce(p_data ->> 'supplier_sku', '')), '');
  v_cost     bigint;
  v_qty      integer;
  v_target   integer;
  v_level    public.inventory_levels;
  v_clamped  boolean := false;
begin
  perform app.require_store_permission(p_store_id, 'products.update');
  perform app.require_store_permission(p_store_id, 'products.cost.read');
  perform app.require_store_permission(p_store_id, 'inventory.adjust');
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'data';
  end if;
  select * into v_supplier from public.suppliers s where s.store_id = p_store_id and s.id = p_supplier_id;
  if v_supplier.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'supplier';
  end if;
  if not exists (select 1 from public.product_variants v
                  where v.store_id = p_store_id and v.id = p_variant_id and v.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'variant';
  end if;
  if v_avail not in ('available', 'limited', 'unavailable', 'unknown') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'availability';
  end if;
  if v_sku is not null and (char_length(v_sku) > 100 or v_sku ~ '[[:cntrl:]]') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'supplier_sku';
  end if;
  begin
    v_cost := case when jsonb_typeof(p_data -> 'unit_cost') = 'number' then (p_data ->> 'unit_cost')::bigint end;
    v_qty := case when jsonb_typeof(p_data -> 'quantity') = 'number' then (p_data ->> 'quantity')::integer end;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'quantity';
  end;
  if (p_data ? 'unit_cost' and jsonb_typeof(p_data -> 'unit_cost') not in ('number', 'null'))
     or (v_cost is not null and v_cost < 0) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'unit_cost';
  end if;
  if v_avail in ('available', 'limited') and (v_qty is null or v_qty not between 0 and 1000000) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'quantity';
  end if;
  v_target := case when v_avail in ('available', 'limited') then v_qty else 0 end;

  insert into public.supplier_variants (store_id, supplier_id, variant_id, supplier_sku, unit_cost, availability,
                                        reported_quantity, last_synced_at, sync_source)
  values (p_store_id, p_supplier_id, p_variant_id, v_sku, v_cost, v_avail,
          case when v_avail in ('available', 'limited') then v_qty end, now(), 'manual')
  on conflict (store_id, supplier_id, variant_id) do update
    set supplier_sku = excluded.supplier_sku, unit_cost = excluded.unit_cost, availability = excluded.availability,
        reported_quantity = excluded.reported_quantity, last_synced_at = excluded.last_synced_at,
        sync_source = excluded.sync_source;

  insert into public.inventory_levels (store_id, variant_id, location_id)
  values (p_store_id, p_variant_id, v_supplier.location_id)
  on conflict (variant_id, location_id) do nothing;
  select * into v_level from public.inventory_levels l
   where l.store_id = p_store_id and l.variant_id = p_variant_id and l.location_id = v_supplier.location_id
     for update;
  if v_target < v_level.reserved then
    v_target := v_level.reserved;  -- lo ya reservado sigue cubierto (el proveedor lo confirmará o se cancela)
    v_clamped := true;
  end if;
  if v_target <> v_level.on_hand then
    perform app.apply_inventory_movement(p_store_id, v_level.id, 'adjustment', v_target - v_level.on_hand, 0,
                                         'Disponibilidad informada por el proveedor ' || v_supplier.name,
                                         'manual', p_supplier_id, null, null);
  end if;
  perform audit.record('supplier.variant_synced', 'supplier', p_supplier_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('on_hand', v_level.on_hand),
                       jsonb_build_object('variant_id', p_variant_id, 'availability', v_avail, 'on_hand', v_target));
  return jsonb_build_object('on_hand', v_target, 'clamped_to_reserved', v_clamped);
end
$$;
revoke all on function public.suppliers_set_variant(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.suppliers_set_variant(uuid, uuid, uuid, jsonb) to authenticated;

-- Desvincula: solo sin reservas en su ubicación; sus existencias vuelven a 0.
create or replace function public.suppliers_unlink_variant(p_store_id uuid, p_supplier_id uuid, p_variant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier public.suppliers;
  v_level    public.inventory_levels;
begin
  perform app.require_store_permission(p_store_id, 'products.update');
  perform app.require_store_permission(p_store_id, 'products.cost.read');
  perform app.require_store_permission(p_store_id, 'inventory.adjust');
  select * into v_supplier from public.suppliers s where s.store_id = p_store_id and s.id = p_supplier_id;
  if v_supplier.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'supplier';
  end if;
  select * into v_level from public.inventory_levels l
   where l.store_id = p_store_id and l.variant_id = p_variant_id and l.location_id = v_supplier.location_id
     for update;
  if v_level.id is not null then
    if v_level.reserved > 0 then
      raise exception using errcode = 'P0001', message = 'conflict', detail = 'reserved';
    end if;
    if v_level.on_hand > 0 then
      perform app.apply_inventory_movement(p_store_id, v_level.id, 'adjustment', -v_level.on_hand, 0,
                                           'Variante desvinculada del proveedor ' || v_supplier.name,
                                           'manual', p_supplier_id, null, null);
    end if;
  end if;
  delete from public.supplier_variants sv
   where sv.store_id = p_store_id and sv.supplier_id = p_supplier_id and sv.variant_id = p_variant_id;
  perform audit.record('supplier.variant_unlinked', 'supplier', p_supplier_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('variant_id', p_variant_id), null);
end
$$;
revoke all on function public.suppliers_unlink_variant(uuid, uuid, uuid) from public;
grant execute on function public.suppliers_unlink_variant(uuid, uuid, uuid) to authenticated;
