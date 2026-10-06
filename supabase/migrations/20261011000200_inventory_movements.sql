-- =============================================================================
-- Fase 4 · Inventario: movimientos, ajustes y reservas (F4-T02)
-- Contrato: GATE0 §15.3-15.5, §44.10.
--
-- app.apply_inventory_movement es el ÚNICO punto que cambia on_hand/reserved:
-- un UPDATE condicional atómico (sin SELECT … FOR UPDATE previo; en READ
-- COMMITTED PostgreSQL re-evalúa el WHERE sobre la versión confirmada) + la fila
-- del ledger, con idempotencia por (store_id, idempotency_key).
-- Las reservas (checkout, pago, envío) son funciones internas app.* que usarán
-- las Fases 6-7; ninguna es ejecutable por roles de aplicación.
-- =============================================================================

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
       and (v_continue
            or p_reserved_delta <= 0
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
  end;
  return v_mov;
end
$$;
revoke all on function app.apply_inventory_movement(uuid, uuid, text, integer, integer, text, text, uuid, text, text)
  from public;

-- Nivel de la variante en la ubicación por defecto (MVP: una ubicación, §15.6).
create or replace function app.default_level(p_store_id uuid, p_variant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id
    from public.inventory_levels l
    join public.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id and loc.is_default
   where l.store_id = p_store_id and l.variant_id = p_variant_id
$$;
revoke all on function app.default_level(uuid, uuid) from public;

-- -----------------------------------------------------------------------------
-- Ajuste manual, daño o pérdida (staff, inventory.adjust). Motivo obligatorio.
--   p_mode = 'delta': suma p_quantity (negativa para restar).
--   p_mode = 'set'  : deja on_hand en p_quantity (solo 'adjustment').
-- -----------------------------------------------------------------------------
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

  v_replay := p_idempotency_key is not null and exists (
    select 1 from public.inventory_movements m
     where m.store_id = p_store_id and m.idempotency_key = 'adjust:' || p_idempotency_key);
  v_mov := app.apply_inventory_movement(p_store_id, v_level, p_type, v_delta, 0, p_reason, 'manual', null,
                                        case when p_idempotency_key is null then null
                                             else 'adjust:' || p_idempotency_key end);
  -- Una repetición (misma clave) no es un ajuste nuevo: no se audita otra vez.
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
end
$$;

revoke all on function public.inventory_adjust(uuid, uuid, text, integer, text, text, text) from public;
revoke all on function public.inventory_set_threshold(uuid, uuid, integer) from public;
grant execute on function public.inventory_adjust(uuid, uuid, text, integer, text, text, text) to authenticated;
grant execute on function public.inventory_set_threshold(uuid, uuid, integer) to authenticated;

-- =============================================================================
-- Reservas (§15.4). Internas: las invocan las RPC de checkout, pagos y envíos.
-- =============================================================================

-- Checkout: reserva atómica de todos los items, en orden de level_id (sin
-- deadlocks entre pedidos con los mismos productos en distinto orden).
-- p_items: [{ "variant_id": uuid, "quantity": int }]. Las variantes sin
-- seguimiento de inventario no se reservan.
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
              where jsonb_typeof(x -> 'quantity') <> 'number' or (x ->> 'quantity')::integer <= 0) then
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

-- Pago aprobado: active → committed (lo reservado se mantiene hasta el envío).
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
end
$$;

-- Pago fallido, cancelación (released) o TTL vencido (expired): libera lo que no
-- se envió. Idempotente.
create or replace function app.inventory_release(p_store_id uuid, p_reservation_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v      public.inventory_reservations;
  v_item record;
begin
  if p_status is null or p_status not in ('released', 'expired') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
  select * into v from public.inventory_reservations r
   where r.id = p_reservation_id and r.store_id = p_store_id for update;
  if v.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'reservation';
  end if;
  if v.status in ('released', 'expired') then
    return;
  end if;
  if v.status = 'fulfilled' or (p_status = 'expired' and v.status <> 'active') then
    raise exception using errcode = 'P0001', message = 'conflict', detail = v.status;
  end if;

  for v_item in
    select i.* from public.inventory_reservation_items i
     where i.reservation_id = v.id and i.quantity - i.fulfilled_quantity - i.released_quantity > 0
     order by i.level_id
  loop
    perform app.apply_inventory_movement(p_store_id, v_item.level_id, 'release', 0,
                                         -(v_item.quantity - v_item.fulfilled_quantity - v_item.released_quantity),
                                         null, 'order', v.order_id, 'release:' || v_item.id, 'system');
    update public.inventory_reservation_items
       set released_quantity = quantity - fulfilled_quantity
     where id = v_item.id;
  end loop;
  update public.inventory_reservations set status = p_status, released_at = now() where id = v.id;
end
$$;

-- Envío: descuenta lo enviado (sale: −q en on_hand y en reserved). Exige
-- on_hand ≥ q aunque la política sea 'continue'. Idempotente por p_shipment_id.
-- p_items: [{ "variant_id": uuid, "quantity": int }].
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
  if jsonb_typeof(p_items) is distinct from 'array' or p_shipment_id is null then
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

revoke all on function app.inventory_reserve(uuid, uuid, jsonb, timestamptz) from public;
revoke all on function app.inventory_commit(uuid, uuid) from public;
revoke all on function app.inventory_release(uuid, uuid, text) from public;
revoke all on function app.inventory_fulfill(uuid, uuid, uuid, jsonb) from public;

-- -----------------------------------------------------------------------------
-- Invariante del ledger: la suma de los movimientos de cada nivel es su estado.
-- -----------------------------------------------------------------------------
create or replace function system.inventory_ledger_mismatches()
returns table (store_id uuid, level_id uuid, on_hand integer, ledger_on_hand bigint,
               reserved integer, ledger_reserved bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select l.store_id, l.id, l.on_hand, coalesce(sum(m.on_hand_delta), 0), l.reserved, coalesce(sum(m.reserved_delta), 0)
    from public.inventory_levels l
    left join public.inventory_movements m on m.store_id = l.store_id and m.level_id = l.id
   group by l.store_id, l.id, l.on_hand, l.reserved
  having l.on_hand <> coalesce(sum(m.on_hand_delta), 0) or l.reserved <> coalesce(sum(m.reserved_delta), 0)
$$;
revoke all on function system.inventory_ledger_mismatches() from public;
grant execute on function system.inventory_ledger_mismatches() to system_worker;
