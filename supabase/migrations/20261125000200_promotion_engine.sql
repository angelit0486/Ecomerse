-- =============================================================================
-- Motor de promociones y su uso en el carrito y en place_order (ADR-070).
--
-- * app.promotion_eval / app.promotion_apply: aritmética pura (IMMUTABLE), sin
--   tablas, como app.cart_totals. Reglas (decisiones del propietario, 2026-11-25):
--     - una sola promoción por pieza; entre varias, gana la que más ahorra al
--       comprador (empate: la de alcance más específico, luego la más antigua);
--       se eligen de una en una sobre las piezas que quedan libres;
--     - las presentaciones de un producto cuentan juntas (mayoreo) y las piezas
--       elegibles de una promoción se agrupan (3×2, N-ésima): el descuento cae
--       en las piezas más baratas; las sobrantes más caras quedan libres;
--     - por omisión no aplica a piezas que ya tienen precio de oferta
--       (compare_at_price > price) salvo `applies_to_sale_items`.
-- * app.cart_promotions: promociones activas y vigentes de la tienda, con el
--   alcance resuelto a los productos del carrito (categorías incluyen sus
--   subcategorías).
-- * app.cart_totals: mismo contrato; acepta `promotion_allocation` por línea y
--   `discount.combines_with_promotions`. Sin promociones el resultado es idéntico
--   al anterior (casos dorados). El cupón que no se combina solo descuenta
--   líneas sin promoción; envío gratis siempre se combina.
-- * app.calculate_cart y storefront.place_order: igual que en 20261013000600 y
--   20261117000600 respectivamente, más promociones; el pedido guarda
--   promotion_total, promotion_allocation por partida y order_promotions (copia
--   de la regla). Firmas, permisos, transacción e idempotencia sin cambios
--   (GATE0 §43): el navegador sigue sin aportar precios ni descuentos.
--
-- Reversa: scripts/ops/reversa/20261125000200_promotion_engine.reversa.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Evaluar UNA promoción sobre las piezas libres.
--    Devuelve {amount, lines: [{i, used, units, amount}]} (i = posición 1..n).
--    `used` son piezas que la promoción toma (ya no sirven para otra); `units`,
--    las que llevan descuento.
-- -----------------------------------------------------------------------------
create or replace function app.promotion_eval(p_promo jsonb, p_price bigint[], p_left integer[], p_prod text[],
                                              p_sale boolean[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_type    text := p_promo ->> 'type';
  v_rules   jsonb := p_promo -> 'rules';
  v_ids     jsonb := nullif(p_promo -> 'product_ids', 'null'::jsonb);
  v_sale_ok boolean := coalesce((p_promo ->> 'applies_to_sale_items')::boolean, false);
  v_elig    integer[] := array[]::integer[];
  v_lines   jsonb := '[]'::jsonb;
  v_amount  bigint := 0;
  v_i       integer;
  v_p       text;
  v_q       integer;
  v_tier    jsonb;
  v_disc    bigint;
  v_n       integer;
  v_units   integer;
  v_groups  integer;
  v_consume integer;
  v_free    integer;
  v_take    integer;
  v_d       integer;
  v_per     bigint;
begin
  for v_i in 1 .. coalesce(array_length(p_price, 1), 0) loop
    if p_left[v_i] > 0 and p_price[v_i] > 0 and (v_sale_ok or not p_sale[v_i])
       and (v_ids is null or v_ids ? p_prod[v_i]) then
      v_elig := v_elig || v_i;
    end if;
  end loop;
  if cardinality(v_elig) = 0 then
    return jsonb_build_object('amount', 0, 'lines', '[]'::jsonb);
  end if;

  if v_type = 'volume' then
    -- Mayoreo: el escalón se decide con las piezas libres del PRODUCTO; todas
    -- sus piezas toman ese precio (precio por volumen, no por tramos).
    for v_p in select distinct p_prod[i] from unnest(v_elig) i loop
      select coalesce(sum(p_left[i]), 0) into v_q from unnest(v_elig) i where p_prod[i] = v_p;
      v_tier := (select t from jsonb_array_elements(v_rules -> 'tiers') t
                  where (t ->> 'min_qty')::integer <= v_q order by (t ->> 'min_qty')::integer desc limit 1);
      continue when v_tier is null;
      for v_i in select i from unnest(v_elig) i where p_prod[i] = v_p order by i loop
        v_disc := case v_rules ->> 'mode'
                    when 'unit_price' then greatest(p_price[v_i] - (v_tier ->> 'value')::bigint, 0) * p_left[v_i]
                    else app.div_half_even((p_price[v_i] * p_left[v_i])::numeric * (v_tier ->> 'value')::bigint, 10000)
                  end;
        if v_disc > 0 then
          v_lines := v_lines || jsonb_build_array(jsonb_build_object(
                       'i', v_i, 'used', p_left[v_i], 'units', p_left[v_i], 'amount', v_disc));
          v_amount := v_amount + v_disc;
        end if;
      end loop;
    end loop;
  elsif v_type in ('buy_n_pay_m', 'nth_percent') then
    -- Grupos de N piezas elegibles; en cada grupo se descuentan las más baratas.
    v_n := case v_type when 'buy_n_pay_m' then (v_rules ->> 'buy')::integer else (v_rules ->> 'nth')::integer end;
    select coalesce(sum(p_left[i]), 0) into v_units from unnest(v_elig) i;
    v_groups := v_units / v_n;
    if v_groups > 0 then
      v_consume := v_groups * v_n;
      v_free := case v_type when 'buy_n_pay_m' then v_groups * (v_n - (v_rules ->> 'pay')::integer)
                            else v_groups end;
      for v_i in select i from unnest(v_elig) i order by p_price[i], i loop
        exit when v_consume = 0;
        v_take := least(p_left[v_i], v_consume);
        v_d := least(v_take, v_free);
        v_per := case v_type when 'buy_n_pay_m' then p_price[v_i]
                             else app.div_half_even(p_price[v_i]::numeric * (v_rules ->> 'percent_bps')::integer, 10000)
                 end;
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
                     'i', v_i, 'used', v_take, 'units', v_d, 'amount', v_d * v_per));
        v_amount := v_amount + v_d * v_per;
        v_consume := v_consume - v_take;
        v_free := v_free - v_d;
      end loop;
    end if;
  end if;
  return jsonb_build_object('amount', v_amount, 'lines', v_lines);
