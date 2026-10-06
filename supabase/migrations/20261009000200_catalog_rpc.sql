-- =============================================================================
-- Fase 3 · RPC del catálogo (F3-T02)
-- Contrato: GATE0 §14.1 (catalog_upsert_product transaccional), §14.3
-- (publicación con validación), §38 F3 (archivar, borrado lógico, restaurar,
-- duplicar, mover categoría, búsqueda del panel), §23 (búsqueda).
--
-- Todas exigen AAL2 + permiso de tienda (has_store_permission). Un producto o
-- categoría de otra tienda responde not_found (no revela existencia).
-- Errores de campo: P0001 validation_failed + detail = campo (TS → fields).
-- =============================================================================

-- "Café de Olla!" → "cafe-de-olla"
create or replace function app.slugify(p_text text)
returns text
language sql
stable
set search_path = ''
as $$
  select left(trim(both '-' from regexp_replace(lower(extensions.unaccent(coalesce(p_text, ''))),
                                                '[^a-z0-9]+', '-', 'g')), 120)
$$;
revoke all on function app.slugify(text) from public;

create or replace function app.require_store_permission(p_store_id uuid, p_permission text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_aal2_user();
begin
  if not app.has_store_permission(p_store_id, p_permission) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  return v_uid;
end
$$;
revoke all on function app.require_store_permission(uuid, text) from public;

-- Producto vivo de la tienda, bloqueado; si no existe en ESA tienda: not_found.
create or replace function app.lock_product(p_store_id uuid, p_product_id uuid, p_include_deleted boolean default false)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.products;
begin
  select * into v from public.products p
   where p.id = p_product_id and p.store_id = p_store_id and (p_include_deleted or p.deleted_at is null)
   for update;
  if v.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'product';
  end if;
  return v;
end
$$;
revoke all on function app.lock_product(uuid, uuid, boolean) from public;

-- -----------------------------------------------------------------------------
-- Validación de publicación (§14.3). Devuelve errores (bloquean) y advertencias.
-- Punto de extensión: validadores adicionales se agregan aquí por tienda.
-- -----------------------------------------------------------------------------
create or replace function app.validate_product_for_publish(p_product_id uuid)
returns table (code text, level text)
language sql
stable
security definer
set search_path = ''
as $$
  with p as (select * from public.products where id = p_product_id),
  v as (select * from public.product_variants where product_id = p_product_id and deleted_at is null)
  select 'title_missing', 'error' from p where char_length(btrim(p.title)) = 0
  union all
  select 'no_active_variant', 'error' where not exists (select 1 from v where v.status = 'active')
  union all
  select 'price_zero', 'error' where exists (select 1 from v where v.status = 'active' and v.price = 0)
  union all
  select 'compare_at_price_invalid', 'error'
   where exists (select 1 from v where v.compare_at_price is not null and v.compare_at_price <= v.price)
  union all
  select 'product_type_not_supported', 'error' from p where p.product_type <> 'physical'
  union all
  select 'image_alt_missing', 'warning'
   where exists (select 1 from public.media m where m.product_id = p_product_id and m.deleted_at is null
                   and m.status = 'ready' and coalesce(btrim(m.alt_text), '') = '')
$$;
revoke all on function app.validate_product_for_publish(uuid) from public;

-- -----------------------------------------------------------------------------
-- Alta o edición de un producto completo (§14.1). Ver contrato JSON en
-- src/server/catalog/product-input.ts.
-- -----------------------------------------------------------------------------
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
             specs = coalesce(p_product -> 'specs', '{}'::jsonb),
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
           status, track_inventory, inventory_policy, requires_shipping, position, option_signature)
        values
          (p_store_id, v_product_id, v_var ->> 'sku', nullif(v_var ->> 'barcode', ''), (v_var ->> 'price')::bigint,
           (v_var ->> 'compare_at_price')::bigint, (v_var ->> 'weight_g')::integer, (v_var ->> 'length_mm')::integer,
           (v_var ->> 'width_mm')::integer, (v_var ->> 'height_mm')::integer,
           coalesce(v_var ->> 'status', 'active'), coalesce((v_var ->> 'track_inventory')::boolean, true),
           coalesce(v_var ->> 'inventory_policy', 'deny'), coalesce((v_var ->> 'requires_shipping')::boolean, true),
           coalesce((v_var ->> 'position')::integer, 0), v_sig)
        returning id into v_var_id;
      else
        update public.product_variants
           set sku = v_var ->> 'sku', barcode = nullif(v_var ->> 'barcode', ''),
               price = (v_var ->> 'price')::bigint, compare_at_price = (v_var ->> 'compare_at_price')::bigint,
               weight_g = (v_var ->> 'weight_g')::integer, length_mm = (v_var ->> 'length_mm')::integer,
               width_mm = (v_var ->> 'width_mm')::integer, height_mm = (v_var ->> 'height_mm')::integer,
               status = coalesce(v_var ->> 'status', 'active'),
               track_inventory = coalesce((v_var ->> 'track_inventory')::boolean, true),
               inventory_policy = coalesce(v_var ->> 'inventory_policy', 'deny'),
               requires_shipping = coalesce((v_var ->> 'requires_shipping')::boolean, true),
               position = coalesce((v_var ->> 'position')::integer, 0), option_signature = v_sig
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

