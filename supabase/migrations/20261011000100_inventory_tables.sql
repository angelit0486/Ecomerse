-- =============================================================================
-- Fase 4 · Inventario: tablas (F4-T01)
-- Contrato: GATE0 §15.1-15.2, §13 (FK compuestas), §44.9-10.
--
-- * Una ubicación por defecto por tienda (backfill + trigger AFTER INSERT ON stores).
-- * Un nivel por variante y ubicación (backfill + trigger AFTER INSERT ON
--   product_variants). on_hand/reserved solo cambian dentro de
--   app.apply_inventory_movement (F4-T02): lo garantiza un trigger, no solo los grants.
-- * inventory_movements es el ledger: append-only (ni UPDATE ni DELETE).
-- * inventory_reservations.order_id: la FK compuesta a orders se agrega en la
--   Fase 6, cuando exista la tabla (D-F4-01; mismo patrón que system.jobs.store_id).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Ubicaciones
-- -----------------------------------------------------------------------------
create table public.inventory_locations (
  id          uuid primary key default app.uuid_v7(),
  store_id    uuid not null references public.stores (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  address     jsonb check (address is null or (jsonb_typeof(address) = 'object' and octet_length(address::text) <= 4096)),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (store_id, id),
  constraint inventory_locations_default_active check (not is_default or is_active)
);
create unique index inventory_locations_default_uq on public.inventory_locations (store_id) where is_default;

-- -----------------------------------------------------------------------------
-- Niveles
-- -----------------------------------------------------------------------------
create table public.inventory_levels (
  id                  uuid primary key default app.uuid_v7(),
  store_id            uuid not null references public.stores (id) on delete cascade,
  variant_id          uuid not null,
  location_id         uuid not null,
  on_hand             integer not null default 0 check (on_hand >= 0),
  reserved            integer not null default 0 check (reserved >= 0),
  incoming            integer not null default 0 check (incoming >= 0),
  available           integer generated always as (on_hand - reserved) stored,
  low_stock_threshold integer check (low_stock_threshold is null or low_stock_threshold between 0 and 1000000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (store_id, id),
  unique (variant_id, location_id),
  -- La cascada solo ocurre en la purga controlada de variantes (CF-06).
  foreign key (store_id, variant_id) references public.product_variants (store_id, id) on delete cascade,
  -- NO ACTION (comprobado al final de la sentencia): borrar una ubicación con
  -- niveles falla, pero la cascada desde stores sigue funcionando.
  foreign key (store_id, location_id) references public.inventory_locations (store_id, id)
);
create index inventory_levels_location_idx on public.inventory_levels (store_id, location_id);
create index inventory_levels_low_stock_idx on public.inventory_levels (store_id)
  where low_stock_threshold is not null and available <= low_stock_threshold;

-- Solo app.apply_inventory_movement mueve on_hand/reserved (§44.10). Cualquier
-- otro UPDATE de esas columnas, incluso desde una función SECURITY DEFINER, falla.
create or replace function app.inventory_levels_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.on_hand is distinct from old.on_hand or new.reserved is distinct from old.reserved)
     and coalesce(current_setting('app.inventory_mutation', true), '') <> 'on' then
    raise exception using errcode = '42501', message = 'inventory_direct_write',
      detail = 'usa app.apply_inventory_movement';
  end if;
  if new.variant_id is distinct from old.variant_id or new.location_id is distinct from old.location_id then
    raise exception using errcode = '42501', message = 'immutable_column';
  end if;
  return new;
end
$$;
revoke all on function app.inventory_levels_guard() from public;

-- Un nivel nace siempre en 0: las existencias iniciales entran como movimiento.
create or replace function app.inventory_levels_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.on_hand <> 0 or new.reserved <> 0 then
    raise exception using errcode = '42501', message = 'inventory_direct_write',
      detail = 'un nivel nace en 0; usa un movimiento initial';
  end if;
  return new;
end
$$;
revoke all on function app.inventory_levels_insert_guard() from public;

-- -----------------------------------------------------------------------------
-- Ledger
-- -----------------------------------------------------------------------------
create table public.inventory_movements (
  id              uuid primary key default app.uuid_v7(),
  store_id        uuid not null references public.stores (id) on delete cascade,
  level_id        uuid not null,
  type            text not null check (type in ('initial', 'purchase', 'sale', 'return', 'adjustment', 'damage',
                                                'loss', 'transfer_in', 'transfer_out', 'reservation', 'release')),
  on_hand_delta   integer not null,
  reserved_delta  integer not null,
  on_hand_after   integer not null check (on_hand_after >= 0),
  reserved_after  integer not null check (reserved_after >= 0),
  reason          text check (reason is null or char_length(btrim(reason)) between 3 and 500),
  reference_type  text check (reference_type is null
                              or reference_type in ('order', 'refund', 'import', 'manual', 'purchase_order', 'transfer')),
  reference_id    uuid,
  actor_type      text not null check (actor_type in ('user', 'system', 'provider')),
  actor_user_id   uuid references auth.users (id) on delete set null,
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 1 and 200),
  created_at      timestamptz not null default now(),
  constraint inventory_movements_reason_required
    check (type not in ('adjustment', 'damage', 'loss') or reason is not null),
  constraint inventory_movements_nonzero check (on_hand_delta <> 0 or reserved_delta <> 0),
  constraint inventory_movements_direction check (
    case type
      when 'initial'      then on_hand_delta > 0 and reserved_delta = 0
      when 'purchase'     then on_hand_delta > 0 and reserved_delta = 0
      when 'return'       then on_hand_delta > 0 and reserved_delta = 0
      when 'transfer_in'  then on_hand_delta > 0 and reserved_delta = 0
      when 'damage'       then on_hand_delta < 0 and reserved_delta = 0
      when 'loss'         then on_hand_delta < 0 and reserved_delta = 0
      when 'transfer_out' then on_hand_delta < 0 and reserved_delta = 0
      when 'adjustment'   then reserved_delta = 0
      when 'reservation'  then on_hand_delta = 0 and reserved_delta > 0
      when 'release'      then on_hand_delta = 0 and reserved_delta < 0
      when 'sale'         then on_hand_delta < 0 and reserved_delta = on_hand_delta
    end),
  foreign key (store_id, level_id) references public.inventory_levels (store_id, id)
);
create unique index inventory_movements_idempotency_uq on public.inventory_movements (store_id, idempotency_key)
  where idempotency_key is not null;
