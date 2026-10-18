-- =============================================================================
-- ADR-030: precios de oferta con fechas (aprobado por el propietario el
-- 2026-10-18).
--
-- El precio vigente sigue siendo UNO: product_variants.price. La oferta no
-- agrega un segundo precio que cada lector tenga que calcular (carrito,
-- place_order, listados, orden, filtros, JSON-LD y Mercado Pago no cambian; el
-- contrato «el precio se calcula siempre en vivo» de GATE0 §43 se conserva).
--
-- * variant_price_schedules: la oferta de una presentación, de starts_at a
--   ends_at (máximo 90 días). Al empezar guarda el precio y el «precio antes»
--   que tenía, para regresarlos al final. Ofertas encimadas de la misma
--   presentación se rechazan.
-- * catalog_schedule_sale: precio fijo o porcentaje, para uno o varios
--   productos (en bloque), con vista previa (p_apply = false). Si empieza ya,
--   se aplica en la misma transacción.
-- * catalog_cancel_sale: una programada se cancela; una activa regresa el
--   precio al momento.
-- * system.apply_price_schedules: el worker (job catalog.apply_sales, cada
--   minuto) empieza y termina las ofertas. Al terminar solo regresa el precio
--   si sigue siendo el de la oferta: un cambio a mano de la dueña nunca se pisa.
--   Una tienda suspendida no empieza ofertas, pero las activas terminan igual.
-- * storefront.get_product: sale_ends_at por presentación, para «Oferta válida
--   hasta…» (la LFPC pide informar la vigencia de las ofertas).
-- =============================================================================