-- -----------------------------------------------------------------------------
-- Publicar, despublicar/archivar, borrar, restaurar, duplicar
-- -----------------------------------------------------------------------------
create or replace function public.catalog_validate_product(p_store_id uuid, p_product_id uuid)
returns table (code text, level text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'products.read');
  if not exists (select 1 from public.products p where p.id = p_product_id and p.store_id = p_store_id
                   and p.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'product';
  end if;
  return query select * from app.validate_product_for_publish(p_product_id);
end
$$;

create or replace function public.catalog_publish_product(p_store_id uuid, p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_errors  text;
begin
  perform app.require_store_permission(p_store_id, 'products.publish');
  v_product := app.lock_product(p_store_id, p_product_id);
  select string_agg(v.code, ',') into v_errors
    from app.validate_product_for_publish(p_product_id) v where v.level = 'error';
  if v_errors is not null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'publish', hint = v_errors;
  end if;
  update public.products set status = 'active', published_at = coalesce(published_at, now()) where id = p_product_id;
  perform audit.record('product.published', 'product', p_product_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('status', v_product.status), jsonb_build_object('status', 'active'));
end
$$;

-- draft (despublicar) o archived. Publicar solo con catalog_publish_product.
create or replace function public.catalog_set_product_status(p_store_id uuid, p_product_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
begin
  perform app.require_store_permission(p_store_id, 'products.publish');
  if p_status is null or p_status not in ('draft', 'archived') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
  v_product := app.lock_product(p_store_id, p_product_id);
  if v_product.status = p_status then
    return;
  end if;
  update public.products set status = p_status where id = p_product_id;
  perform audit.record(case p_status when 'archived' then 'product.archived' else 'product.unpublished' end,
                       'product', p_product_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('status', v_product.status), jsonb_build_object('status', p_status));
end
$$;

create or replace function public.catalog_soft_delete_product(p_store_id uuid, p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'products.delete');
  perform app.lock_product(p_store_id, p_product_id);
  update public.products set deleted_at = now(), status = 'archived' where id = p_product_id;
  perform audit.record('product.deleted', 'product', p_product_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, null);
end
$$;

-- Restaurar: vuelve como borrador. Falla si su slug ya lo usa otro producto.
create or replace function public.catalog_restore_product(p_store_id uuid, p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
begin
  perform app.require_store_permission(p_store_id, 'products.delete');
  v_product := app.lock_product(p_store_id, p_product_id, true);
  if v_product.deleted_at is null then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'not_deleted';
  end if;
  begin
    update public.products set deleted_at = null, status = 'draft' where id = p_product_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'slug';
  end;
  perform audit.record('product.restored', 'product', p_product_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, null);
end
$$;

-- Duplicar: borrador con slug "-copia[-n]", mismas opciones, variantes (sin SKU ni
-- código de barras: son únicos), categorías y costos si se pueden leer. Sin medios.
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
       track_inventory, inventory_policy, requires_shipping, position, option_signature)
    values (p_store_id, v_new, v_row.price, v_row.compare_at_price, v_row.weight_g, v_row.length_mm, v_row.width_mm,
            v_row.height_mm, v_row.status, v_row.track_inventory, v_row.inventory_policy, v_row.requires_shipping,
            v_row.position, v_row.option_signature)
    returning id into v_id;
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

  perform audit.record('product.duplicated', 'product', v_new,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('source', p_product_id));
  return jsonb_build_object('id', v_new, 'slug', v_slug);
end
$$;

-- -----------------------------------------------------------------------------
-- Categorías y marcas
-- -----------------------------------------------------------------------------
create or replace function public.catalog_upsert_category(p_store_id uuid, p_category jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid := nullif(p_category ->> 'id', '')::uuid;
  v_parent uuid := nullif(p_category ->> 'parent_id', '')::uuid;
  v_slug   text := coalesce(nullif(btrim(p_category ->> 'slug'), ''), app.slugify(p_category ->> 'name'));
  v_msg    text;
begin
  perform app.require_store_permission(p_store_id, 'categories.manage');
  if coalesce(char_length(btrim(p_category ->> 'name')), 0) not between 1 and 120 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'name';
  end if;
  if not app.slug_valid(v_slug) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'slug';
  end if;
  if v_parent is not null and not exists (select 1 from public.categories c where c.store_id = p_store_id
                                            and c.id = v_parent and c.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'parent_id';
  end if;
  if v_id is not null and not exists (select 1 from public.categories c where c.store_id = p_store_id
                                        and c.id = v_id and c.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'category';
  end if;
  begin
    if v_id is null then
      insert into public.categories (store_id, parent_id, name, slug, description, is_visible, position)
      values (p_store_id, v_parent, btrim(p_category ->> 'name'), v_slug, nullif(p_category ->> 'description', ''),
              coalesce((p_category ->> 'is_visible')::boolean, true), coalesce((p_category ->> 'position')::integer, 0))
      returning id into v_id;
    else
      update public.categories
         set parent_id = v_parent, name = btrim(p_category ->> 'name'), slug = v_slug,
             description = nullif(p_category ->> 'description', ''),
             is_visible = coalesce((p_category ->> 'is_visible')::boolean, true),
             position = coalesce((p_category ->> 'position')::integer, 0)
       where id = v_id;
    end if;
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'slug';
    when check_violation then
      get stacked diagnostics v_msg = message_text;
      raise exception using errcode = 'P0001', message = 'validation_failed',
        detail = case v_msg when 'category_cycle' then 'parent_id' when 'category_too_deep' then 'parent_id'
                            else 'name' end;
  end;
  perform audit.record('category.saved', 'category', v_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('name', btrim(p_category ->> 'name'), 'parent_id', v_parent));
  return v_id;
end
$$;

-- Mover una rama (cambia el padre; el path de los descendientes se recalcula).
create or replace function public.catalog_move_category(p_store_id uuid, p_category_id uuid, p_new_parent_id uuid,
                                                        p_position integer default 0)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg text;
begin
  perform app.require_store_permission(p_store_id, 'categories.manage');
  if not exists (select 1 from public.categories c where c.store_id = p_store_id and c.id = p_category_id
                   and c.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'category';
  end if;
  if p_new_parent_id is not null and not exists (select 1 from public.categories c where c.store_id = p_store_id
                                                   and c.id = p_new_parent_id and c.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'parent_id';
  end if;
  begin
    update public.categories set parent_id = p_new_parent_id, position = coalesce(p_position, 0)
     where id = p_category_id;
  exception
    when check_violation or unique_violation then
      get stacked diagnostics v_msg = message_text;
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'parent_id', hint = v_msg;
  end;
  perform audit.record('category.moved', 'category', p_category_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('parent_id', p_new_parent_id));
end
$$;

-- Borrado lógico: solo sin subcategorías vivas; sus productos dejan de estar en ella.
create or replace function public.catalog_delete_category(p_store_id uuid, p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'categories.manage');
  if not exists (select 1 from public.categories c where c.store_id = p_store_id and c.id = p_category_id
                   and c.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'category';
  end if;
  if exists (select 1 from public.categories c where c.parent_id = p_category_id and c.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'has_children';
  end if;
  delete from public.product_categories pc where pc.category_id = p_category_id;
  update public.categories set deleted_at = now() where id = p_category_id;
  perform audit.record('category.deleted', 'category', p_category_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, null);
end
$$;

create or replace function public.catalog_upsert_brand(p_store_id uuid, p_brand jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid := nullif(p_brand ->> 'id', '')::uuid;
  v_slug text := coalesce(nullif(btrim(p_brand ->> 'slug'), ''), app.slugify(p_brand ->> 'name'));
begin
  perform app.require_store_permission(p_store_id, 'brands.manage');
  if coalesce(char_length(btrim(p_brand ->> 'name')), 0) not between 1 and 120 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'name';
  end if;
  if not app.slug_valid(v_slug) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'slug';
  end if;
  if v_id is not null and not exists (select 1 from public.brands b where b.store_id = p_store_id and b.id = v_id
                                        and b.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'brand';
  end if;
  begin
    if v_id is null then
      insert into public.brands (store_id, name, slug) values (p_store_id, btrim(p_brand ->> 'name'), v_slug)
      returning id into v_id;
    else
      update public.brands set name = btrim(p_brand ->> 'name'), slug = v_slug where id = v_id;
    end if;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'slug';
  end;
  perform audit.record('brand.saved', 'brand', v_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('name', btrim(p_brand ->> 'name')));
  return v_id;
end
$$;

create or replace function public.catalog_delete_brand(p_store_id uuid, p_brand_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'brands.manage');
  if not exists (select 1 from public.brands b where b.store_id = p_store_id and b.id = p_brand_id
                   and b.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'brand';
  end if;
  update public.products set brand_id = null where store_id = p_store_id and brand_id = p_brand_id;
  update public.brands set deleted_at = now() where id = p_brand_id;
  perform audit.record('brand.deleted', 'brand', p_brand_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, null);
end
$$;

-- -----------------------------------------------------------------------------
-- Búsqueda del panel (§23): FTS + trigram de respaldo + SKU exacto primero.
-- Cursor estable sobre (updated_at desc, id desc). Máximo 100 por página.
-- -----------------------------------------------------------------------------
create or replace function public.catalog_search_products(
  p_store_id    uuid,
  p_query       text default null,
  p_status      text default null,
  p_category_id uuid default null,
  p_deleted     boolean default false,
  p_cursor      jsonb default null,
  p_limit       integer default 50
)
returns table (
  id            uuid,
  title         text,
  slug          text,
  status        text,
  min_price     bigint,
  max_price     bigint,
  variant_count integer,
  updated_at    timestamptz,
  deleted_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q      text := nullif(btrim(coalesce(p_query, '')), '');
  v_tsq    tsquery;
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_c_time timestamptz := (p_cursor ->> 'updated_at')::timestamptz;
  v_c_id   uuid := (p_cursor ->> 'id')::uuid;
begin
  perform app.require_store_permission(p_store_id, 'products.read');
  if p_status is not null and p_status not in ('draft', 'active', 'archived') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
  if v_q is not null then
    v_tsq := websearch_to_tsquery('spanish', extensions.unaccent(v_q));
  end if;
  return query
  select p.id, p.title, p.slug, p.status, p.min_price, p.max_price,
         (select count(*)::integer from public.product_variants pv where pv.product_id = p.id and pv.deleted_at is null),
         p.updated_at, p.deleted_at
    from public.products p
   where p.store_id = p_store_id
     and (case when coalesce(p_deleted, false) then p.deleted_at is not null else p.deleted_at is null end)
     and (p_status is null or p.status = p_status)
     and (p_category_id is null or exists (select 1 from public.product_categories pc
                                           where pc.product_id = p.id and pc.category_id = p_category_id))
     and (v_q is null
          or p.search_vector @@ v_tsq
          or extensions.similarity(p.title, v_q) > 0.3
          or exists (select 1 from public.product_variants pv where pv.product_id = p.id
                       and pv.sku = upper(v_q) and pv.deleted_at is null))
     and (v_c_time is null or (p.updated_at, p.id) < (v_c_time, v_c_id))
   order by
     (v_q is not null and exists (select 1 from public.product_variants pv where pv.product_id = p.id
                                    and pv.sku = upper(v_q) and pv.deleted_at is null)) desc,
     p.updated_at desc, p.id desc
   limit v_limit;
end
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.catalog_upsert_product(uuid, jsonb) from public;
revoke all on function public.catalog_validate_product(uuid, uuid) from public;
revoke all on function public.catalog_publish_product(uuid, uuid) from public;
revoke all on function public.catalog_set_product_status(uuid, uuid, text) from public;
revoke all on function public.catalog_soft_delete_product(uuid, uuid) from public;
revoke all on function public.catalog_restore_product(uuid, uuid) from public;
revoke all on function public.catalog_duplicate_product(uuid, uuid) from public;
revoke all on function public.catalog_upsert_category(uuid, jsonb) from public;
revoke all on function public.catalog_move_category(uuid, uuid, uuid, integer) from public;
revoke all on function public.catalog_delete_category(uuid, uuid) from public;
revoke all on function public.catalog_upsert_brand(uuid, jsonb) from public;
revoke all on function public.catalog_delete_brand(uuid, uuid) from public;
revoke all on function public.catalog_search_products(uuid, text, text, uuid, boolean, jsonb, integer) from public;

grant execute on function public.catalog_upsert_product(uuid, jsonb) to authenticated;
grant execute on function public.catalog_validate_product(uuid, uuid) to authenticated;
grant execute on function public.catalog_publish_product(uuid, uuid) to authenticated;
grant execute on function public.catalog_set_product_status(uuid, uuid, text) to authenticated;
grant execute on function public.catalog_soft_delete_product(uuid, uuid) to authenticated;
grant execute on function public.catalog_restore_product(uuid, uuid) to authenticated;
grant execute on function public.catalog_duplicate_product(uuid, uuid) to authenticated;
grant execute on function public.catalog_upsert_category(uuid, jsonb) to authenticated;
grant execute on function public.catalog_move_category(uuid, uuid, uuid, integer) to authenticated;
grant execute on function public.catalog_delete_category(uuid, uuid) to authenticated;
grant execute on function public.catalog_upsert_brand(uuid, jsonb) to authenticated;
grant execute on function public.catalog_delete_brand(uuid, uuid) to authenticated;
grant execute on function public.catalog_search_products(uuid, text, text, uuid, boolean, jsonb, integer) to authenticated;