end
$$;
revoke all on function app.promotion_eval(jsonb, bigint[], integer[], text[], boolean[]) from public;

-- -----------------------------------------------------------------------------
-- 2. Aplicar las promociones a un carrito (puro).
--    p_lines:      [{product_id, unit_price, quantity, on_sale}]
--    p_promotions: [{id, label, type, rules, product_ids|null, specificity,
--                    applies_to_sale_items}] en orden de antigüedad.
--    Salida: {lines: [{promotion_allocation, promotions: [{promotion_id, units,
--             amount}]}], promotion_total, applied: [{promotion_id, label, type,
--             rules, units, amount}]}
-- -----------------------------------------------------------------------------
create or replace function app.promotion_apply(p_lines jsonb, p_promotions jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_n       integer := 0;
  v_price   bigint[] := array[]::bigint[];
  v_left    integer[] := array[]::integer[];
  v_prod    text[] := array[]::text[];
  v_sale    boolean[] := array[]::boolean[];
  v_alloc   bigint[];
  v_qty     integer[];
  v_lp      jsonb[];
  v_done    text[] := array[]::text[];
  v_applied jsonb := '[]'::jsonb;
  v_out     jsonb := '[]'::jsonb;
  v_total   bigint := 0;
  v_line    jsonb;
  v_promo   jsonb;
  v_eval    jsonb;
  v_best    jsonb;
  v_bestp   jsonb;
  v_e       jsonb;
  v_i       integer;
  v_units   integer;
begin
  for v_line in select l from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l loop
    if (v_line ->> 'unit_price')::bigint < 0 or (v_line ->> 'quantity')::integer < 1 then
      raise exception using errcode = '22023', message = 'línea inválida';
    end if;
    v_n := v_n + 1;
    v_price := v_price || (v_line ->> 'unit_price')::bigint;
    v_left := v_left || (v_line ->> 'quantity')::integer;
    v_prod := v_prod || (v_line ->> 'product_id');
    v_sale := v_sale || coalesce((v_line ->> 'on_sale')::boolean, false);
  end loop;
  if v_n = 0 then
    return jsonb_build_object('lines', '[]'::jsonb, 'promotion_total', 0, 'applied', '[]'::jsonb);
  end if;
  v_alloc := array_fill(0::bigint, array[v_n]);
  v_qty := v_left;
  v_lp := array_fill('[]'::jsonb, array[v_n]);

  loop
    v_best := null;
    v_bestp := null;
    for v_promo in select p from jsonb_array_elements(coalesce(p_promotions, '[]'::jsonb)) p loop
      continue when (v_promo ->> 'id') = any (v_done);
      v_eval := app.promotion_eval(v_promo, v_price, v_left, v_prod, v_sale);
      if (v_eval ->> 'amount')::bigint > 0 and (
           v_best is null
           or (v_eval ->> 'amount')::bigint > (v_best ->> 'amount')::bigint
           or ((v_eval ->> 'amount')::bigint = (v_best ->> 'amount')::bigint
               and coalesce((v_promo ->> 'specificity')::integer, 1)
                   > coalesce((v_bestp ->> 'specificity')::integer, 1))) then
        v_best := v_eval;
        v_bestp := v_promo;
      end if;
    end loop;
    exit when v_best is null;

    v_units := 0;
    for v_e in select e from jsonb_array_elements(v_best -> 'lines') e loop
      v_i := (v_e ->> 'i')::integer;
      v_left[v_i] := v_left[v_i] - (v_e ->> 'used')::integer;
      if (v_e ->> 'amount')::bigint > 0 then
        v_alloc[v_i] := v_alloc[v_i] + (v_e ->> 'amount')::bigint;
        v_lp[v_i] := v_lp[v_i] || jsonb_build_array(jsonb_build_object(
                       'promotion_id', v_bestp -> 'id', 'units', (v_e ->> 'units')::integer,
                       'amount', (v_e ->> 'amount')::bigint));
        v_units := v_units + (v_e ->> 'units')::integer;
      end if;
    end loop;
    v_done := v_done || (v_bestp ->> 'id');
    v_total := v_total + (v_best ->> 'amount')::bigint;
    v_applied := v_applied || jsonb_build_array(jsonb_build_object(
                   'promotion_id', v_bestp -> 'id', 'label', v_bestp -> 'label', 'type', v_bestp -> 'type',
                   'rules', v_bestp -> 'rules', 'units', v_units, 'amount', (v_best ->> 'amount')::bigint));
  end loop;

  for v_i in 1 .. v_n loop
    v_out := v_out || jsonb_build_array(jsonb_build_object('promotion_allocation', v_alloc[v_i],
                                                           'in_promotion', v_left[v_i] < v_qty[v_i],
                                                           'promotions', v_lp[v_i]));
  end loop;
  return jsonb_build_object('lines', v_out, 'promotion_total', v_total, 'applied', v_applied);
end
$$;
revoke all on function app.promotion_apply(jsonb, jsonb) from public;

-- -----------------------------------------------------------------------------
-- 3. Promociones vigentes para los productos de un carrito.
-- -----------------------------------------------------------------------------
create or replace function app.cart_promotions(p_store_id uuid, p_product_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pr.id, 'label', pr.label, 'type', pr.type, 'rules', pr.rules,
           'applies_to_sale_items', pr.applies_to_sale_items,
           'specificity', case pr.scope when 'products' then 3 when 'categories' then 2 else 1 end,
           'product_ids', case when pr.scope = 'store' then null else
             (select coalesce(jsonb_agg(distinct x.product_id), '[]'::jsonb) from (
                select t.product_id from public.promotion_targets t
                 where t.store_id = p_store_id and t.promotion_id = pr.id and t.product_id = any (p_product_ids)
                union
                select pc.product_id
                  from public.promotion_targets t
                  join public.categories c on c.store_id = t.store_id and c.id = t.category_id
                  join public.categories c2 on c2.store_id = c.store_id and c2.deleted_at is null
                                           and (c2.id = c.id or c2.path like c.path || '/%')
                  join public.product_categories pc on pc.store_id = c2.store_id and pc.category_id = c2.id
                 where t.store_id = p_store_id and t.promotion_id = pr.id and c.deleted_at is null
                   and pc.product_id = any (p_product_ids)) x) end)
           order by pr.created_at, pr.id), '[]'::jsonb)
    from public.promotions pr
   where pr.store_id = p_store_id and pr.status = 'active'
     and coalesce(cardinality(p_product_ids), 0) > 0
     and (pr.starts_at is null or pr.starts_at <= now())
     and (pr.ends_at is null or pr.ends_at > now())