create table public.variant_price_schedules (
  id                        uuid primary key default app.uuid_v7(),
  store_id                  uuid not null references public.stores (id) on delete cascade,
  product_id                uuid not null,
  variant_id                uuid not null,
  sale_price                bigint not null check (sale_price > 0),
  starts_at                 timestamptz not null,
  ends_at                   timestamptz not null,
  status                    text not null default 'scheduled'
                              check (status in ('scheduled', 'active', 'ended', 'cancelled')),
  original_price            bigint check (original_price >= 0),
  original_compare_at_price bigint check (original_compare_at_price >= 0),
  started_at                timestamptz,
  ended_at                  timestamptz,
  -- expired: terminó en su fecha y se regresó el precio · cancelled: la tienda la
  -- canceló · price_changed: el precio cambió a mano durante la oferta (no se
  -- tocó) · not_lower: al empezar, el precio ya no era mayor que el de oferta ·
  -- variant_removed: la presentación ya no existe · not_started: su periodo
  -- pasó sin que pudiera empezar (tienda sin acceso).
  end_reason                text check (end_reason in ('expired', 'cancelled', 'price_changed', 'not_lower',
                                                       'variant_removed', 'not_started')),
  created_by                uuid references auth.users (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (store_id, id),
  check (ends_at > starts_at and ends_at <= starts_at + interval '90 days'),
  check ((status in ('ended', 'cancelled')) = (end_reason is not null and ended_at is not null)),
  check (status <> 'active' or (original_price is not null and started_at is not null)),
  foreign key (store_id, product_id) references public.products (store_id, id) on delete cascade,
  foreign key (store_id, variant_id) references public.product_variants (store_id, id) on delete cascade
);
-- Una sola oferta activa por presentación (además del rechazo de encimadas).
create unique index variant_price_schedules_active_uq on public.variant_price_schedules (variant_id)
  where status = 'active';
create index variant_price_schedules_open_idx on public.variant_price_schedules (variant_id, starts_at)
  where status in ('scheduled', 'active');
create index variant_price_schedules_due_start_idx on public.variant_price_schedules (starts_at)
  where status = 'scheduled';
create index variant_price_schedules_due_end_idx on public.variant_price_schedules (ends_at)
  where status = 'active';
create index variant_price_schedules_product_idx on public.variant_price_schedules (store_id, product_id, created_at desc);

create trigger variant_price_schedules_set_updated_at before update on public.variant_price_schedules
  for each row execute function app.set_updated_at();
create trigger variant_price_schedules_prevent_tenant_change before update on public.variant_price_schedules
  for each row execute function app.prevent_tenant_change();
create trigger variant_price_schedules_immutable before update on public.variant_price_schedules
  for each row execute function app.prevent_column_change('product_id', 'variant_id', 'sale_price', 'starts_at',
                                                          'ends_at', 'created_by', 'created_at');

-- Estados: scheduled → active | ended | cancelled; active → ended | cancelled.
create or replace function app.variant_price_schedules_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and not ((old.status = 'scheduled' and new.status in ('active', 'ended', 'cancelled'))
              or (old.status = 'active' and new.status in ('ended', 'cancelled'))) then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'sale_status';
  end if;
  return new;
end
$$;
revoke all on function app.variant_price_schedules_transition() from public;
create trigger variant_price_schedules_transition before update on public.variant_price_schedules
  for each row execute function app.variant_price_schedules_transition();

alter table public.variant_price_schedules enable row level security;
alter table public.variant_price_schedules force row level security;
revoke all on table public.variant_price_schedules from public, anon, authenticated, service_role;
grant select on public.variant_price_schedules to authenticated;
create policy variant_price_schedules_select on public.variant_price_schedules for select to authenticated
  using (app.has_store_permission(store_id, 'products.read'));

-- -----------------------------------------------------------------------------
-- Fecha y hora local («YYYY-MM-DDTHH:MM») en la zona de la tienda.
-- -----------------------------------------------------------------------------
create or replace function app.parse_store_local(p_store_id uuid, p_local text, p_field text)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := (select s.timezone from public.stores s where s.id = p_store_id);
begin
  if p_local is null or p_local !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = p_field;
  end if;
  begin
    return p_local::timestamp at time zone v_tz;
  exception when others then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = p_field;
  end;
end
$$;
revoke all on function app.parse_store_local(uuid, text, text) from public;

-- -----------------------------------------------------------------------------
-- Empezar una oferta (el producto ya está bloqueado por quien llama).
-- Devuelve 'started', 'waiting' (otra oferta de la presentación sigue activa) o
-- el motivo con que se cerró sin empezar.
-- -----------------------------------------------------------------------------
create or replace function app.sale_start(p_sale_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.variant_price_schedules;
  v_var  public.product_variants;
  v_org  uuid;
begin
  select * into v_sale from public.variant_price_schedules s where s.id = p_sale_id for update;
  if v_sale.status <> 'scheduled' then
    return v_sale.status;
  end if;
  if exists (select 1 from public.variant_price_schedules s
              where s.variant_id = v_sale.variant_id and s.status = 'active' and s.id <> v_sale.id) then
    return 'waiting';
  end if;
  select * into v_var from public.product_variants v where v.id = v_sale.variant_id for update;
  if v_var.id is null or v_var.deleted_at is not null or v_var.status <> 'active' or v_sale.sale_price >= v_var.price then
    update public.variant_price_schedules
       set status = 'ended', ended_at = now(),
           end_reason = case when v_var.id is null or v_var.deleted_at is not null or v_var.status <> 'active'
                             then 'variant_removed' else 'not_lower' end
     where id = v_sale.id
     returning end_reason into v_sale.end_reason;
    v_org := (select s.organization_id from public.stores s where s.id = v_sale.store_id);
    perform audit.record('product.sale_ended', 'product', v_sale.product_id, v_org, v_sale.store_id, null,
                         jsonb_build_object('variant_id', v_sale.variant_id, 'reason', v_sale.end_reason),
                         null, jsonb_build_object('scheduled', true, 'sale_id', v_sale.id));
    return v_sale.end_reason;
  end if;
  -- «Precio antes» = el precio que tenía justo antes de la oferta (honesto).
  update public.product_variants set price = v_sale.sale_price, compare_at_price = v_var.price where id = v_var.id;
  update public.variant_price_schedules
     set status = 'active', started_at = now(), original_price = v_var.price,
         original_compare_at_price = v_var.compare_at_price
   where id = v_sale.id;
  v_org := (select s.organization_id from public.stores s where s.id = v_sale.store_id);
  perform audit.record('product.prices_updated', 'product', v_sale.product_id, v_org, v_sale.store_id,
                       jsonb_build_object('variants', jsonb_build_array(jsonb_build_object(
                         'id', v_var.id, 'price', v_var.price, 'compare_at_price', v_var.compare_at_price))),
                       jsonb_build_object('variants', jsonb_build_array(jsonb_build_object(
                         'id', v_var.id, 'price', v_sale.sale_price, 'compare_at_price', v_var.price))),
                       null, jsonb_build_object('scheduled', true, 'sale', 'start', 'sale_id', v_sale.id));
  return 'started';
end
$$;
revoke all on function app.sale_start(uuid) from public;

-- -----------------------------------------------------------------------------
-- Terminar una oferta activa (el producto ya está bloqueado por quien llama).
-- Solo regresa el precio si sigue siendo el de la oferta.
-- -----------------------------------------------------------------------------
create or replace function app.sale_end(p_sale_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale   public.variant_price_schedules;
  v_var    public.product_variants;
  v_org    uuid;
  v_reason text;
begin
  select * into v_sale from public.variant_price_schedules s where s.id = p_sale_id for update;
  if v_sale.status <> 'active' then
    return v_sale.status;
  end if;
  v_org := (select s.organization_id from public.stores s where s.id = v_sale.store_id);
  select * into v_var from public.product_variants v where v.id = v_sale.variant_id for update;
  if v_var.id is null or v_var.deleted_at is not null then
    v_reason := 'variant_removed';
  elsif v_var.price is distinct from v_sale.sale_price then
    v_reason := 'price_changed';
  else
    v_reason := p_reason;
    update public.product_variants
       set price = v_sale.original_price, compare_at_price = v_sale.original_compare_at_price
     where id = v_var.id;
    perform audit.record('product.prices_updated', 'product', v_sale.product_id, v_org, v_sale.store_id,
                         jsonb_build_object('variants', jsonb_build_array(jsonb_build_object(
                           'id', v_var.id, 'price', v_var.price, 'compare_at_price', v_var.compare_at_price))),
                         jsonb_build_object('variants', jsonb_build_array(jsonb_build_object(
                           'id', v_var.id, 'price', v_sale.original_price,
                           'compare_at_price', v_sale.original_compare_at_price))),
                         null, jsonb_build_object('scheduled', true, 'sale', 'end', 'sale_id', v_sale.id));
  end if;
  update public.variant_price_schedules
     set status = case when p_reason = 'cancelled' then 'cancelled' else 'ended' end,
         end_reason = v_reason, ended_at = now()
   where id = v_sale.id;
  if v_reason <> p_reason then
    -- No se regresó el precio: queda en el historial por qué.
    perform audit.record('product.sale_ended', 'product', v_sale.product_id, v_org, v_sale.store_id, null,
                         jsonb_build_object('variant_id', v_sale.variant_id, 'reason', v_reason),
                         null, jsonb_build_object('scheduled', true, 'sale_id', v_sale.id));
  end if;
  return v_reason;
end
$$;
revoke all on function app.sale_end(uuid, text) from public;

-- -----------------------------------------------------------------------------
-- Programar (o previsualizar) una oferta.
--   p_variant_ids: null = todas las presentaciones activas de los productos.
--   Precio fijo (p_sale_price) o porcentaje de descuento (p_percent, 1–90, con
--   redondeo al centavo o al peso), uno de los dos.
--   p_starts_local null = ahora.
-- -----------------------------------------------------------------------------
create or replace function public.catalog_schedule_sale(
  p_store_id     uuid,
  p_product_ids  uuid[],
  p_variant_ids  uuid[],
  p_sale_price   bigint,
  p_percent      numeric,
  p_rounding     text,
  p_starts_local text,
  p_ends_local   text,
  p_apply        boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids     uuid[];
  v_start   timestamptz;
  v_end     timestamptz;
  v_rows    jsonb;
  v_bad     record;
  v_org     uuid := (select s.organization_id from public.stores s where s.id = p_store_id);
  v_r       record;
  v_sale_id uuid;
  v_started integer := 0;
  v_count   integer := 0;
begin
  perform app.require_store_permission(p_store_id, 'products.update');
  if (p_sale_price is null) = (p_percent is null) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'sale_price';
  end if;
  if p_sale_price is not null and p_sale_price <= 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'sale_price';
  end if;
  if p_percent is not null and (p_percent < 1 or p_percent > 90 or scale(p_percent) > 2) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'percent';
  end if;
  if p_percent is not null and (p_rounding is null or p_rounding not in ('centavo', 'peso')) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rounding';
  end if;

  -- Fechas en la zona de la tienda. Sin inicio, o con uno de hace unos minutos
  -- (lo escrito en la vista previa antes de confirmar), empieza ya; uno más
  -- viejo se rechaza.
  if p_starts_local is null then
    v_start := now();
  else
    v_start := app.parse_store_local(p_store_id, p_starts_local, 'starts_at');
    if v_start < now() - interval '15 minutes' or v_start > now() + interval '1 year' then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'starts_at';
    end if;
    v_start := greatest(v_start, now());
  end if;
  v_end := app.parse_store_local(p_store_id, p_ends_local, 'ends_at');
  if v_end <= v_start + interval '1 minute' or v_end > v_start + interval '90 days' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'ends_at';
  end if;

  -- La vista previa no bloquea ni escribe; aplicar bloquea los productos (en
  -- orden estable, igual que las ediciones en bloque).
  if coalesce(p_apply, false) then
    v_ids := app.bulk_products(p_store_id, p_product_ids);
  else
    if p_product_ids is null or cardinality(p_product_ids) not between 1 and 100 then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'products';
    end if;
    select array_agg(p.id) into v_ids from public.products p
     where p.store_id = p_store_id and p.id = any (p_product_ids) and p.deleted_at is null;
    if coalesce(cardinality(v_ids), 0) <> (select count(distinct x) from unnest(p_product_ids) x) then
      raise exception using errcode = 'P0001', message = 'not_found', detail = 'product';
    end if;
  end if;
  if p_variant_ids is not null and (
       cardinality(p_variant_ids) not between 1 and 100
       or (select count(*) from public.product_variants v
            where v.store_id = p_store_id and v.product_id = any (v_ids) and v.id = any (p_variant_ids)
              and v.deleted_at is null and v.status = 'active')
          <> (select count(distinct x) from unnest(p_variant_ids) x)) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'variant';
  end if;

  -- El descuento se calcula sobre el precio REGULAR: si la presentación tiene
  -- una oferta activa (la nueva empieza cuando esa termine), sobre el precio que
  -- regresará al terminar, no sobre el rebajado.
  with base as (
    select v.id, v.product_id, p.title, v.option_signature, v.sku, v.position,
           coalesce((select s.original_price from public.variant_price_schedules s
                      where s.variant_id = v.id and s.status = 'active' and s.sale_price = v.price),
                    v.price) as price
      from public.product_variants v
      join public.products p on p.id = v.product_id
     where v.store_id = p_store_id and v.product_id = any (v_ids)
       and v.deleted_at is null and v.status = 'active'
       and (p_variant_ids is null or v.id = any (p_variant_ids))
  ), calc as (
    select b.*,
           case when p_sale_price is not null then p_sale_price
                when p_rounding = 'peso' then round(b.price * (1 - p_percent / 100) / 100.0)::bigint * 100
                else round(b.price * (1 - p_percent / 100))::bigint end as sale_price
      from base b
  )
  select jsonb_agg(jsonb_build_object(
           'product_id', c.product_id, 'title', c.title, 'variant_id', c.id, 'signature', c.option_signature,
           'sku', c.sku, 'price', c.price, 'sale_price', c.sale_price,
           'issue', case when c.sale_price <= 0 or c.sale_price >= c.price then 'not_lower'
                         when exists (select 1 from public.variant_price_schedules s
                                       where s.variant_id = c.id and s.status in ('scheduled', 'active')
                                         and tstzrange(s.starts_at, s.ends_at) && tstzrange(v_start, v_end))
                         then 'overlap' end)
         order by c.title, c.product_id, c.position, c.option_signature)
    into v_rows from calc c;
  if v_rows is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'variants';
  end if;

  if not coalesce(p_apply, false) then
    return jsonb_build_object('starts_at', v_start, 'ends_at', v_end, 'rows', v_rows);
  end if;

  select r ->> 'issue' as issue, r ->> 'title' as title into v_bad
    from jsonb_array_elements(v_rows) r where r ->> 'issue' is not null limit 1;
  if v_bad.issue is not null then
    raise exception using errcode = 'P0001', message = 'validation_failed',
                          detail = case when v_bad.issue = 'overlap' then 'overlap' else 'sale_price' end,
                          table = left(v_bad.title, 200);
  end if;

  for v_r in
    select (r ->> 'product_id')::uuid as product_id, (r ->> 'variant_id')::uuid as variant_id,
           (r ->> 'sale_price')::bigint as sale_price
      from jsonb_array_elements(v_rows) r
  loop
    insert into public.variant_price_schedules (store_id, product_id, variant_id, sale_price, starts_at, ends_at, created_by)
    values (p_store_id, v_r.product_id, v_r.variant_id, v_r.sale_price, v_start, v_end, auth.uid())
    returning id into v_sale_id;
    v_count := v_count + 1;
    if v_start <= now() and app.sale_start(v_sale_id) = 'started' then
      v_started := v_started + 1;
    end if;
  end loop;

  for v_r in
    select (r ->> 'product_id')::uuid as product_id,
           jsonb_agg(jsonb_build_object('id', r -> 'variant_id', 'sale_price', r -> 'sale_price')) as variants
      from jsonb_array_elements(v_rows) r
     group by 1
  loop
    perform audit.record('product.sale_scheduled', 'product', v_r.product_id, v_org, p_store_id, null,
                         jsonb_build_object('variants', v_r.variants, 'starts_at', v_start, 'ends_at', v_end),
                         null, jsonb_build_object('bulk', cardinality(v_ids) > 1));
  end loop;

  -- Validaciones diferidas de las variantes dentro de la función (con los
  -- privilegios del definer) y un producto publicado sigue siendo publicable.
  set constraints all immediate;
  set constraints all deferred;
  perform app.bulk_check_publishable(v_ids);
  return jsonb_build_object('scheduled', v_count, 'started', v_started, 'starts_at', v_start, 'ends_at', v_end);
end
$$;

create or replace function public.catalog_cancel_sale(p_store_id uuid, p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale   public.variant_price_schedules;
  v_result text;
begin
  perform app.require_store_permission(p_store_id, 'products.update');
  select * into v_sale from public.variant_price_schedules s where s.store_id = p_store_id and s.id = p_sale_id;
  if v_sale.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'sale';
  end if;
  -- Mismo orden de bloqueo que el worker y las ediciones: producto y luego oferta.
  perform app.lock_product(p_store_id, v_sale.product_id, true);
  select * into v_sale from public.variant_price_schedules s where s.id = p_sale_id for update;
  if v_sale.status = 'scheduled' then
    update public.variant_price_schedules
       set status = 'cancelled', end_reason = 'cancelled', ended_at = now()
     where id = v_sale.id;
    v_result := 'cancelled';
  elsif v_sale.status = 'active' then
    v_result := app.sale_end(v_sale.id, 'cancelled');
    set constraints all immediate;
    set constraints all deferred;
  else
    return jsonb_build_object('status', v_sale.status);  -- ya terminó: nada que hacer
  end if;
  perform audit.record('product.sale_cancelled', 'product', v_sale.product_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('status', v_sale.status),
                       jsonb_build_object('variant_id', v_sale.variant_id, 'sale_price', v_sale.sale_price,
                                          'reason', v_result));
  return jsonb_build_object('status', 'cancelled', 'reason', v_result);
end
$$;

-- Ofertas de un producto (o de toda la tienda): primero las programadas y
-- activas; con p_include_past, también las terminadas más recientes.
create or replace function public.catalog_list_sales(p_store_id uuid, p_product_id uuid, p_include_past boolean,
                                                     p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  perform app.require_store_permission(p_store_id, 'products.read');
  return coalesce((
    select jsonb_agg(to_jsonb(x) - 'rn' order by x.rn)
      from (select s.id, s.product_id, p.title, s.variant_id, v.option_signature as signature, v.sku,
                   v.price as current_price, s.sale_price, s.original_price, s.starts_at, s.ends_at,
                   s.status, s.end_reason,
                   row_number() over (order by case when s.status in ('scheduled', 'active') then 0 else 1 end,
                                               case when s.status in ('scheduled', 'active') then s.starts_at end,
                                               coalesce(s.ended_at, s.ends_at) desc, s.id) as rn
              from public.variant_price_schedules s
              join public.products p on p.id = s.product_id
              join public.product_variants v on v.id = s.variant_id
             where s.store_id = p_store_id
               and (p_product_id is null or s.product_id = p_product_id)
               and (coalesce(p_include_past, false) or s.status in ('scheduled', 'active'))
             order by rn
             limit v_limit) x), '[]'::jsonb);
end
$$;

revoke all on function public.catalog_schedule_sale(uuid, uuid[], uuid[], bigint, numeric, text, text, text, boolean) from public;
revoke all on function public.catalog_cancel_sale(uuid, uuid) from public;
revoke all on function public.catalog_list_sales(uuid, uuid, boolean, integer) from public;
grant execute on function public.catalog_schedule_sale(uuid, uuid[], uuid[], bigint, numeric, text, text, text, boolean) to authenticated;
grant execute on function public.catalog_cancel_sale(uuid, uuid) to authenticated;
grant execute on function public.catalog_list_sales(uuid, uuid, boolean, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- Worker: termina las vencidas y empieza las que tocan. Un solo recorrido en
-- orden de producto (mismo orden de bloqueo que las ediciones en bloque) y,
-- dentro de cada producto, primero las que terminan: una oferta que acaba a
-- la hora en que empieza la siguiente le deja el lugar.
-- -----------------------------------------------------------------------------
create or replace function system.apply_price_schedules(p_limit integer default 200)
returns table (store_id uuid, sale_id uuid, result text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c    record;
  v_sale public.variant_price_schedules;
  v_ok   boolean;
begin
  for v_c in
    select c.id, c.store_id, c.product_id
      from (select s.id, s.store_id, s.product_id, 0 as step, s.ends_at as at
              from public.variant_price_schedules s
             where s.status = 'active' and s.ends_at <= now()
            union all
            select s.id, s.store_id, s.product_id, 1, s.ends_at
              from public.variant_price_schedules s
             where s.status = 'scheduled' and s.ends_at <= now()
            union all
            -- Una tienda cerrada o sin acceso completo no empieza ofertas (y sus
            -- programadas no ocupan el lote de cada minuto).
            select s.id, s.store_id, s.product_id, 2, s.starts_at
              from public.variant_price_schedules s
              join public.stores st on st.id = s.store_id
             where s.status = 'scheduled' and s.starts_at <= now() and s.ends_at > now()
               and st.status not in ('suspended', 'closed') and app.org_access_mode(st.organization_id) = 'full') c
     order by c.product_id, c.step, c.at, c.id
     limit least(greatest(coalesce(p_limit, 200), 1), 1000)
  loop
    perform app.lock_product(v_c.store_id, v_c.product_id, true);
    select * into v_sale from public.variant_price_schedules s where s.id = v_c.id for update;
    store_id := v_c.store_id; sale_id := v_c.id; result := null;
    if v_sale.status = 'active' and v_sale.ends_at <= now() then
      -- Termina aunque la tienda esté suspendida: un precio rebajado nunca se queda.
      result := app.sale_end(v_sale.id, 'expired');
    elsif v_sale.status = 'scheduled' and v_sale.ends_at <= now() then
      update public.variant_price_schedules
         set status = 'ended', end_reason = 'not_started', ended_at = now()
       where id = v_sale.id;
      result := 'not_started';
    elsif v_sale.status = 'scheduled' and v_sale.starts_at <= now() then
      select s.status not in ('suspended', 'closed') and app.org_access_mode(s.organization_id) = 'full'
        into v_ok from public.stores s where s.id = v_sale.store_id;
      if v_ok then
        result := app.sale_start(v_sale.id);
      end if;
    end if;
    if result is not null and result <> 'waiting' then
      return next;
    end if;
  end loop;
  set constraints all immediate;
  set constraints all deferred;
end
$$;
revoke all on function system.apply_price_schedules(integer) from public;
grant execute on function system.apply_price_schedules(integer) to system_worker;

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
  perform system.fail_stuck_imports();
end
$$;

-- Igual que en 20261018001800, más sale_ends_at por presentación.
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
                    -- ADR-030: vigencia de la oferta en curso (solo si el precio es el de la oferta).
                    'sale_ends_at', (select s.ends_at from public.variant_price_schedules s
                                      where s.variant_id = v.id and s.status = 'active'
                                        and s.sale_price = v.price and v.compare_at_price is not null),
                    'net_content', v.net_content, 'servings_per_container', v.servings_per_container,
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

-- Igual que en 20261018002600, salvo el precio de las presentaciones en oferta.
create or replace function public.catalog_duplicate_product(p_store_id uuid, p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src   public.products;
  v_new   uuid;
  v_slug  text;
  v_n     integer := 1;
  v_map   jsonb := '{}'::jsonb;
  v_row   record;
  v_id    uuid;
  v_vmap  jsonb := '{}'::jsonb;  -- variante de origen → copia
  v_mmap  jsonb := '{}'::jsonb;  -- foto de origen → copia
  v_bytes bigint;
  v_ext   text;
begin
  perform app.require_store_permission(p_store_id, 'products.create');
  v_src := app.lock_product(p_store_id, p_product_id);
  v_slug := left(v_src.slug, 110) || '-copia';
  while exists (select 1 from public.products p where p.store_id = p_store_id and p.slug = v_slug
                  and p.deleted_at is null) loop
    v_n := v_n + 1;
    v_slug := left(v_src.slug, 110) || '-copia-' || v_n;
  end loop;

  insert into public.products (store_id, brand_id, title, slug, description_html, tags, specs, seo_title, seo_description)
  values (p_store_id, v_src.brand_id, left(v_src.title || ' (copia)', 200), v_slug, v_src.description_html,
          v_src.tags, v_src.specs, v_src.seo_title, v_src.seo_description)
  returning id into v_new;

  for v_row in select * from public.product_options where product_id = p_product_id loop
    insert into public.product_options (store_id, product_id, name, position)
    values (p_store_id, v_new, v_row.name, v_row.position) returning id into v_id;
    insert into public.product_option_values (store_id, option_id, value, position)
    select p_store_id, v_id, ov.value, ov.position from public.product_option_values ov where ov.option_id = v_row.id;
  end loop;

  for v_row in select * from public.product_variants where product_id = p_product_id and deleted_at is null loop
    insert into public.product_variants
      (store_id, product_id, price, compare_at_price, weight_g, length_mm, width_mm, height_mm, status,
       track_inventory, inventory_policy, requires_shipping, position, option_signature,
       net_content, servings_per_container)
    -- ADR-030: con una oferta activa, la copia lleva el precio regular (ninguna
    -- oferta de la copia lo regresaría).
    values (p_store_id, v_new,
            coalesce((select s.original_price from public.variant_price_schedules s
                       where s.variant_id = v_row.id and s.status = 'active' and s.sale_price = v_row.price),
                     v_row.price),
            case when exists (select 1 from public.variant_price_schedules s
                               where s.variant_id = v_row.id and s.status = 'active' and s.sale_price = v_row.price)
                 then (select s.original_compare_at_price from public.variant_price_schedules s
                        where s.variant_id = v_row.id and s.status = 'active')
                 else v_row.compare_at_price end,
            v_row.weight_g, v_row.length_mm, v_row.width_mm,
            v_row.height_mm, v_row.status, v_row.track_inventory, v_row.inventory_policy, v_row.requires_shipping,
            v_row.position, v_row.option_signature, v_row.net_content, v_row.servings_per_container)
    returning id into v_id;
    v_vmap := v_vmap || jsonb_build_object(v_row.id::text, v_id);
    insert into public.variant_option_values (variant_id, option_value_id, option_id, store_id)
    select v_id, nov.id, no.id, p_store_id
      from public.variant_option_values vov
      join public.product_options so on so.id = vov.option_id
      join public.product_option_values sov on sov.id = vov.option_value_id
      join public.product_options no on no.product_id = v_new and no.name = so.name
      join public.product_option_values nov on nov.option_id = no.id and nov.value = sov.value
     where vov.variant_id = v_row.id;
    if app.has_store_permission(p_store_id, 'products.cost.read') then
      insert into public.variant_costs (variant_id, store_id, cost)
      select v_id, p_store_id, c.cost from public.variant_costs c where c.variant_id = v_row.id;
    end if;
  end loop;

  insert into public.product_categories (store_id, product_id, category_id, is_primary, position)
  select p_store_id, v_new, pc.category_id, pc.is_primary, pc.position
    from public.product_categories pc where pc.product_id = p_product_id;

  -- Ficha sanitaria y atributos (la copia nace en borrador: se vuelve a revisar al publicar).
  insert into public.product_regulatory_info (store_id, product_id, category_key, schema_version, data, updated_by)
  select p_store_id, v_new, i.category_key, i.schema_version, i.data, auth.uid()
    from public.product_regulatory_info i where i.store_id = p_store_id and i.product_id = p_product_id;
  insert into public.product_attribute_values (store_id, product_id, value_id)
  select p_store_id, v_new, a.value_id
    from public.product_attribute_values a where a.store_id = p_store_id and a.product_id = p_product_id;

  -- Fotos: cada una es un archivo propio (la ruta es única y la purga borra por
  -- ruta), así que se crean medios nuevos pendientes y el worker copia y vuelve a
  -- procesar el archivo (media.copy). Máximo 20, con el mismo límite de espacio.
  select coalesce(sum(m.bytes), 0) into v_bytes
    from (select m.bytes from public.media m
           where m.store_id = p_store_id and m.product_id = p_product_id and m.status = 'ready'
             and m.deleted_at is null order by m.position, m.id limit 20) m;
  if v_bytes > 0 then
    -- El mismo tope que las subidas: 50 fotos pendientes por tienda.
    perform pg_advisory_xact_lock(hashtextextended('media_pending:' || p_store_id::text, 0));
    if (select count(*) from public.media m
         where m.store_id = p_store_id and m.status = 'pending' and m.deleted_at is null
           and m.created_at > now() - interval '24 hours')
       + (select count(*) from (select 1 from public.media m
                                  where m.store_id = p_store_id and m.product_id = p_product_id
                                    and m.status = 'ready' and m.deleted_at is null limit 20) x) > 50 then
      raise exception using errcode = 'P0001', message = 'limit_reached',
        detail = json_build_object('key', 'pending_uploads', 'limit', 50)::text;
    end if;
    perform app.assert_within_limit((select s.organization_id from public.stores s where s.id = p_store_id),
                                    'storage_mb', ceil(v_bytes / 1048576.0)::integer);
  end if;
  for v_row in
    select m.* from public.media m
     where m.store_id = p_store_id and m.product_id = p_product_id and m.status = 'ready' and m.deleted_at is null
     order by m.position, m.id limit 20
  loop
    v_id := app.uuid_v7();
    v_ext := case v_row.mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
                                  when 'image/webp' then 'webp' when 'image/avif' then 'avif' end;
    insert into public.media (id, store_id, owner_type, product_id, status, storage_path, mime_type, bytes,
                              alt_text, position, created_by)
    values (v_id, p_store_id, 'product', v_new, 'pending',
            format('%s/product/%s/%s/original.%s', p_store_id, v_new, v_id, v_ext),
            v_row.mime_type, v_row.bytes, v_row.alt_text, v_row.position, auth.uid());
    v_mmap := v_mmap || jsonb_build_object(v_row.id::text, v_id);
    perform app.enqueue_job('media.copy', jsonb_build_object('media_id', v_id, 'source_media_id', v_row.id),
                            p_store_id, 'media.copy:' || v_id::text, now(), 5);
  end loop;
  -- La foto de cada presentación apunta a su copia.
  update public.product_variants nv
     set image_id = (v_mmap ->> sv.image_id::text)::uuid
    from public.product_variants sv
   where sv.product_id = p_product_id and sv.image_id is not null and v_mmap ? sv.image_id::text
     and nv.id = (v_vmap ->> sv.id::text)::uuid;
  -- Validaciones diferidas de las variantes aquí, con los privilegios del definer.
  set constraints all immediate;
  set constraints all deferred;

  perform audit.record('product.duplicated', 'product', v_new,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('source', p_product_id, 'photos', (select count(*) from jsonb_object_keys(v_mmap))));
  return jsonb_build_object('id', v_new, 'slug', v_slug, 'photos', (select count(*) from jsonb_object_keys(v_mmap)));
end
$$;
