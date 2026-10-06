-- =============================================================================
-- Gate F4 · Correcciones de la revisión de la Fase 4 (D-F4-04)
--   * inventory_movements.actor_user_id sin FK (como audit.audit_logs): borrar un
--     usuario ya no choca con el ledger append-only.
--   * El ledger sigue sin UPDATE; DELETE solo dentro de una purga controlada
--     (marca local app.inventory_purge, CF-06): cerrar y purgar una tienda o una
--     variante vuelve a ser posible. Ningún rol de aplicación tiene DELETE.
--   * Con 'deny', ningún movimiento que reduzca lo disponible lo deja negativo
--     (§15.2), tampoco ajustes, daños ni pérdidas.
--   * Idempotencia: la repetición de un ajuste 'set' devuelve lo aplicado; la
--     carrera con la misma clave verifica los datos y no audita dos veces.
--   * Validación de cantidad y variante en reservas y envíos; umbral auditado;
--     '\' escapado en la búsqueda.
-- =============================================================================

alter table public.inventory_movements drop constraint inventory_movements_actor_user_id_fkey;

drop trigger inventory_movements_append_only on public.inventory_movements;
create trigger inventory_movements_no_update before update on public.inventory_movements
  for each row execute function app.forbid_mutation();

create or replace function app.inventory_movements_delete_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.inventory_purge', true), '') <> 'on' then
    raise exception using errcode = '42501', message = 'append_only',
      detail = 'public.inventory_movements solo se borra en una purga controlada';
  end if;
  return old;
end
$$;
revoke all on function app.inventory_movements_delete_guard() from public;
create trigger inventory_movements_no_delete before delete on public.inventory_movements
  for each row execute function app.inventory_movements_delete_guard();

create or replace function app.apply_inventory_movement(
  p_store_id        uuid,
  p_level_id        uuid,
  p_type            text,
  p_on_hand_delta   integer,
  p_reserved_delta  integer,
  p_reason          text default null,
  p_reference_type  text default null,
  p_reference_id    uuid default null,
  p_idempotency_key text default null,
  p_actor_type      text default null
)
returns public.inventory_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mov      public.inventory_movements;
  v_continue boolean;
  v_on_hand  integer;
  v_reserved integer;
  v_uid      uuid := auth.uid();
begin
  if p_idempotency_key is not null then
    select * into v_mov from public.inventory_movements m
     where m.store_id = p_store_id and m.idempotency_key = p_idempotency_key;
    if found then
      if v_mov.level_id <> p_level_id or v_mov.type <> p_type
         or v_mov.on_hand_delta <> p_on_hand_delta or v_mov.reserved_delta <> p_reserved_delta then
        raise exception using errcode = 'P0001', message = 'conflict', detail = 'idempotency_key';
      end if;
      return v_mov; -- ya aplicado: no-op
    end if;
  end if;

  -- Sin seguimiento o con política 'continue' se puede reservar por encima de lo
  -- disponible; on_hand nunca baja de 0 (no se envía lo que no existe).
  select (not pv.track_inventory) or pv.inventory_policy = 'continue' into v_continue
    from public.inventory_levels l
    join public.product_variants pv on pv.store_id = l.store_id and pv.id = l.variant_id
   where l.id = p_level_id and l.store_id = p_store_id;
  if v_continue is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'inventory_level';
  end if;

  begin
    perform set_config('app.inventory_mutation', 'on', true);
    update public.inventory_levels l
       set on_hand = l.on_hand + p_on_hand_delta,
           reserved = l.reserved + p_reserved_delta
     where l.id = p_level_id and l.store_id = p_store_id
       and l.on_hand + p_on_hand_delta >= 0
       and l.reserved + p_reserved_delta >= 0
       -- Con 'deny', nada que reduzca lo disponible puede dejarlo negativo (§15.2):
       -- ni reservas ni ajustes, daños o pérdidas. Liberar, recibir o enviar lo
       -- reservado (sale: −q/−q) no reduce lo disponible y siempre se permite.
       and (v_continue
            or p_on_hand_delta - p_reserved_delta >= 0
            or (l.on_hand + p_on_hand_delta) - (l.reserved + p_reserved_delta) >= 0)
    returning l.on_hand, l.reserved into v_on_hand, v_reserved;
    perform set_config('app.inventory_mutation', 'off', true);
    if v_on_hand is null then
      raise exception using errcode = 'P0001', message = 'insufficient_stock', detail = p_level_id::text;
    end if;

    insert into public.inventory_movements
      (store_id, level_id, type, on_hand_delta, reserved_delta, on_hand_after, reserved_after, reason,
       reference_type, reference_id, actor_type, actor_user_id, idempotency_key)
    values (p_store_id, p_level_id, p_type, p_on_hand_delta, p_reserved_delta, v_on_hand, v_reserved,
            nullif(btrim(p_reason), ''), p_reference_type, p_reference_id,
            coalesce(p_actor_type, case when v_uid is null then 'system' else 'user' end), v_uid,
            p_idempotency_key)
    returning * into v_mov;
  exception when unique_violation then
    -- Otra transacción aplicó la misma clave a la vez: este bloque (UPDATE
    -- incluido) se revirtió; se devuelve el movimiento ya aplicado.
    select * into v_mov from public.inventory_movements m
     where m.store_id = p_store_id and m.idempotency_key = p_idempotency_key;
    if v_mov.id is null then
      raise;
    end if;
    if v_mov.level_id <> p_level_id or v_mov.type <> p_type
       or v_mov.on_hand_delta <> p_on_hand_delta or v_mov.reserved_delta <> p_reserved_delta then
      raise exception using errcode = 'P0001', message = 'conflict', detail = 'idempotency_key';
    end if;
  end;
  return v_mov;
