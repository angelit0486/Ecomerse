-- =============================================================================
-- Gate F3 · Correcciones de la revisión de código de la Fase 3
-- Redefine (forward-only, misma firma y grants) tres RPC del catálogo:
--   * catalog_upsert_product: retira las variantes que ya no vienen ANTES de crear
--     las nuevas (un SKU puede pasar de una a otra) y conserva los campos que el
--     payload no trae (peso, medidas, inventario, specs).
--   * catalog_upsert_category: sin slug explícito conserva la dirección; conserva
--     descripción, posición y visibilidad si no se envían.
--   * catalog_search_products: el SKU exacto solo encabeza la primera página
--     (antes se repetía en cada página del cursor).
-- Y de la revisión de seguridad:
--   * un producto publicado no puede editarse a un estado no publicable;
--   * el worker recibe el tamaño declarado (cuota storage_mb) para rechazar
--     originales más grandes;
--   * la purga ignora objetos con nombres ajenos al esquema de rutas;
--   * límites en la base para etiquetas y specs (la Data API no pasa por Zod);
--   * varias llamadas a catalog_upsert_product en una transacción funcionan.
-- =============================================================================

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
         set parent_id = v_parent, name = btrim(p_category ->> 'name'),
             -- Sin slug explícito se conserva la dirección (renombrar no rompe enlaces).
             slug = case when nullif(btrim(p_category ->> 'slug'), '') is null then slug else v_slug end,
             description = case when p_category ? 'description'
                                then nullif(p_category ->> 'description', '') else description end,
             is_visible = case when p_category ? 'is_visible'
                               then coalesce((p_category ->> 'is_visible')::boolean, true) else is_visible end,
             position = case when p_category ? 'position'
                             then coalesce((p_category ->> 'position')::integer, 0) else position end
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
     -- El producto con el SKU exacto va primero solo en la primera página.
     and (v_c_time is null or v_q is null or not exists (
            select 1 from public.product_variants pv where pv.product_id = p.id
               and pv.sku = upper(v_q) and pv.deleted_at is null))
   order by
     (v_q is not null and exists (select 1 from public.product_variants pv where pv.product_id = p.id
                                    and pv.sku = upper(v_q) and pv.deleted_at is null)) desc,
     p.updated_at desc, p.id desc
   limit v_limit;
end
$$;

-- -----------------------------------------------------------------------------
-- Worker: tamaño declarado al reservar (la cuota se comprobó con él).
-- -----------------------------------------------------------------------------
drop function system.media_for_processing(uuid);
create function system.media_for_processing(p_media_id uuid)
returns table (store_id uuid, storage_path text, mime_type text, owner_type text, max_bytes bigint,
               declared_bytes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select m.store_id, m.storage_path, m.mime_type, m.owner_type, app.media_max_bytes(m.owner_type), m.bytes
    from public.media m
   where m.id = p_media_id and m.status = 'pending' and m.deleted_at is null
     and split_part(m.storage_path, '/', 1) = m.store_id::text
$$;
revoke all on function system.media_for_processing(uuid) from public;
grant execute on function system.media_for_processing(uuid) to system_worker;

-- -----------------------------------------------------------------------------
-- Purga: solo objetos con el prefijo {store_id}/ (un objeto ajeno no ocupa el lote).
-- -----------------------------------------------------------------------------
create or replace function system.media_purge_candidates(p_limit integer default 200)
returns table (kind text, bucket text, path text, media_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  (select 'expired_pending', 'store-uploads', m.storage_path, m.id
     from public.media m
    where m.status = 'pending' and m.created_at < now() - interval '24 hours'
    order by m.created_at limit p_limit)
  union all
  (select 'stale_upload', 'store-uploads', o.name, null::uuid
     from storage.objects o
    where o.bucket_id = 'store-uploads' and o.created_at < now() - interval '24 hours'
      and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' and char_length(o.name) <= 500
      and not exists (select 1 from public.media m
                       where m.storage_path = o.name and m.status = 'pending')
    order by o.created_at limit p_limit)
  union all
  (select 'orphan_media', 'store-media', o.name, null::uuid
     from storage.objects o
    where o.bucket_id = 'store-media' and o.created_at < now() - interval '48 hours'
      and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' and char_length(o.name) <= 500
      and not exists (select 1 from public.media m
                       where m.storage_path = o.name and m.status = 'ready'
                         and (m.deleted_at is null or m.deleted_at > now() - interval '7 days'))
    order by o.created_at limit p_limit)
  union all
  (select 'deleted_media', 'store-media', m.storage_path, m.id
     from public.media m
    where m.deleted_at < now() - interval '7 days'
    order by m.deleted_at limit p_limit)
$$;

-- -----------------------------------------------------------------------------
-- Límites de etiquetas y specs en la base (Zod no protege la Data API).
-- -----------------------------------------------------------------------------
create or replace function app.product_tags_valid(p_tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(char_length(t) between 1 and 60), true) from unnest(p_tags) t
$$;
revoke all on function app.product_tags_valid(text[]) from public;

alter table public.products
  add constraint products_tags_valid check (app.product_tags_valid(tags)),
  add constraint products_specs_size check (octet_length(specs::text) <= 16384);