create index inventory_movements_level_idx on public.inventory_movements (store_id, level_id, created_at desc);

create trigger inventory_movements_append_only before update or delete on public.inventory_movements
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Reservas (encabezado + items). Las usan checkout, pagos y fulfillment (F6-F7).
-- -----------------------------------------------------------------------------
create table public.inventory_reservations (
  id           uuid primary key default app.uuid_v7(),
  store_id     uuid not null references public.stores (id) on delete cascade,
  order_id     uuid not null,
  status       text not null default 'active'
               check (status in ('active', 'committed', 'released', 'expired', 'fulfilled')),
  expires_at   timestamptz not null,
  committed_at timestamptz,
  released_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (store_id, id),
  constraint inventory_reservations_committed_at check ((status in ('committed', 'fulfilled')) <= (committed_at is not null)),
  constraint inventory_reservations_released_at check ((status in ('released', 'expired')) = (released_at is not null))
);
create unique index inventory_reservations_order_uq on public.inventory_reservations (order_id)
  where status in ('active', 'committed');
create index inventory_reservations_expiry_idx on public.inventory_reservations (expires_at) where status = 'active';

create table public.inventory_reservation_items (
  id                 uuid primary key default app.uuid_v7(),
  store_id           uuid not null references public.stores (id) on delete cascade,
  reservation_id     uuid not null,
  level_id           uuid not null,
  quantity           integer not null check (quantity > 0),
  fulfilled_quantity integer not null default 0 check (fulfilled_quantity >= 0),
  released_quantity  integer not null default 0 check (released_quantity >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (store_id, id),
  unique (reservation_id, level_id),
  constraint inventory_reservation_items_totals check (fulfilled_quantity + released_quantity <= quantity),
  foreign key (store_id, reservation_id) references public.inventory_reservations (store_id, id) on delete cascade,
  foreign key (store_id, level_id) references public.inventory_levels (store_id, id)
);

-- -----------------------------------------------------------------------------
-- Triggers comunes
-- -----------------------------------------------------------------------------
create trigger inventory_locations_set_updated_at before update on public.inventory_locations
  for each row execute function app.set_updated_at();
create trigger inventory_levels_set_updated_at before update on public.inventory_levels
  for each row execute function app.set_updated_at();
create trigger inventory_reservations_set_updated_at before update on public.inventory_reservations
  for each row execute function app.set_updated_at();
create trigger inventory_reservation_items_set_updated_at before update on public.inventory_reservation_items
  for each row execute function app.set_updated_at();

create trigger inventory_locations_prevent_tenant_change before update on public.inventory_locations
  for each row execute function app.prevent_tenant_change();
create trigger inventory_levels_prevent_tenant_change before update on public.inventory_levels
  for each row execute function app.prevent_tenant_change();
create trigger inventory_reservations_prevent_tenant_change before update on public.inventory_reservations
  for each row execute function app.prevent_tenant_change();
create trigger inventory_reservation_items_prevent_tenant_change before update on public.inventory_reservation_items
  for each row execute function app.prevent_tenant_change();

create trigger inventory_levels_guard before update on public.inventory_levels
  for each row execute function app.inventory_levels_guard();
create trigger inventory_levels_insert_guard before insert on public.inventory_levels
  for each row execute function app.inventory_levels_insert_guard();
create trigger inventory_reservations_immutable before update on public.inventory_reservations
  for each row execute function app.prevent_column_change('order_id');
create trigger inventory_reservation_items_immutable before update on public.inventory_reservation_items
  for each row execute function app.prevent_column_change('reservation_id', 'level_id', 'quantity');

-- -----------------------------------------------------------------------------
-- Ubicación por defecto y niveles automáticos (+ backfill)
-- -----------------------------------------------------------------------------
create or replace function app.create_default_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.inventory_locations (store_id, name, is_default) values (new.id, 'Principal', true)
  on conflict do nothing;
  return null;
end
$$;
revoke all on function app.create_default_location() from public;
create trigger stores_create_default_location after insert on public.stores
  for each row execute function app.create_default_location();

create or replace function app.create_inventory_level()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.inventory_levels (store_id, variant_id, location_id)
  select new.store_id, new.id, l.id
    from public.inventory_locations l
   where l.store_id = new.store_id and l.is_default
  on conflict (variant_id, location_id) do nothing;
  return null;
end
$$;
revoke all on function app.create_inventory_level() from public;
create trigger product_variants_create_inventory_level after insert on public.product_variants
  for each row execute function app.create_inventory_level();

insert into public.inventory_locations (store_id, name, is_default)
select s.id, 'Principal', true from public.stores s
 where not exists (select 1 from public.inventory_locations l where l.store_id = s.id and l.is_default);

insert into public.inventory_levels (store_id, variant_id, location_id)
select v.store_id, v.id, l.id
  from public.product_variants v
  join public.inventory_locations l on l.store_id = v.store_id and l.is_default
on conflict (variant_id, location_id) do nothing;

-- -----------------------------------------------------------------------------
-- RLS: lectura con inventory.read; ninguna escritura directa.
-- -----------------------------------------------------------------------------
alter table public.inventory_locations enable row level security;
alter table public.inventory_locations force row level security;
alter table public.inventory_levels enable row level security;
alter table public.inventory_levels force row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_movements force row level security;
alter table public.inventory_reservations enable row level security;
alter table public.inventory_reservations force row level security;
alter table public.inventory_reservation_items enable row level security;
alter table public.inventory_reservation_items force row level security;

revoke all on table public.inventory_locations, public.inventory_levels, public.inventory_movements,
  public.inventory_reservations, public.inventory_reservation_items
  from public, anon, authenticated, service_role;
grant select on table public.inventory_locations, public.inventory_levels, public.inventory_movements,
  public.inventory_reservations, public.inventory_reservation_items to authenticated;

create policy inventory_locations_select on public.inventory_locations for select to authenticated
  using (app.has_store_permission(store_id, 'inventory.read'));
create policy inventory_levels_select on public.inventory_levels for select to authenticated
  using (app.has_store_permission(store_id, 'inventory.read'));
create policy inventory_movements_select on public.inventory_movements for select to authenticated
  using (app.has_store_permission(store_id, 'inventory.read'));
create policy inventory_reservations_select on public.inventory_reservations for select to authenticated
  using (app.has_store_permission(store_id, 'inventory.read'));
create policy inventory_reservation_items_select on public.inventory_reservation_items for select to authenticated
  using (app.has_store_permission(store_id, 'inventory.read'));