end
$$;

create or replace function public.inventory_adjust(
  p_store_id        uuid,
  p_variant_id      uuid,
  p_type            text,
  p_quantity        integer,
  p_reason          text,
  p_mode            text default 'delta',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level uuid;
  v_delta integer;
  v_mov   public.inventory_movements;
  v_lvl   public.inventory_levels;
  v_replay boolean;
begin
  perform app.require_store_permission(p_store_id, 'inventory.adjust');
  if p_type is null or p_type not in ('adjustment', 'damage', 'loss') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'type';
  end if;
  if p_mode is null or p_mode not in ('delta', 'set') or (p_mode = 'set' and p_type <> 'adjustment') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'mode';
  end if;
  if coalesce(char_length(btrim(p_reason)), 0) not between 3 and 500 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'reason';
  end if;
  if p_quantity is null or abs(p_quantity) > 1000000 or (p_mode = 'set' and p_quantity < 0) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'quantity';
  end if;
  if p_idempotency_key is not null and char_length(p_idempotency_key) not between 8 and 100 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'idempotency_key';
  end if;

  if not exists (select 1 from public.product_variants v
                  where v.store_id = p_store_id and v.id = p_variant_id and v.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'variant';
  end if;
  v_level := app.default_level(p_store_id, p_variant_id);
  if v_level is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'inventory_level';
  end if;

  -- Repetición (misma clave): se devuelve lo ya aplicado sin recalcular el delta
  -- (en modo 'set' el delta dependería de las existencias actuales).
  if p_idempotency_key is not null then
    select * into v_mov from public.inventory_movements m
     where m.store_id = p_store_id and m.idempotency_key = 'adjust:' || p_idempotency_key;
    if found then
      if v_mov.level_id <> v_level or v_mov.type <> p_type
         or (p_mode = 'set' and v_mov.on_hand_after <> p_quantity)
         or (p_mode = 'delta' and v_mov.on_hand_delta <>
               case when p_type in ('damage', 'loss') then -abs(p_quantity) else p_quantity end) then
        raise exception using errcode = 'P0001', message = 'conflict', detail = 'idempotency_key';
      end if;
      return jsonb_build_object('movement_id', v_mov.id, 'on_hand', v_mov.on_hand_after,
                                'reserved', v_mov.reserved_after,
                                'available', v_mov.on_hand_after - v_mov.reserved_after, 'replayed', true);
    end if;
  end if;

  if p_mode = 'set' then
    -- Fija la cantidad leída bajo bloqueo para que el delta sea exacto.
    select * into v_lvl from public.inventory_levels where id = v_level for update;
    v_delta := p_quantity - v_lvl.on_hand;
  elsif p_type in ('damage', 'loss') then
    v_delta := -abs(p_quantity);
  else
    v_delta := p_quantity;
  end if;
  if v_delta = 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'quantity';
  end if;

  v_mov := app.apply_inventory_movement(p_store_id, v_level, p_type, v_delta, 0, p_reason, 'manual', null,
                                        case when p_idempotency_key is null then null
                                             else 'adjust:' || p_idempotency_key end);
  -- Si otra transacción ganó la carrera con la misma clave, el movimiento no es
  -- de esta transacción (created_at = now() solo para los propios): no se audita.
  v_replay := v_mov.created_at <> now();
  if not v_replay then
  perform audit.record('inventory.adjusted', 'inventory_level', v_level,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('type', p_type, 'delta', v_delta, 'on_hand', v_mov.on_hand_after),
                       btrim(p_reason));
  end if;
  return jsonb_build_object('movement_id', v_mov.id, 'on_hand', v_mov.on_hand_after,
                            'reserved', v_mov.reserved_after, 'available', v_mov.on_hand_after - v_mov.reserved_after);
end
$$;

create or replace function public.inventory_set_threshold(p_store_id uuid, p_variant_id uuid, p_threshold integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level uuid;
begin
  perform app.require_store_permission(p_store_id, 'inventory.adjust');
  if p_threshold is not null and p_threshold not between 0 and 1000000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'threshold';
  end if;
  if not exists (select 1 from public.product_variants v
                  where v.store_id = p_store_id and v.id = p_variant_id and v.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'variant';
  end if;
  v_level := app.default_level(p_store_id, p_variant_id);
  update public.inventory_levels set low_stock_threshold = p_threshold where id = v_level and store_id = p_store_id;
  perform audit.record('inventory.threshold_set', 'inventory_level', v_level,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('low_stock_threshold', p_threshold));
end
$$;

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
  v_id   uuid;
  v_item record;
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
    select app.default_level(p_store_id, v.id) as level_id, v.id as variant_id, sum(x.quantity)::integer as quantity
      from (select (e ->> 'variant_id')::uuid as variant_id, (e ->> 'quantity')::integer as quantity
              from jsonb_array_elements(p_items) e) x
      join public.product_variants v on v.store_id = p_store_id and v.id = x.variant_id and v.deleted_at is null
     where v.track_inventory
     group by v.id
     order by 1
  loop
    if v_item.level_id is null then
      raise exception using errcode = 'P0001', message = 'not_found', detail = 'inventory_level';
    end if;
    insert into public.inventory_reservation_items (store_id, reservation_id, level_id, quantity)
    values (p_store_id, v_id, v_item.level_id, v_item.quantity);
    begin
      perform app.apply_inventory_movement(p_store_id, v_item.level_id, 'reservation', 0, v_item.quantity, null,
                                           'order', p_order_id,
                                           'reservation:' || v_id || ':' || v_item.level_id, 'system');
    exception when sqlstate 'P0001' then
      if sqlerrm = 'insufficient_stock' then
        raise exception using errcode = 'P0001', message = 'insufficient_stock', detail = v_item.variant_id::text;
      end if;
      raise;
    end;
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
  v_item record;
  v_key  text;
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

  for v_item in
    select i.id, i.level_id, i.quantity - i.fulfilled_quantity - i.released_quantity as remaining,
           sum((e ->> 'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) e
      join public.inventory_reservation_items i
        on i.reservation_id = v.id and i.level_id = app.default_level(p_store_id, (e ->> 'variant_id')::uuid)
     group by i.id, i.level_id, i.quantity, i.fulfilled_quantity, i.released_quantity
     order by i.level_id
  loop
    v_key := 'sale:' || p_shipment_id || ':' || v_item.level_id;
    -- Envío ya registrado: no se descuenta dos veces.
    continue when exists (select 1 from public.inventory_movements m
                           where m.store_id = p_store_id and m.idempotency_key = v_key);
    if v_item.quantity <= 0 or v_item.quantity > v_item.remaining then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'quantity';
    end if;
    perform app.apply_inventory_movement(p_store_id, v_item.level_id, 'sale', -v_item.quantity, -v_item.quantity,
                                         null, 'order', v.order_id, v_key, 'system');
    update public.inventory_reservation_items set fulfilled_quantity = fulfilled_quantity + v_item.quantity
     where id = v_item.id;
  end loop;

  if not exists (select 1 from public.inventory_reservation_items i
                  where i.reservation_id = v.id and i.quantity - i.fulfilled_quantity - i.released_quantity > 0) then
    update public.inventory_reservations set status = 'fulfilled' where id = v.id and status <> 'fulfilled';
  end if;
end
$$;

create or replace function public.inventory_search(
  p_store_id  uuid,
  p_query     text default null,
  p_low_stock boolean default false,
  p_offset    integer default 0,
  p_limit     integer default 50
)
returns table (
  level_id            uuid,
  variant_id          uuid,
  product_id          uuid,
  product_title       text,
  option_signature    text,
  sku                 text,
  track_inventory     boolean,
  inventory_policy    text,
  on_hand             integer,
  reserved            integer,
  available           integer,
  low_stock_threshold integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform app.require_store_permission(p_store_id, 'inventory.read');
  return query
  select l.id, v.id, p.id, p.title, v.option_signature, v.sku, v.track_inventory, v.inventory_policy,
         l.on_hand, l.reserved, l.available, l.low_stock_threshold
    from public.inventory_levels l
    join public.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id and loc.is_default
    join public.product_variants v on v.store_id = l.store_id and v.id = l.variant_id and v.deleted_at is null
    join public.products p on p.store_id = v.store_id and p.id = v.product_id and p.deleted_at is null
   where l.store_id = p_store_id
     and (not coalesce(p_low_stock, false)
          or (v.track_inventory and l.low_stock_threshold is not null and l.available <= l.low_stock_threshold))
     and (v_q is null or v.sku = upper(v_q) or p.title ilike '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
   order by p.title, v.position, v.option_signature, l.id
  offset greatest(coalesce(p_offset, 0), 0)
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
end
$$;
