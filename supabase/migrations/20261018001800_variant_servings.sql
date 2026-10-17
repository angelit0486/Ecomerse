-- =============================================================================
-- ADR-026 · Contenido neto y porciones por variante (aprobado por delegación del
-- propietario el 2026-10-17, alcance reducido).
--
-- * Dos columnas opcionales en product_variants: vacías = vale el dato del
--   producto (compatibilidad total con lo existente).
-- * catalog_upsert_product las acepta por variante (ausente = sin cambios) y
--   storefront.get_product las publica para el precio por porción por tamaño.
-- * Desviación del ADR: el cumplimiento NO cambia (el contenido neto del
--   producto sigue siendo obligatorio) y el CSV llega en un paso posterior.
-- =============================================================================

alter table public.product_variants
  add column net_content text check (net_content is null or char_length(btrim(net_content)) between 1 and 100),
  add column servings_per_container integer
    check (servings_per_container is null or servings_per_container between 1 and 10000);

create or replace function public.catalog_upsert_product(p_store_id uuid, p_product jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid;
  v_product_id uuid := nullif(p_product ->> 'id', '')::uuid;
  v_existing   public.products;
  v_slug       text;
  v_brand_id   uuid := nullif(p_product ->> 'brand_id', '')::uuid;
  v_options    jsonb := coalesce(p_product -> 'options', '[]'::jsonb);
  v_variants   jsonb := coalesce(p_product -> 'variants', '[]'::jsonb);
  v_can_cost   boolean;
  v_opt        jsonb;
  v_opt_id     uuid;
  v_val        text;
  v_pos        integer;
  v_var        jsonb;
  v_var_id     uuid;
  v_sig        text;
  v_keep       uuid[] := '{}';
  v_constraint text;
  v_cat        jsonb;
  v_publish    text;
begin
  if jsonb_typeof(p_product) is distinct from 'object' or jsonb_typeof(v_options) <> 'array'
     or jsonb_typeof(v_variants) <> 'array' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'product';
  end if;
  if v_product_id is null then
    v_uid := app.require_store_permission(p_store_id, 'products.create');
  else
    v_uid := app.require_store_permission(p_store_id, 'products.update');
    v_existing := app.lock_product(p_store_id, v_product_id);
  end if;
  v_can_cost := app.has_store_permission(p_store_id, 'products.cost.read');
  -- Las invariantes diferidas se comprueban al final de ESTA llamada; si el
  -- llamador ya las puso inmediatas (otra llamada en la misma transacción, p. ej.
  -- una importación por lotes), se vuelven a diferir (Gate F3).
  set constraints all deferred;

  if coalesce(p_product ->> 'product_type', 'physical') <> 'physical' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'product_type';
  end if;
  if coalesce(char_length(btrim(p_product ->> 'title')), 0) not between 1 and 200 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'title';
  end if;
  v_slug := coalesce(nullif(btrim(p_product ->> 'slug'), ''), app.slugify(p_product ->> 'title'));
  if not app.slug_valid(v_slug) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'slug';
  end if;
  if v_brand_id is not null and not exists (
    select 1 from public.brands b where b.store_id = p_store_id and b.id = v_brand_id and b.deleted_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'brand_id';
  end if;
  if jsonb_array_length(v_variants) = 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'variants';
  end if;
  if jsonb_array_length(v_options) > 3 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'options';
  end if;
  if exists (select 1 from jsonb_array_elements(v_variants) x where x ? 'cost') and not v_can_cost then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'cost';
  end if;

  -- Producto ------------------------------------------------------------------
  begin
    if v_product_id is null then
      insert into public.products (store_id, brand_id, title, slug, description_html, tags, specs,
                                   seo_title, seo_description)
      values (p_store_id, v_brand_id, btrim(p_product ->> 'title'), v_slug, p_product ->> 'description_html',
              coalesce((select array_agg(btrim(t)) from jsonb_array_elements_text(p_product -> 'tags') t
                         where btrim(t) <> ''), '{}'),
              coalesce(p_product -> 'specs', '{}'::jsonb),
              nullif(p_product ->> 'seo_title', ''), nullif(p_product ->> 'seo_description', ''))
      returning id into v_product_id;
    else
      update public.products
         set brand_id = v_brand_id, title = btrim(p_product ->> 'title'), slug = v_slug,
             description_html = p_product ->> 'description_html',
             tags = coalesce((select array_agg(btrim(t)) from jsonb_array_elements_text(p_product -> 'tags') t
                               where btrim(t) <> ''), '{}'),
             specs = case when p_product ? 'specs' then coalesce(p_product -> 'specs', '{}'::jsonb) else specs end,
             seo_title = nullif(p_product ->> 'seo_title', ''),
             seo_description = nullif(p_product ->> 'seo_description', '')
       where id = v_product_id;
    end if;
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'slug';
    when check_violation then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'product';
  end;

  -- Opciones y valores (por nombre, sin distinguir mayúsculas) ------------------
  delete from public.product_options o
   where o.product_id = v_product_id
     and lower(o.name) not in (select lower(btrim(x ->> 'name')) from jsonb_array_elements(v_options) x);
  v_pos := 0;
  for v_opt in select * from jsonb_array_elements(v_options) loop
    if coalesce(char_length(btrim(v_opt ->> 'name')), 0) = 0 or jsonb_typeof(v_opt -> 'values') <> 'array'
       or jsonb_array_length(v_opt -> 'values') = 0 then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'options';
    end if;
    select o.id into v_opt_id from public.product_options o
     where o.product_id = v_product_id and lower(o.name) = lower(btrim(v_opt ->> 'name'));
    begin
      if v_opt_id is null then
        insert into public.product_options (store_id, product_id, name, position)
        values (p_store_id, v_product_id, btrim(v_opt ->> 'name'), v_pos) returning id into v_opt_id;
      else
        update public.product_options set name = btrim(v_opt ->> 'name'), position = v_pos where id = v_opt_id;
      end if;
      delete from public.product_option_values ov
       where ov.option_id = v_opt_id
         and lower(ov.value) not in (select lower(btrim(x)) from jsonb_array_elements_text(v_opt -> 'values') x);
      insert into public.product_option_values (store_id, option_id, value, position)
      select p_store_id, v_opt_id, btrim(x.value), x.ordinality - 1
        from jsonb_array_elements_text(v_opt -> 'values') with ordinality x
       where btrim(x.value) <> ''
      on conflict (option_id, lower(value)) do update set value = excluded.value, position = excluded.position;
    exception
      when unique_violation or check_violation then
        raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'options';
    end;
    v_pos := v_pos + 1;
  end loop;

  -- Las variantes que ya no vienen se retiran ANTES de crear las nuevas: así un
  -- SKU o código de barras puede pasar de una variante retirada a una nueva.
  update public.product_variants pv set deleted_at = now()
   where pv.product_id = v_product_id and pv.deleted_at is null
     and not exists (select 1 from jsonb_array_elements(v_variants) x where x ->> 'id' = pv.id::text)
     and pv.option_signature not in (
       select coalesce((select string_agg(o.name || '=' || ov.value, '|' order by o.position, o.name)
                          from public.product_options o
                          join public.product_option_values ov
                            on ov.option_id = o.id and lower(ov.value) = lower(btrim(x -> 'options' ->> o.name))
                         where o.product_id = v_product_id), '')
         from jsonb_array_elements(v_variants) x);

  -- Variantes -----------------------------------------------------------------
  for v_var in select * from jsonb_array_elements(v_variants) loop
    -- Firma a partir del mapa {opción: valor}; cada opción debe tener un valor válido.
    select coalesce(string_agg(o.name || '=' || ov.value, '|' order by o.position, o.name), '')
      into v_sig
      from public.product_options o
      join public.product_option_values ov
        on ov.option_id = o.id and lower(ov.value) = lower(btrim(v_var -> 'options' ->> o.name))
     where o.product_id = v_product_id;
    if (select count(*) from public.product_options o where o.product_id = v_product_id)
       <> (select count(*) from public.product_options o
            join public.product_option_values ov
              on ov.option_id = o.id and lower(ov.value) = lower(btrim(v_var -> 'options' ->> o.name))
           where o.product_id = v_product_id) then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'variants';
    end if;

    v_var_id := nullif(v_var ->> 'id', '')::uuid;
    if v_var_id is not null and not exists (
      select 1 from public.product_variants pv
       where pv.id = v_var_id and pv.product_id = v_product_id and pv.deleted_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'variants';
    end if;
    if v_var_id is null then
      select pv.id into v_var_id from public.product_variants pv
       where pv.product_id = v_product_id and pv.option_signature = v_sig and pv.deleted_at is null;
    end if;

    begin
      if v_var_id is null then
        insert into public.product_variants
          (store_id, product_id, sku, barcode, price, compare_at_price, weight_g, length_mm, width_mm, height_mm,
           status, track_inventory, inventory_policy, requires_shipping, position, option_signature,
           net_content, servings_per_container)
        values
          (p_store_id, v_product_id, v_var ->> 'sku', nullif(v_var ->> 'barcode', ''), (v_var ->> 'price')::bigint,
           (v_var ->> 'compare_at_price')::bigint, (v_var ->> 'weight_g')::integer, (v_var ->> 'length_mm')::integer,
           (v_var ->> 'width_mm')::integer, (v_var ->> 'height_mm')::integer,
           coalesce(v_var ->> 'status', 'active'), coalesce((v_var ->> 'track_inventory')::boolean, true),
           coalesce(v_var ->> 'inventory_policy', 'deny'), coalesce((v_var ->> 'requires_shipping')::boolean, true),
           coalesce((v_var ->> 'position')::integer, 0), v_sig,
           nullif(btrim(v_var ->> 'net_content'), ''), (v_var ->> 'servings_per_container')::integer)
        returning id into v_var_id;
      else
        update public.product_variants
           set sku = v_var ->> 'sku', barcode = nullif(v_var ->> 'barcode', ''),
               price = (v_var ->> 'price')::bigint, compare_at_price = (v_var ->> 'compare_at_price')::bigint,
               -- Lo que el payload no trae se conserva (el editor no muestra todos los campos).
               weight_g = case when v_var ? 'weight_g' then (v_var ->> 'weight_g')::integer else weight_g end,
               length_mm = case when v_var ? 'length_mm' then (v_var ->> 'length_mm')::integer else length_mm end,
               width_mm = case when v_var ? 'width_mm' then (v_var ->> 'width_mm')::integer else width_mm end,
               height_mm = case when v_var ? 'height_mm' then (v_var ->> 'height_mm')::integer else height_mm end,
               status = coalesce(v_var ->> 'status', 'active'),
               track_inventory = case when v_var ? 'track_inventory'
                                      then coalesce((v_var ->> 'track_inventory')::boolean, true) else track_inventory end,
               inventory_policy = case when v_var ? 'inventory_policy'
                                       then coalesce(v_var ->> 'inventory_policy', 'deny') else inventory_policy end,
               requires_shipping = case when v_var ? 'requires_shipping'
                                        then coalesce((v_var ->> 'requires_shipping')::boolean, true) else requires_shipping end,
               position = coalesce((v_var ->> 'position')::integer, 0), option_signature = v_sig,
               -- ADR-026: ausente = se conserva; vacío o null = se borra.
               net_content = case when v_var ? 'net_content' then nullif(btrim(v_var ->> 'net_content'), '')
                                  else net_content end,
               servings_per_container = case when v_var ? 'servings_per_container'
                                             then (v_var ->> 'servings_per_container')::integer
                                             else servings_per_container end
         where id = v_var_id;
      end if;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        raise exception using errcode = 'P0001', message = 'validation_failed',
          detail = case v_constraint when 'product_variants_sku_uq' then 'sku'
                                     when 'product_variants_barcode_uq' then 'barcode'
                                     else 'variants' end;
      when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
        raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'variants';
    end;

    delete from public.variant_option_values vov where vov.variant_id = v_var_id;
    insert into public.variant_option_values (variant_id, option_value_id, option_id, store_id)
    select v_var_id, ov.id, o.id, p_store_id
      from public.product_options o
      join public.product_option_values ov
        on ov.option_id = o.id and lower(ov.value) = lower(btrim(v_var -> 'options' ->> o.name))
     where o.product_id = v_product_id;

    if v_var ? 'cost' then
      if v_var -> 'cost' = 'null'::jsonb then
        delete from public.variant_costs c where c.variant_id = v_var_id;
      else
        insert into public.variant_costs (variant_id, store_id, cost) values (v_var_id, p_store_id, (v_var ->> 'cost')::bigint)
        on conflict (variant_id) do update set cost = excluded.cost;
      end if;
    end if;
    v_keep := v_keep || v_var_id;
  end loop;

  if (select count(*) from unnest(v_keep) k) <> (select count(distinct k) from unnest(v_keep) k) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'variants';
  end if;

  -- Las variantes que ya no vienen se retiran (borrado lógico: los pedidos las referencian).
  update public.product_variants set deleted_at = now()
   where product_id = v_product_id and deleted_at is null and not (id = any (v_keep));

  -- Categorías (si se envían, reemplazan el conjunto) ---------------------------
  if p_product ? 'categories' then
    if (select count(*) from jsonb_array_elements(p_product -> 'categories') c where (c ->> 'is_primary')::boolean) > 1
       or exists (select 1 from jsonb_array_elements(p_product -> 'categories') c
                   where not exists (select 1 from public.categories cat
                                      where cat.store_id = p_store_id and cat.deleted_at is null
                                        and cat.id = nullif(c ->> 'id', '')::uuid)) then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'categories';
    end if;
    delete from public.product_categories pc where pc.product_id = v_product_id;
    for v_cat in select * from jsonb_array_elements(p_product -> 'categories') loop
      insert into public.product_categories (store_id, product_id, category_id, is_primary)
      values (p_store_id, v_product_id, (v_cat ->> 'id')::uuid, coalesce((v_cat ->> 'is_primary')::boolean, false))
      on conflict (product_id, category_id) do nothing;
    end loop;
  end if;

  -- Invariantes diferidas ahora, para responder con un error de campo.
  begin
    set constraints all immediate;
  exception when check_violation then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'variants';
  end;
  set constraints all deferred;

  -- Un producto publicado no puede quedar en un estado que no se podría publicar
  -- (precio 0, sin variantes activas…): la validación de §14.3 no se esquiva
  -- editando después de publicar (Gate F3).
  if (select p.status from public.products p where p.id = v_product_id) = 'active' then
    select string_agg(v.code, ',') into v_publish
      from app.validate_product_for_publish(v_product_id) v where v.level = 'error';
    if v_publish is not null then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'publish', hint = v_publish;
    end if;
  end if;

  perform audit.record(case when v_existing.id is null then 'product.created' else 'product.updated' end,
                       'product', v_product_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       case when v_existing.id is null then null
                            else jsonb_build_object('title', v_existing.title, 'slug', v_existing.slug) end,
                       jsonb_build_object('title', btrim(p_product ->> 'title'), 'slug', v_slug,
                                          'variants', cardinality(v_keep)));
  return jsonb_build_object('id', v_product_id, 'slug', v_slug);
end
$$;

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

revoke all on function public.catalog_upsert_product(uuid, jsonb) from public;
grant execute on function public.catalog_upsert_product(uuid, jsonb) to authenticated;
revoke all on function storefront.get_product(uuid, text) from public;
grant execute on function storefront.get_product(uuid, text) to storefront_gateway;
