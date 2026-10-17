-- =============================================================================
-- Panel de productos: cambio rápido de precios desde el listado.
--
-- catalog_set_variant_prices cambia precio y precio de comparación de las
-- presentaciones de UN producto, sin reenviar todo el producto. Mismas reglas
-- que catalog_upsert_product: products.update, centavos (bigint), comparación
-- mayor que el precio, y un producto publicado no puede quedar sin poderse
-- publicar (Gate F3). Se audita con los precios anteriores y nuevos.
-- catalog_list_extras agrega las presentaciones activas para el formulario.
-- =============================================================================

create or replace function public.catalog_set_variant_prices(p_store_id uuid, p_product_id uuid, p_prices jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item    jsonb;
  v_before  jsonb := '[]'::jsonb;
  v_after   jsonb := '[]'::jsonb;
  v_var     public.product_variants;
  v_price   bigint;
  v_compare bigint;
  v_publish text;
begin
  perform app.require_store_permission(p_store_id, 'products.update');
  if not exists (select 1 from public.products p
                  where p.store_id = p_store_id and p.id = p_product_id and p.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'product';
  end if;
  if jsonb_typeof(p_prices) is distinct from 'array' or jsonb_array_length(p_prices) not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'prices';
  end if;
  perform app.lock_product(p_store_id, p_product_id);

  for v_item in select x from jsonb_array_elements(p_prices) x loop
    if jsonb_typeof(v_item -> 'price') is distinct from 'number' or (v_item ->> 'price') !~ '^[0-9]{1,15}$'
       or coalesce(jsonb_typeof(v_item -> 'compare_at_price'), 'null') not in ('number', 'null')
       or (jsonb_typeof(v_item -> 'compare_at_price') = 'number' and (v_item ->> 'compare_at_price') !~ '^[0-9]{1,15}$')
       or (v_item ->> 'id') !~ '^[0-9a-f-]{36}$' then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'prices';
    end if;
    v_price := (v_item ->> 'price')::bigint;
    v_compare := (v_item ->> 'compare_at_price')::bigint;
    if v_compare is not null and v_compare <= v_price then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'compare_at_price';
    end if;
    select * into v_var from public.product_variants v
     where v.store_id = p_store_id and v.product_id = p_product_id and v.id = (v_item ->> 'id')::uuid
       and v.deleted_at is null
       for update;
    if v_var.id is null then
      raise exception using errcode = 'P0001', message = 'not_found', detail = 'variant';
    end if;
    if v_var.price is distinct from v_price or v_var.compare_at_price is distinct from v_compare then
      v_before := v_before || jsonb_build_object('id', v_var.id, 'price', v_var.price,
                                                 'compare_at_price', v_var.compare_at_price);
      v_after := v_after || jsonb_build_object('id', v_var.id, 'price', v_price, 'compare_at_price', v_compare);
      update public.product_variants set price = v_price, compare_at_price = v_compare where id = v_var.id;
    end if;
  end loop;

  -- Las validaciones diferidas de la variante corren aquí, dentro de la función:
  -- al confirmar la transacción ya no tendrían los privilegios del definer.
  set constraints all immediate;
  set constraints all deferred;

  if (select p.status from public.products p where p.id = p_product_id) = 'active' then
    select string_agg(v.code, ',') into v_publish
      from app.validate_product_for_publish(p_product_id) v where v.level = 'error';
    if v_publish is not null then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'publish', hint = v_publish;
    end if;
  end if;

  if jsonb_array_length(v_after) > 0 then
    perform audit.record('product.prices_updated', 'product', p_product_id,
                         (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                         jsonb_build_object('variants', v_before), jsonb_build_object('variants', v_after));
  end if;
  return jsonb_build_object('changed', jsonb_array_length(v_after));
end
$$;

create or replace function public.catalog_list_extras(p_store_id uuid, p_product_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stock boolean;
begin
  perform app.require_store_permission(p_store_id, 'products.read');
  v_stock := app.has_store_permission(p_store_id, 'inventory.read');
  return coalesce((
    select jsonb_object_agg(p.id, jsonb_build_object(
             'image', (select m.storage_path from public.media m
                        where m.store_id = p.store_id and m.product_id = p.id and m.status = 'ready'
                          and m.deleted_at is null
                        order by m.position, m.id limit 1),
             'brand', (select b.name from public.brands b
                        where b.store_id = p.store_id and b.id = p.brand_id and b.deleted_at is null),
             'available', case when v_stock then (
                 select sum(greatest(l.available, 0))::integer
                   from public.product_variants v
                   join public.inventory_levels l on l.variant_id = v.id
                   join public.inventory_locations loc on loc.id = l.location_id and loc.is_active
                  where v.product_id = p.id and v.deleted_at is null and v.status = 'active'
                    and v.track_inventory) end,
             'sold_out_variants', case when v_stock then (
                 select count(*)::integer from public.product_variants v
                  where v.product_id = p.id and v.deleted_at is null and v.status = 'active'
                    and v.track_inventory and v.inventory_policy = 'deny'
                    and coalesce((select sum(l.available) from public.inventory_levels l
                                    join public.inventory_locations loc on loc.id = l.location_id and loc.is_active
                                   where l.variant_id = v.id), 0) <= 0) end,
             -- Para el cambio rápido de precios (máximo 20 por producto en el listado).
             'variants', (select coalesce(jsonb_agg(jsonb_build_object(
                                   'id', v.id, 'options', v.option_signature, 'sku', v.sku,
                                   'price', v.price, 'compare_at_price', v.compare_at_price)
                                 order by v.position, v.id), '[]'::jsonb)
                            from (select * from public.product_variants v
                                   where v.store_id = p.store_id and v.product_id = p.id and v.deleted_at is null
                                   order by v.position, v.id limit 20) v)))
      from public.products p
     where p.store_id = p_store_id and p.id = any (p_product_ids[1:100])), '{}'::jsonb);
end
$$;

revoke all on function public.catalog_set_variant_prices(uuid, uuid, jsonb) from public;
grant execute on function public.catalog_set_variant_prices(uuid, uuid, jsonb) to authenticated;
