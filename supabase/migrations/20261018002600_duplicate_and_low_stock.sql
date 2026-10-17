-- =============================================================================
-- Panel de productos, tanda 5.
--
-- 1. catalog_duplicate_product copia todo lo que define al producto: además de
--    lo de antes, el contenido y las porciones por presentación (ADR-026), la
--    ficha sanitaria, los atributos y las fotos (medios nuevos que el worker
--    copia y vuelve a procesar: media.copy), con la foto de cada presentación.
-- 2. Pocas existencias: catalog_list_extras cuenta las presentaciones con
--   existencias en o bajo su mínimo, y el filtro «pocas_existencias». Los
--   filtros de existencias exigen inventory.read, como la columna.
-- =============================================================================

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
    values (p_store_id, v_new, v_row.price, v_row.compare_at_price, v_row.weight_g, v_row.length_mm, v_row.width_mm,
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

-- Worker: origen y destino de una copia de foto. Todo sale de las filas (el
-- payload solo trae ids): misma tienda, destino pendiente, origen listo.
create or replace function system.media_copy_source(p_media_id uuid, p_source_media_id uuid)
returns table (store_id uuid, source_path text, max_bytes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select s.store_id, s.storage_path, app.media_max_bytes(s.owner_type)
    from public.media t
    join public.media s on s.store_id = t.store_id and s.id = p_source_media_id
   where t.id = p_media_id and t.status = 'pending' and t.deleted_at is null
     and s.status = 'ready' and s.mime_type is not distinct from t.mime_type
     and split_part(s.storage_path, '/', 1) = s.store_id::text
     and split_part(t.storage_path, '/', 1) = t.store_id::text
$$;
revoke all on function system.media_copy_source(uuid, uuid) from public;
grant execute on function system.media_copy_source(uuid, uuid) to system_worker;

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
             -- Con existencias, pero en o bajo el mínimo de su ubicación.
             'low_stock_variants', case when v_stock then (
                 select count(distinct v.id)::integer from public.product_variants v
                   join public.inventory_levels l on l.variant_id = v.id
                   join public.inventory_locations loc on loc.id = l.location_id and loc.is_active
                  where v.product_id = p.id and v.deleted_at is null and v.status = 'active'
                    and v.track_inventory and l.low_stock_threshold is not null
                    and l.available > 0 and l.available <= l.low_stock_threshold) end,
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

create or replace function public.catalog_search_products(
  p_store_id    uuid,
  p_query       text default null,
  p_status      text default null,
  p_category_id uuid default null,
  p_deleted     boolean default false,
  p_cursor      jsonb default null,
  p_limit       integer default 50,
  p_brand_id    uuid default null,
  p_issue       text default null,
  p_sort        text default null
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
  deleted_at    timestamptz,
  sort_key      text
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
  v_sort   text := coalesce(p_sort, 'recientes');
  v_c_id   uuid;
  v_c_time timestamptz;
  v_c_text text;
  v_c_num  bigint;
begin
  perform app.require_store_permission(p_store_id, 'products.read');
  if p_status is not null and p_status not in ('draft', 'active', 'archived') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
  if p_issue is not null and p_issue not in ('agotados', 'sin_foto', 'pocas_existencias') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'issue';
  end if;
  -- Los filtros de existencias revelan inventario: mismo permiso que la columna.
  if p_issue in ('agotados', 'pocas_existencias') then
    perform app.require_store_permission(p_store_id, 'inventory.read');
  end if;
  if v_sort not in ('recientes', 'nombre', 'precio_asc', 'precio_desc') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'sort';
  end if;
  -- Cursor por orden: {id, k} con la clave del orden (fecha, nombre o precio).
  -- Uno con otra forma (p. ej. de otro orden) es un error, nunca una página mezclada.
  if p_cursor is not null then
    begin
      v_c_id := (p_cursor ->> 'id')::uuid;
      case v_sort
        when 'recientes' then v_c_time := coalesce(p_cursor ->> 'k', p_cursor ->> 'updated_at')::timestamptz;
        when 'nombre' then v_c_text := p_cursor ->> 'k';
        else v_c_num := (p_cursor ->> 'k')::bigint;
      end case;
    exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format
                   or numeric_value_out_of_range then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'cursor';
    end;
    if v_c_id is null or (v_c_time is null and v_c_text is null and v_c_num is null) then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'cursor';
    end if;
  end if;
  if v_q is not null then
    v_tsq := websearch_to_tsquery('spanish', extensions.unaccent(v_q));
  end if;
  return query
  select p.id, p.title, p.slug, p.status, p.min_price, p.max_price,
         (select count(*)::integer from public.product_variants pv where pv.product_id = p.id and pv.deleted_at is null),
         p.updated_at, p.deleted_at,
         -- La clave del cursor la calcula la base (mismo lower() que el orden).
         case v_sort when 'recientes' then p.updated_at::text
                     when 'nombre' then lower(p.title)
                     else coalesce(p.min_price, 0)::text end
    from public.products p
   where p.store_id = p_store_id
     and (case when coalesce(p_deleted, false) then p.deleted_at is not null else p.deleted_at is null end)
     and (p_status is null or p.status = p_status)
     and (p_category_id is null or exists (select 1 from public.product_categories pc
                                           where pc.product_id = p.id and pc.category_id = p_category_id))
     and (p_brand_id is null or p.brand_id = p_brand_id)
     -- Sin foto lista: lo primero que hay que resolver para vender.
     and (p_issue is distinct from 'sin_foto' or not exists (
            select 1 from public.media m where m.store_id = p.store_id and m.product_id = p.id
               and m.status = 'ready' and m.deleted_at is null))
     -- Alguna presentación activa sin existencias (y sin venta bajo pedido).
     and (p_issue is distinct from 'agotados' or exists (
            select 1 from public.product_variants v
             where v.product_id = p.id and v.deleted_at is null and v.status = 'active'
               and v.track_inventory and v.inventory_policy = 'deny'
               and coalesce((select sum(l.available) from public.inventory_levels l
                               join public.inventory_locations loc on loc.id = l.location_id and loc.is_active
                              where l.variant_id = v.id), 0) <= 0))
     and (p_issue is distinct from 'pocas_existencias' or exists (
            select 1 from public.product_variants v
              join public.inventory_levels l on l.variant_id = v.id
              join public.inventory_locations loc on loc.id = l.location_id and loc.is_active
             where v.product_id = p.id and v.deleted_at is null and v.status = 'active'
               and v.track_inventory and l.low_stock_threshold is not null
               and l.available > 0 and l.available <= l.low_stock_threshold))
     and (v_q is null
          or p.search_vector @@ v_tsq
          or extensions.similarity(p.title, v_q) > 0.3
          or exists (select 1 from public.product_variants pv where pv.product_id = p.id
                       and pv.sku = upper(v_q) and pv.deleted_at is null))
     and (v_c_id is null
          or v_sort = 'recientes' and (p.updated_at, p.id) < (v_c_time, v_c_id)
          or v_sort = 'nombre' and (lower(p.title), p.id) > (v_c_text, v_c_id)
          or v_sort = 'precio_asc' and (coalesce(p.min_price, 0), p.id) > (v_c_num, v_c_id)
          or v_sort = 'precio_desc' and (coalesce(p.min_price, 0), p.id) < (v_c_num, v_c_id))
     -- El producto con el SKU exacto va primero solo en la primera página.
     and (v_c_id is null or v_q is null or not exists (
            select 1 from public.product_variants pv where pv.product_id = p.id
               and pv.sku = upper(v_q) and pv.deleted_at is null))
   order by
     (v_q is not null and exists (select 1 from public.product_variants pv where pv.product_id = p.id
                                    and pv.sku = upper(v_q) and pv.deleted_at is null)) desc,
     case when v_sort = 'recientes' then p.updated_at end desc,
     case when v_sort = 'nombre' then lower(p.title) end asc,
     case when v_sort = 'precio_asc' then coalesce(p.min_price, 0) end asc,
     case when v_sort = 'precio_desc' then coalesce(p.min_price, 0) end desc,
     case when v_sort in ('nombre', 'precio_asc') then p.id end asc,
     case when v_sort in ('recientes', 'precio_desc') then p.id end desc
   limit v_limit;
end
$$;
