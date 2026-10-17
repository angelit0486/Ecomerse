-- =============================================================================
-- Panel de productos, tanda 4: ediciones en bloque desde el listado.
--
-- * catalog_bulk_set_brand: misma marca (o ninguna) para varios productos.
-- * catalog_bulk_category: agregar o quitar una categoría a varios productos.
-- * catalog_bulk_adjust_prices: subir o bajar precios por porcentaje, con vista
--   previa (p_apply = false no escribe nada). El precio antes («compare_at») no
--   cambia; si deja de ser mayor que el precio nuevo, se quita (la oferta ya no
--   aplica) y la vista previa lo avisa.
--
-- Todas: products.update, máximo 100 productos de la MISMA tienda, el producto
-- publicado debe seguir siendo publicable (Gate F3) y se audita cada producto.
-- =============================================================================

-- Productos de la tienda, vivos, bloqueados en orden estable (sin interbloqueos).
create or replace function app.bulk_products(p_store_id uuid, p_product_ids uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_id  uuid;
begin
  if p_product_ids is null or cardinality(p_product_ids) not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'products';
  end if;
  select array_agg(p.id order by p.id) into v_ids
    from public.products p
   where p.store_id = p_store_id and p.id = any (p_product_ids) and p.deleted_at is null;
  if coalesce(cardinality(v_ids), 0) <> (select count(distinct x) from unnest(p_product_ids) x) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'product';
  end if;
  foreach v_id in array v_ids loop
    perform app.lock_product(p_store_id, v_id, false);
  end loop;
  return v_ids;
end
$$;
revoke all on function app.bulk_products(uuid, uuid[]) from public;

-- Un producto publicado no puede quedar sin poderse publicar (Gate F3).
create or replace function app.bulk_check_publishable(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_codes text;
begin
  select p.title, string_agg(v.code, ',') into v_title, v_codes
    from public.products p
    cross join lateral app.validate_product_for_publish(p.id) v
   where p.id = any (p_ids) and p.status = 'active' and v.level = 'error'
   group by p.id, p.title
   order by p.title
   limit 1;
  if v_codes is not null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'publish',
                          hint = v_codes, table = left(v_title, 200);
  end if;
end
$$;
revoke all on function app.bulk_check_publishable(uuid[]) from public;

create or replace function public.catalog_bulk_set_brand(p_store_id uuid, p_product_ids uuid[], p_brand_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids     uuid[];
  v_changed integer := 0;
  v_org     uuid := (select s.organization_id from public.stores s where s.id = p_store_id);
  v_r       record;
begin
  perform app.require_store_permission(p_store_id, 'products.update');
  if p_brand_id is not null and not exists (select 1 from public.brands b
       where b.store_id = p_store_id and b.id = p_brand_id and b.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'brand_id';
  end if;
  v_ids := app.bulk_products(p_store_id, p_product_ids);
  for v_r in
    update public.products p set brand_id = p_brand_id
     from (select x.id, x.brand_id from public.products x where x.id = any (v_ids)) old
     where p.id = old.id and p.brand_id is distinct from p_brand_id
    returning p.id, old.brand_id as before
  loop
    v_changed := v_changed + 1;
    perform audit.record('product.updated', 'product', v_r.id, v_org, p_store_id,
                         jsonb_build_object('brand_id', v_r.before), jsonb_build_object('brand_id', p_brand_id),
                         null, jsonb_build_object('bulk', true));
  end loop;
  perform app.bulk_check_publishable(v_ids);
  return jsonb_build_object('changed', v_changed);
end
$$;

create or replace function public.catalog_bulk_category(p_store_id uuid, p_product_ids uuid[], p_category_id uuid,
                                                        p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids     uuid[];
  v_changed integer := 0;
  v_org     uuid := (select s.organization_id from public.stores s where s.id = p_store_id);
  v_id      uuid;
begin
  perform app.require_store_permission(p_store_id, 'products.update');
  if p_mode is null or p_mode not in ('add', 'remove') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'mode';
  end if;
  if not exists (select 1 from public.categories c
                  where c.store_id = p_store_id and c.id = p_category_id and c.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'categories';
  end if;
  v_ids := app.bulk_products(p_store_id, p_product_ids);
  foreach v_id in array v_ids loop
    if p_mode = 'add' then
      -- Es la principal solo si el producto no tenía ninguna.
      insert into public.product_categories (store_id, product_id, category_id, is_primary)
      select p_store_id, v_id, p_category_id,
             not exists (select 1 from public.product_categories pc where pc.product_id = v_id)
      on conflict (product_id, category_id) do nothing;
    else
      delete from public.product_categories pc where pc.product_id = v_id and pc.category_id = p_category_id;
    end if;
    if found then
      v_changed := v_changed + 1;
      perform audit.record('product.updated', 'product', v_id, v_org, p_store_id, null,
                           jsonb_build_object('category_id', p_category_id, 'mode', p_mode),
                           null, jsonb_build_object('bulk', true));
    end if;
  end loop;
  perform app.bulk_check_publishable(v_ids);
  return jsonb_build_object('changed', v_changed);
end
$$;

create or replace function public.catalog_bulk_adjust_prices(p_store_id uuid, p_product_ids uuid[], p_percent numeric,
                                                             p_rounding text, p_apply boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids     uuid[];
  v_rows    jsonb;
  v_org     uuid := (select s.organization_id from public.stores s where s.id = p_store_id);
  v_p       record;
begin
  perform app.require_store_permission(p_store_id, 'products.update');
  if p_percent is null or p_percent = 0 or p_percent < -90 or p_percent > 500 or scale(p_percent) > 2 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'percent';
  end if;
  if p_rounding is null or p_rounding not in ('centavo', 'peso') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rounding';
  end if;
  -- La vista previa no bloquea ni escribe; aplicar sí bloquea los productos.
  if coalesce(p_apply, false) then
    v_ids := app.bulk_products(p_store_id, p_product_ids);
  else
    if p_product_ids is null or cardinality(p_product_ids) not between 1 and 100 then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'products';
    end if;
    select array_agg(p.id) into v_ids from public.products p
     where p.store_id = p_store_id and p.id = any (p_product_ids) and p.deleted_at is null;
  end if;

  -- Precio nuevo en centavos: redondeo comercial (al centavo o al peso), nunca
  -- negativo; un precio de 0 se queda en 0.
  with calc as (
    select v.id, v.product_id, p.title, v.option_signature, v.sku, v.price, v.compare_at_price,
           case when p_rounding = 'peso'
                then greatest(round(v.price * (1 + p_percent / 100) / 100.0) * 100, 0)::bigint
                else greatest(round(v.price * (1 + p_percent / 100)), 0)::bigint end as new_price
      from public.product_variants v
      join public.products p on p.store_id = v.store_id and p.id = v.product_id
     where v.store_id = p_store_id and v.product_id = any (coalesce(v_ids, '{}')) and v.deleted_at is null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'product_id', c.product_id, 'title', c.title, 'options', c.option_signature, 'sku', c.sku,
           'price', c.price, 'new_price', c.new_price, 'compare_at_price', c.compare_at_price,
           'new_compare_at_price', case when c.compare_at_price > c.new_price then c.compare_at_price end)
         order by c.title, c.product_id, c.option_signature), '[]'::jsonb)
    into v_rows
    from calc c;

  if coalesce(p_apply, false) then
    for v_p in
      select (r ->> 'product_id')::uuid as product_id,
             jsonb_agg(jsonb_build_object('id', r -> 'id', 'price', r -> 'price', 'compare_at_price', r -> 'compare_at_price')) as before,
             jsonb_agg(jsonb_build_object('id', r -> 'id', 'price', r -> 'new_price',
                                          'compare_at_price', r -> 'new_compare_at_price')) as after
        from jsonb_array_elements(v_rows) r
       where (r ->> 'price') <> (r ->> 'new_price')
          or (r -> 'compare_at_price') is distinct from (r -> 'new_compare_at_price')
       group by r ->> 'product_id'
    loop
      update public.product_variants v
         set price = (x ->> 'price')::bigint, compare_at_price = (x ->> 'compare_at_price')::bigint
        from jsonb_array_elements(v_p.after) x
       where v.store_id = p_store_id and v.product_id = v_p.product_id and v.id = (x ->> 'id')::uuid;
      perform audit.record('product.prices_updated', 'product', v_p.product_id, v_org, p_store_id,
                           jsonb_build_object('variants', v_p.before), jsonb_build_object('variants', v_p.after),
                           null, jsonb_build_object('bulk', true, 'percent', p_percent, 'rounding', p_rounding));
    end loop;
    -- Validaciones diferidas de las variantes aquí, con los privilegios del definer.
    set constraints all immediate;
    set constraints all deferred;
    perform app.bulk_check_publishable(v_ids);
  end if;
  return jsonb_build_object('applied', coalesce(p_apply, false), 'rows', v_rows);
end
$$;

revoke all on function public.catalog_bulk_set_brand(uuid, uuid[], uuid) from public;
revoke all on function public.catalog_bulk_category(uuid, uuid[], uuid, text) from public;
revoke all on function public.catalog_bulk_adjust_prices(uuid, uuid[], numeric, text, boolean) from public;
grant execute on function public.catalog_bulk_set_brand(uuid, uuid[], uuid) to authenticated;
grant execute on function public.catalog_bulk_category(uuid, uuid[], uuid, text) to authenticated;
grant execute on function public.catalog_bulk_adjust_prices(uuid, uuid[], numeric, text, boolean) to authenticated;