$$;
revoke all on function app.cart_promotions(uuid, uuid[]) from public;

-- -----------------------------------------------------------------------------
-- 4. Totales (mismo contrato; ver casos dorados). Nuevo: promotion_allocation
--    por línea, promotion_total / coupon_total y el cupón no combinable.
-- -----------------------------------------------------------------------------
create or replace function app.cart_totals(p_lines jsonb, p_rules jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_rate      integer := coalesce((p_rules ->> 'tax_rate_bps')::integer, 0);
  v_included  boolean := coalesce((p_rules ->> 'prices_include_tax')::boolean, false);
  v_tax_ship  boolean := coalesce((p_rules ->> 'tax_applies_to_shipping')::boolean, false);
  v_disc      jsonb := nullif(p_rules -> 'discount', 'null'::jsonb);
  v_ship      jsonb := nullif(p_rules -> 'shipping', 'null'::jsonb);
  v_combines  boolean;
  v_subs      bigint[] := array[]::bigint[];
  v_promo     bigint[] := array[]::bigint[];
  v_weights   bigint[] := array[]::bigint[];
  v_subtotal  bigint := 0;
  v_promo_tot bigint := 0;
  v_base      bigint := 0;
  v_discount  bigint := 0;
  v_alloc     bigint[];
  v_shipping  bigint := 0;
  v_tax       bigint := 0;
  v_line_tax  bigint;
  v_lines     jsonb := '[]'::jsonb;
  v_line      jsonb;
  v_sub       bigint;
  v_p         bigint;
  v_i         integer := 0;
begin
  if v_rate not between 0 and 10000 then
    raise exception using errcode = '22023', message = 'tax_rate_bps fuera de rango';
  end if;
  v_combines := coalesce((v_disc ->> 'combines_with_promotions')::boolean, false);
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if (v_line ->> 'unit_price')::bigint < 0 or (v_line ->> 'quantity')::integer < 1 then
      raise exception using errcode = '22023', message = 'línea inválida';
    end if;
    v_sub := (v_line ->> 'unit_price')::bigint * (v_line ->> 'quantity')::integer;
    v_p := coalesce((v_line ->> 'promotion_allocation')::bigint, 0);
    if v_p < 0 or v_p > v_sub then
      raise exception using errcode = '22023', message = 'línea inválida';
    end if;
    v_subs := v_subs || v_sub;
    v_promo := v_promo || v_p;
    -- El cupón descuenta lo que queda de cada línea; si no se combina, solo
    -- las líneas sin promoción.
    v_weights := v_weights || case when v_combines or not coalesce((v_line ->> 'in_promotion')::boolean, v_p > 0)
                                   then v_sub - v_p else 0 end;
  end loop;
  select coalesce(sum(x), 0) into v_subtotal from unnest(v_subs) x;
  select coalesce(sum(x), 0) into v_promo_tot from unnest(v_promo) x;
  select coalesce(sum(x), 0) into v_base from unnest(v_weights) x;

  -- Cupón sobre su base.
  if v_disc is not null then
    v_discount := case v_disc ->> 'type'
      when 'percentage' then app.div_half_even(v_base::numeric * (v_disc ->> 'value')::bigint, 10000)
      when 'fixed_amount' then least((v_disc ->> 'value')::bigint, v_base)
      else 0
    end;
  end if;
  v_alloc := app.allocate_largest_remainder(v_discount, v_weights);

  -- Envío: `free_over` se evalúa sobre el subtotal ya descontado (§17.3.4).
  if v_ship is not null then
    v_shipping := case
      when v_disc ->> 'type' = 'free_shipping' then 0
      when v_ship ->> 'type' = 'pickup' then 0
      when v_ship ->> 'type' = 'free_over'
           and v_subtotal - v_promo_tot - v_discount >= (v_ship ->> 'free_over_subtotal')::bigint then 0
      else (v_ship ->> 'price')::bigint
    end;
  end if;

  -- Impuesto por línea (sobre lo cobrado) y luego sumado (§17.3.5).
  for v_i in 1 .. coalesce(array_length(v_subs, 1), 0) loop
    v_sub := v_subs[v_i] - v_promo[v_i] - v_alloc[v_i];
    v_line_tax := case when v_included
                       then app.div_half_even(v_sub::numeric * v_rate, 10000 + v_rate)
                       else app.div_half_even(v_sub::numeric * v_rate, 10000) end;
    v_tax := v_tax + v_line_tax;
    v_lines := v_lines || jsonb_build_object('line_subtotal', v_subs[v_i], 'promotion_allocation', v_promo[v_i],
                                             'coupon_allocation', v_alloc[v_i],
                                             'discount_allocation', v_promo[v_i] + v_alloc[v_i],
                                             'line_total', v_sub, 'tax_amount', v_line_tax);
  end loop;
  if v_tax_ship and v_shipping > 0 then
    v_tax := v_tax + case when v_included then app.div_half_even(v_shipping::numeric * v_rate, 10000 + v_rate)
                          else app.div_half_even(v_shipping::numeric * v_rate, 10000) end;
  end if;

  return jsonb_build_object(
    'lines', v_lines, 'subtotal', v_subtotal, 'promotion_total', v_promo_tot, 'coupon_total', v_discount,
    'discount_total', v_promo_tot + v_discount, 'shipping_total', v_shipping, 'tax_total', v_tax,
    'total', v_subtotal - v_promo_tot - v_discount + v_shipping + case when v_included then 0 else v_tax end);
end
$$;
revoke all on function app.cart_totals(jsonb, jsonb) from public;

-- -----------------------------------------------------------------------------
-- 5. Carrito completo: igual que en 20261013000600, más promociones.
-- -----------------------------------------------------------------------------
create or replace function app.calculate_cart(p_store_id uuid, p_cart_id uuid, p_shipping_rate_id uuid default null,
                                              p_discount_code text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store    public.stores;
  v_cart     public.carts;
  v_lines    jsonb;
  v_sellable jsonb;
  v_weight   bigint;
  v_needs    boolean;
  v_subtotal bigint;
  v_code     text := nullif(upper(btrim(coalesce(p_discount_code, ''))), '');
  v_disc     record;
  v_disc_out jsonb;
  v_rate     record;
  v_rate_id  uuid;
  v_ship_out jsonb;
  v_options  jsonb := '[]'::jsonb;
  v_totals   jsonb;
  v_merged   jsonb := '[]'::jsonb;
  v_i        integer := 0;
  v_line     jsonb;
  v_promo    jsonb;
  v_ptotal   bigint := 0;
  v_base     bigint;
  v_dtype    text;
  v_combines boolean;
begin
  select * into v_store from public.stores s where s.id = p_store_id;
  select * into v_cart from public.carts c where c.store_id = p_store_id and c.id = p_cart_id;
  if v_store.id is null or v_cart.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'cart';
  end if;

  select coalesce(jsonb_agg(l order by l ->> 'added_at', l ->> 'variant_id'), '[]'::jsonb) into v_lines
    from (
      select jsonb_build_object(
               'variant_id', v.id, 'product_id', p.id, 'product_title', p.title, 'product_slug', p.slug,
               'product_type', p.product_type,
               'variant_title', nullif((select string_agg(ov.value, ' / ' order by o.position)
                                          from public.variant_option_values vov
                                          join public.product_option_values ov on ov.id = vov.option_value_id
                                          join public.product_options o on o.id = ov.option_id
                                         where vov.variant_id = v.id), ''),
               'option_values', coalesce((select jsonb_object_agg(o.name, ov.value)
                                            from public.variant_option_values vov
                                            join public.product_option_values ov on ov.id = vov.option_value_id
                                            join public.product_options o on o.id = ov.option_id
                                           where vov.variant_id = v.id), '{}'::jsonb),
               'sku', v.sku, 'unit_price', v.price, 'compare_at_price', v.compare_at_price,
               'quantity', ci.quantity, 'weight_g', coalesce(v.weight_g, 0),
               'requires_shipping', v.requires_shipping,
               'image', coalesce(
                  (select jsonb_build_object('path', m.storage_path, 'alt', m.alt_text) from public.media m
                    where m.store_id = v.store_id and m.id = v.image_id and m.status = 'ready' and m.deleted_at is null),
                  app.product_cover(p.store_id, p.id)),
               'added_at', ci.created_at,
               'state', case
                 when v.deleted_at is not null or v.status <> 'active' or p.deleted_at is not null
                      or p.status <> 'active' or p.product_type <> 'physical' then 'unavailable'
                 when v.track_inventory and v.inventory_policy = 'deny'
                      and coalesce((select sum(l.available) from public.inventory_levels l
                                      join public.inventory_locations loc on loc.store_id = l.store_id
                                       and loc.id = l.location_id and loc.is_active
                                     where l.store_id = v.store_id and l.variant_id = v.id), 0) < ci.quantity
                      then 'insufficient_stock'
                 else 'ok' end,
               'available_quantity', case when v.track_inventory and v.inventory_policy = 'deny' then
                  greatest(coalesce((select sum(l.available) from public.inventory_levels l
                                       join public.inventory_locations loc on loc.store_id = l.store_id
                                        and loc.id = l.location_id and loc.is_active
                                      where l.store_id = v.store_id and l.variant_id = v.id), 0), 0) end
             ) as l
        from public.cart_items ci
        join public.product_variants v on v.store_id = ci.store_id and v.id = ci.variant_id
        join public.products p on p.store_id = v.store_id and p.id = v.product_id
       where ci.store_id = p_store_id and ci.cart_id = p_cart_id
    ) x;

  select coalesce(jsonb_agg(l order by n), '[]'::jsonb) into v_sellable
    from jsonb_array_elements(v_lines) with ordinality e(l, n) where l ->> 'state' <> 'unavailable';
  select coalesce(sum((l ->> 'weight_g')::bigint * (l ->> 'quantity')::integer)
                    filter (where (l ->> 'requires_shipping')::boolean), 0),
         coalesce(bool_or((l ->> 'requires_shipping')::boolean), false),
         coalesce(sum((l ->> 'unit_price')::bigint * (l ->> 'quantity')::integer), 0)
    into v_weight, v_needs, v_subtotal
    from jsonb_array_elements(v_sellable) l;

  -- Promociones automáticas (ADR-070): una por pieza, la que más ahorra.
  v_promo := app.promotion_apply(
    (select coalesce(jsonb_agg(jsonb_build_object(
              'product_id', l -> 'product_id', 'unit_price', l -> 'unit_price', 'quantity', l -> 'quantity',
              'on_sale', coalesce((l ->> 'compare_at_price')::bigint > (l ->> 'unit_price')::bigint, false))
              order by n), '[]'::jsonb)
       from jsonb_array_elements(v_sellable) with ordinality e(l, n)),
    app.cart_promotions(p_store_id, (select array_agg(distinct (l ->> 'product_id')::uuid)
                                       from jsonb_array_elements(v_sellable) l)));
  v_ptotal := (v_promo ->> 'promotion_total')::bigint;

  -- Descuento
  if v_code is not null then
    -- Base del cupón (mínimo de compra incluido): sin las líneas con promoción,
    -- salvo que el cupón se combine; envío gratis siempre se combina.
    select d.type, d.combines_with_promotions into v_dtype, v_combines
      from public.discounts d where d.store_id = p_store_id and d.code = v_code;
    v_base := case when coalesce(v_combines, false) or v_dtype = 'free_shipping' then v_subtotal - v_ptotal
                   else (select coalesce(sum((l ->> 'unit_price')::bigint * (l ->> 'quantity')::integer), 0)
                           from jsonb_array_elements(v_sellable) with ordinality e(l, n)
                          where not (v_promo -> 'lines' -> (n::integer - 1) ->> 'in_promotion')::boolean)
              end;
    select * into v_disc from app.discount_status(p_store_id, v_code, v_base, v_cart.email);
    if v_ptotal > 0 and v_base = 0 and v_disc.type <> 'free_shipping' and v_disc.status in ('ok', 'min_subtotal') then
      v_disc.status := 'not_applicable';
    end if;
    if v_disc.status = 'ok' and v_disc.type = 'free_shipping' and not v_needs then
      v_disc.status := 'not_applicable';
    end if;
    -- Un código no válido no revela si existe, su tipo ni su valor (Gate F6).
    v_disc_out := case
      when v_disc.status = 'ok' then
        jsonb_build_object('code', v_code, 'status', 'ok', 'type', v_disc.type, 'value', v_disc.value,
                           'min_subtotal', v_disc.min_subtotal, 'eligible_subtotal', v_base,
                           'combines_with_promotions', coalesce(v_combines, false))
      else jsonb_build_object('code', v_code,
                              'status', case when v_disc.status in ('inactive', 'not_started') then 'not_found'
                                             else v_disc.status end,
                              'min_subtotal', case when v_disc.status = 'min_subtotal' then v_disc.min_subtotal end)
    end;
  end if;

  -- Envío: opciones para la dirección del carrito y tarifa elegida.
  v_rate_id := coalesce(p_shipping_rate_id, v_cart.shipping_rate_id);
  if v_needs then
    if v_cart.shipping_address is not null and app.address_valid(v_cart.shipping_address) then
      select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) into v_options
        from app.shipping_options(p_store_id, v_cart.shipping_address, v_weight) o;
    end if;
    select * into v_rate from jsonb_to_record(
        (select o from jsonb_array_elements(v_options) o where (o ->> 'rate_id')::uuid = v_rate_id))
      as r(rate_id uuid, name text, type text, price bigint, free_over_subtotal bigint,
           est_days_min integer, est_days_max integer);
    v_ship_out := case
      when v_cart.shipping_address is null or not app.address_valid(v_cart.shipping_address)
        then jsonb_build_object('status', 'address_required')
      when v_rate.rate_id is null and v_rate_id is not null then jsonb_build_object('status', 'unavailable')
      when v_rate.rate_id is null then jsonb_build_object('status', 'rate_required')
      else jsonb_build_object('status', 'ok', 'rate_id', v_rate.rate_id, 'name', v_rate.name, 'type', v_rate.type,
                              'price', v_rate.price, 'free_over_subtotal', v_rate.free_over_subtotal,
                              'est_days_min', v_rate.est_days_min, 'est_days_max', v_rate.est_days_max)
    end;
  else
    v_ship_out := jsonb_build_object('status', 'not_required');
  end if;

  v_totals := app.cart_totals(
    (select coalesce(jsonb_agg(jsonb_build_object('unit_price', l -> 'unit_price', 'quantity', l -> 'quantity',
                                                 'promotion_allocation',
                                                 v_promo -> 'lines' -> (n::integer - 1) -> 'promotion_allocation',
                                                 'in_promotion', v_promo -> 'lines' -> (n::integer - 1) -> 'in_promotion')
                               order by n), '[]'::jsonb)
       from jsonb_array_elements(v_sellable) with ordinality e(l, n)),
    jsonb_build_object(
      'tax_rate_bps', v_store.tax_rate_bps, 'prices_include_tax', v_store.prices_include_tax,
      'tax_applies_to_shipping', v_store.tax_applies_to_shipping,
      'discount', case when v_disc_out ->> 'status' = 'ok'
                       then jsonb_build_object('type', v_disc_out -> 'type', 'value', v_disc_out -> 'value',
                                               'combines_with_promotions', coalesce(v_combines, false)) end,
      'shipping', case when v_ship_out ->> 'status' = 'ok' then v_ship_out end));

  -- Unir el cálculo por línea con los datos de cada línea vendible.
  for v_line in select * from jsonb_array_elements(v_sellable) loop
    v_merged := v_merged || (v_line || (v_totals -> 'lines' -> v_i)
                             || jsonb_build_object('promotions', v_promo -> 'lines' -> v_i -> 'promotions'));
    v_i := v_i + 1;
  end loop;
  v_merged := v_merged || coalesce((select jsonb_agg(l order by n) from jsonb_array_elements(v_lines)
                                       with ordinality e(l, n) where l ->> 'state' = 'unavailable'), '[]'::jsonb);

  return jsonb_build_object(
    'cart_id', v_cart.id, 'currency', v_store.currency, 'prices_include_tax', v_store.prices_include_tax,
    'tax_rate_bps', v_store.tax_rate_bps, 'tax_applies_to_shipping', v_store.tax_applies_to_shipping,
    'email', v_cart.email, 'shipping_address', v_cart.shipping_address,
    'lines', v_merged, 'item_count', (select coalesce(sum((l ->> 'quantity')::integer), 0)
                                        from jsonb_array_elements(v_sellable) l),
    'requires_shipping', v_needs, 'weight_g', v_weight,
    'discount', case when v_disc_out is null then null
                     else v_disc_out || jsonb_build_object('amount', case when v_disc_out ->> 'status' = 'ok'
                                                                          then v_totals -> 'coupon_total' else to_jsonb(0) end) end,
    'shipping', v_ship_out, 'shipping_options', v_options,
    'subtotal', v_totals -> 'subtotal', 'discount_total', v_totals -> 'discount_total',
    'promotion_total', v_totals -> 'promotion_total', 'coupon_total', v_totals -> 'coupon_total',
    'promotions', v_promo -> 'applied',
    'shipping_total', v_totals -> 'shipping_total', 'tax_total', v_totals -> 'tax_total',
    'total', v_totals -> 'total',
    'has_unavailable', exists (select 1 from jsonb_array_elements(v_lines) l where l ->> 'state' = 'unavailable'),
    'has_insufficient_stock', exists (select 1 from jsonb_array_elements(v_lines) l
                                       where l ->> 'state' = 'insufficient_stock'));
end
$$;

-- -----------------------------------------------------------------------------
-- 6. Pedido: igual que en 20261117000600, más promociones (snapshot por partida).
-- -----------------------------------------------------------------------------
create or replace function storefront.place_order(p_store_id uuid, p_token text, p_input jsonb, p_expected_total bigint,
                                                  p_idem_key text, p_guest_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash      bytea := app.cart_token_hash(p_token);
  v_order     public.orders;
  v_cart      public.carts;
  v_store     public.stores;
  v_calc      jsonb;
  v_email     text := lower(btrim(coalesce(p_input ->> 'email', '')));
  v_name      text := btrim(coalesce(p_input ->> 'customer_name', ''));
  v_phone     text := nullif(btrim(coalesce(p_input ->> 'phone', '')), '');
  v_note      text := nullif(btrim(coalesce(p_input ->> 'customer_note', '')), '');
  v_account   uuid;
  v_provider  text;
  v_rate      uuid;
  v_disc      record;
  v_disc_id   uuid;
  v_number    bigint;
  v_customer  uuid;
  v_ttl       integer;
  v_expires   timestamptz;
  v_payment   uuid;
  v_items     jsonb;
  v_line      jsonb;
  v_pos       integer := 0;
  v_item      uuid;
  v_pl        jsonb;
begin
  if p_idem_key is null or p_idem_key !~ '^[A-Za-z0-9_-]{16,100}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'idempotency_key';
  end if;
  if p_guest_token_hash is null or octet_length(p_guest_token_hash) <> 32 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'guest_token';
  end if;

  -- 0. Idempotencia: el mismo carrito y la misma clave devuelven el mismo pedido.
  select o.* into v_order from public.orders o
   where o.store_id = p_store_id and o.checkout_idempotency_key = p_idem_key;
  if v_order.id is not null then
    if not exists (select 1 from public.carts c where c.store_id = p_store_id and c.id = v_order.cart_id
                                                  and c.token_hash = v_hash) then
      raise exception using errcode = 'P0001', message = 'conflict', detail = 'idempotency_key';
    end if;
    return app.order_replay(v_order.id);
  end if;

  -- 1. Carrito bloqueado (serializa por carrito). Tras esperar el bloqueo, una
  --    petición gemela ya pudo crear el pedido: se repite el paso 0.
  select * into v_cart from public.carts c
   where c.store_id = p_store_id and c.token_hash = v_hash for update;
  select o.* into v_order from public.orders o
   where o.store_id = p_store_id and o.checkout_idempotency_key = p_idem_key and o.cart_id = v_cart.id;
  if v_order.id is not null then
    return app.order_replay(v_order.id);
  end if;
  if v_cart.id is null or v_cart.status <> 'active' or v_cart.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'cart_invalid', detail = 'cart';
  end if;

  -- 2. Tienda activa y organización no suspendida.
  if not app.store_accepts_carts(p_store_id, true) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'store';
  end if;
  select * into v_store from public.stores s where s.id = p_store_id;

  -- 3. Validación de la entrada.
  if jsonb_typeof(p_input) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'input';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'email';
  end if;
  if char_length(v_name) not between 1 and 160 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'customer_name';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{7,20}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'phone';
  end if;
  if char_length(coalesce(v_note, '')) > 1000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'customer_note';
  end if;
  if jsonb_typeof(p_input -> 'shipping_address') = 'object' and not app.address_valid(p_input -> 'shipping_address') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'shipping_address';
  end if;
  begin
    v_account := (p_input ->> 'payment_account_id')::uuid;
    v_rate := nullif(p_input ->> 'shipping_rate_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'input';
  end;
  select a.provider into v_provider from public.payment_accounts a
   where a.store_id = p_store_id and a.id = v_account and a.status = 'active';
  if v_provider is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'payment_account_id';
  end if;

  update public.carts
     set email = v_email,
         shipping_address = case when jsonb_typeof(p_input -> 'shipping_address') = 'object'
                                 then p_input -> 'shipping_address' else shipping_address end,
         shipping_rate_id = coalesce(v_rate, shipping_rate_id),
         discount_code = case when p_input ? 'discount_code'
                              then nullif(upper(btrim(coalesce(p_input ->> 'discount_code', ''))), '')
                              else discount_code end
   where id = v_cart.id
  returning * into v_cart;

  -- 4. Totales desde la base; el total esperado solo detecta cambios.
  v_calc := app.calculate_cart(p_store_id, v_cart.id, v_cart.shipping_rate_id, v_cart.discount_code);
  if jsonb_array_length(v_calc -> 'lines') = 0 or (v_calc ->> 'item_count')::integer = 0 then
    raise exception using errcode = 'P0001', message = 'cart_invalid', detail = 'empty';
  end if;
  if (v_calc ->> 'has_unavailable')::boolean then
    raise exception using errcode = 'P0001', message = 'cart_invalid', detail = 'unavailable';
  end if;
  if (v_calc ->> 'requires_shipping')::boolean and v_calc -> 'shipping' ->> 'status' <> 'ok' then
    raise exception using errcode = 'P0001', message = 'validation_failed',
                          detail = case v_calc -> 'shipping' ->> 'status' when 'address_required' then 'shipping_address'
                                        else 'shipping_rate_id' end;
  end if;
  if v_cart.discount_code is not null and v_calc -> 'discount' ->> 'status' <> 'ok' then
    raise exception using errcode = 'P0001', message = 'discount_invalid', detail = v_calc -> 'discount' ->> 'status';
  end if;
  if (v_calc ->> 'total')::bigint = 0 then
    -- Sin pasarela no hay pedidos gratuitos en el MVP (D-F6-05).
    raise exception using errcode = 'P0001', message = 'cart_invalid', detail = 'zero_total';
  end if;
  if p_expected_total is distinct from (v_calc ->> 'total')::bigint then
    raise exception using errcode = 'P0001', message = 'price_changed', detail = v_calc ->> 'total';
  end if;

  -- 5. Cupón: bloqueo, revalidación y reserva (cuenta para el límite).
  if v_cart.discount_code is not null then
    select d.id into v_disc_id from public.discounts d
     where d.store_id = p_store_id and d.code = v_cart.discount_code for update;
    select * into v_disc from app.discount_status(p_store_id, v_cart.discount_code,
                                                  coalesce((v_calc -> 'discount' ->> 'eligible_subtotal')::bigint,
                                                           (v_calc ->> 'subtotal')::bigint), v_email);
    if v_disc.status <> 'ok' then
      raise exception using errcode = 'P0001', message = 'discount_invalid', detail = v_disc.status;
    end if;
    update public.discounts set times_reserved = times_reserved + 1 where id = v_disc_id;
  end if;

  -- 6. Número del pedido (contador por tienda; se revierte con todo lo demás).
  --    Upsert atómico: también serializa los primeros pedidos simultáneos de una
  --    tienda sin fila de contador (carrera hallada por la prueba de concurrencia).
  insert into public.store_counters (store_id, key, value)
  values (p_store_id, 'order_number', v_store.order_number_start)
  on conflict (store_id, key) do update set value = public.store_counters.value + 1
  returning value into v_number;

  -- 7. Cliente por email (uno por tienda).
  -- El consentimiento de marketing se guarda en el pedido y solo pasa al cliente
  -- al confirmarse el pago (Gate F6: nadie suscribe un email ajeno con un pedido impago).
  insert into public.customers (store_id, email, phone)
  values (p_store_id, v_email, v_phone)
  on conflict (store_id, email) do update set updated_at = now()
  returning id into v_customer;

  -- 8. Pedido con snapshot.
  insert into public.orders (
    store_id, number, display_number, guest_access_token_hash, source, checkout_idempotency_key, cart_id,
    customer_id, email, phone, customer_name, shipping_address, requires_shipping,
    currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
    shipping_rate_id, shipping_snapshot, discount_snapshot,
    subtotal, discount_total, shipping_total, tax_total, total, customer_note, accepts_marketing,
    promotion_total, snapshot_version)
  values (
    p_store_id, v_number, coalesce(v_store.order_number_prefix, '#') || v_number, p_guest_token_hash, 'storefront',
    p_idem_key, v_cart.id, v_customer, v_email, v_phone, v_name,
    case when (v_calc ->> 'requires_shipping')::boolean then v_cart.shipping_address end,
    (v_calc ->> 'requires_shipping')::boolean,
    v_store.currency, v_store.prices_include_tax, v_store.tax_rate_bps, v_store.tax_applies_to_shipping,
    case when v_calc -> 'shipping' ->> 'status' = 'ok' then (v_calc -> 'shipping' ->> 'rate_id')::uuid end,
    case when v_calc -> 'shipping' ->> 'status' = 'ok' then (v_calc -> 'shipping') - 'status' end,
    case when v_cart.discount_code is not null then
      jsonb_build_object('code', v_cart.discount_code, 'type', v_calc -> 'discount' -> 'type',
                         'value', v_calc -> 'discount' -> 'value', 'amount', v_calc -> 'coupon_total',
                         'combines_with_promotions', v_calc -> 'discount' -> 'combines_with_promotions') end,
    (v_calc ->> 'subtotal')::bigint, (v_calc ->> 'discount_total')::bigint, (v_calc ->> 'shipping_total')::bigint,
    (v_calc ->> 'tax_total')::bigint, (v_calc ->> 'total')::bigint, v_note,
    coalesce((p_input ->> 'accepts_marketing')::boolean, false),
    (v_calc ->> 'promotion_total')::bigint, case when (v_calc ->> 'promotion_total')::bigint > 0 then 2 else 1 end)
  returning * into v_order;

  -- 9. Partidas (snapshot).
  for v_line in select * from jsonb_array_elements(v_calc -> 'lines') loop
    insert into public.order_items (
      store_id, order_id, variant_id, product_id, product_title, variant_title, sku, option_values, image_path,
      product_type, requires_shipping, weight_g, unit_price, compare_at_price, quantity, discount_allocation,
      tax_amount, line_total, position, promotion_allocation)
    values (
      p_store_id, v_order.id, (v_line ->> 'variant_id')::uuid, (v_line ->> 'product_id')::uuid,
      v_line ->> 'product_title', v_line ->> 'variant_title', v_line ->> 'sku', v_line -> 'option_values',
      v_line -> 'image' ->> 'path', v_line ->> 'product_type', (v_line ->> 'requires_shipping')::boolean,
      (v_line ->> 'weight_g')::integer, (v_line ->> 'unit_price')::bigint,
      (v_line ->> 'compare_at_price')::bigint, (v_line ->> 'quantity')::integer,
      (v_line ->> 'discount_allocation')::bigint, (v_line ->> 'tax_amount')::bigint,
      (v_line ->> 'line_total')::bigint, v_pos, (v_line ->> 'promotion_allocation')::bigint)
    returning id into v_item;
    -- Copia de cada promoción aplicada a la partida (ADR-070).
    for v_pl in select * from jsonb_array_elements(coalesce(v_line -> 'promotions', '[]'::jsonb)) loop
      insert into public.order_promotions (store_id, order_id, order_item_id, promotion_id, snapshot, units, amount)
      select p_store_id, v_order.id, v_item, pr.id,
             jsonb_build_object('name', pr.name, 'label', pr.label, 'type', pr.type, 'rules', pr.rules,
                                'scope', pr.scope, 'applies_to_sale_items', pr.applies_to_sale_items),
             (v_pl ->> 'units')::integer, (v_pl ->> 'amount')::bigint
        from public.promotions pr
       where pr.store_id = p_store_id and pr.id = (v_pl ->> 'promotion_id')::uuid;
      if not found then
        raise exception using errcode = 'P0001', message = 'price_changed', detail = v_calc ->> 'total';
      end if;
    end loop;
    v_pos := v_pos + 1;
  end loop;

  if v_disc_id is not null then
    insert into public.discount_redemptions (store_id, discount_id, order_id, customer_id, amount)
    values (p_store_id, v_disc_id, v_order.id, v_customer, (v_calc ->> 'coupon_total')::bigint);
  end if;

  -- 10. Reserva de inventario: `insufficient_stock` revierte TODO.
  -- Transferencia o depósito (proveedor manual): el comprador necesita tiempo para
  -- pagar y el personal para confirmarlo; las piezas quedan apartadas 24 horas
  -- (decisión del propietario, D-INT-02). Tarjeta y demás: el plazo de la tienda.
  v_ttl := case when v_provider = 'manual' then 24 * 60 else v_store.reservation_ttl_minutes end;
  v_expires := now() + make_interval(mins => v_ttl);
  select jsonb_agg(jsonb_build_object('variant_id', l -> 'variant_id', 'quantity', l -> 'quantity'))
    into v_items from jsonb_array_elements(v_calc -> 'lines') l;
  perform app.inventory_reserve(p_store_id, v_order.id, v_items, v_expires);

  -- 11. Intento de pago (la llamada al proveedor va después del commit, §17.5).
  insert into public.payments (store_id, order_id, payment_account_id, provider, amount, currency, idempotency_key,
                               expires_at)
  values (p_store_id, v_order.id, v_account, v_provider, v_order.total, v_order.currency,
          'pay_' || replace(v_order.id::text, '-', ''), v_expires - interval '2 minutes')
  returning id into v_payment;

  -- §17.7: 20 pedidos por email y tienda al día. Cuenta solo pedidos creados:
  -- un intento fallido revierte también este contador (Gate F6).
  if not app.rate_limit_take('checkout:email:' || p_store_id || ':' || encode(sha256(convert_to(v_email, 'UTF8')), 'hex'),
                             20, 86400) then
    raise exception using errcode = 'P0001', message = 'rate_limited', detail = 'email';
  end if;

  -- 12-13. Carrito convertido; evento y job.
  update public.carts set status = 'converted' where id = v_cart.id;
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, metadata)
  values (p_store_id, v_order.id, 'order.created', 'Pedido recibido', true, 'customer',
          jsonb_build_object('total', v_order.total, 'items', (v_calc ->> 'item_count')::integer,
                             'promotion_total', v_order.promotion_total));
  perform app.enqueue_job('order.created', jsonb_build_object('order_id', v_order.id), p_store_id,
                          'order.created:' || v_order.id);

  return jsonb_build_object('order_id', v_order.id, 'display_number', v_order.display_number,
                            'total', v_order.total, 'currency', v_order.currency, 'replayed', false,
                            'payment', jsonb_build_object('id', v_payment, 'provider', v_provider, 'status', 'created',
                                                          'expires_at', v_expires - interval '2 minutes'));
end
$$;

-- -----------------------------------------------------------------------------
-- 7. Vista previa para el panel (discounts.read): la regla sobre un carrito de
--    ejemplo [{product_id?, unit_price, quantity, on_sale?}], sin guardar nada.
-- -----------------------------------------------------------------------------
create or replace function public.promotions_preview(p_store_id uuid, p_promotion jsonb, p_lines jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'discounts.read');
  if jsonb_typeof(p_promotion) is distinct from 'object'
     or not app.promotion_rules_valid(p_promotion ->> 'type', p_promotion -> 'rules') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rules';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'lines';
  end if;
  begin
    return app.promotion_apply(
      (select jsonb_agg(jsonb_build_object(
                'product_id', coalesce(l ->> 'product_id', 'x' || n), 'unit_price', (l ->> 'unit_price')::bigint,
                'quantity', (l ->> 'quantity')::integer, 'on_sale', coalesce((l ->> 'on_sale')::boolean, false))
                order by n)
         from jsonb_array_elements(p_lines) with ordinality e(l, n)),
      jsonb_build_array(jsonb_build_object(
        'id', 'preview', 'label', coalesce(p_promotion ->> 'label', ''), 'type', p_promotion ->> 'type',
        'rules', p_promotion -> 'rules', 'product_ids', null,
        'applies_to_sale_items', coalesce((p_promotion ->> 'applies_to_sale_items')::boolean, false))));
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value
                 or data_exception then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'lines';
  end;
end
$$;
revoke all on function public.promotions_preview(uuid, jsonb, jsonb) from public;
grant execute on function public.promotions_preview(uuid, jsonb, jsonb) to authenticated;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261125000200'::text
$$;
