-- =============================================================================
-- ADR-026 punto 2 · Contenido neto y porciones por presentación en el CSV.
--
-- Columnas `variant_net_content` y `variant_servings` (ausente = sin cambios;
-- vacía = vale el dato del producto), con exportación simétrica. Las tres
-- funciones son las de 20261018000300 con solo esto agregado:
-- 1. import_resolve: valida por fila y pasa los datos a la variante del payload
--    de catalog_upsert_product (que ya los guarda: 20261018001800).
-- 2. imports_create: acepta las dos columnas.
-- 3. exports_rows: las incluye en cada fila de productos.
-- =============================================================================

-- La plantilla completa pasa de 41 a 43 columnas: el límite de import_jobs
-- (40, de la Fase 8) ya no alcanzaba para un archivo con todas las columnas.
alter table public.import_jobs drop constraint import_jobs_columns_check;
alter table public.import_jobs add constraint import_jobs_columns_check check (cardinality(columns) <= 60);

-- -----------------------------------------------------------------------------
-- 1. Resolución de una fila
-- -----------------------------------------------------------------------------
create or replace function app.import_resolve(p_store_id uuid, p_mode text, p_n jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_res    jsonb := app.import_resolve_base(p_store_id, p_mode, p_n);
  v_x      jsonb := app.import_resolve_extras(p_store_id, p_n, (v_res ->> 'product_id')::uuid,
                                              (v_res ->> 'first_row')::integer);
  v_vars   jsonb := coalesce(v_res #> '{payload,variants}', '[]'::jsonb);
  v_errors jsonb := '[]'::jsonb;
  v_nv     jsonb;
  v_idx    integer;
  v_costs  boolean := false;  -- alguna fila trae datos propios de la variante
  v_extra  jsonb;
begin
  for v_nv in select x from jsonb_array_elements(coalesce(p_n -> 'variants', '[]'::jsonb)) x
              where x ?| array['cost', 'net_content', 'servings_per_container'] loop
    v_costs := true;
    v_extra := '{}'::jsonb;
    if v_nv ? 'cost' then
      if jsonb_typeof(v_nv -> 'cost') <> 'null'
         and (jsonb_typeof(v_nv -> 'cost') <> 'number' or (v_nv ->> 'cost') !~ '^[0-9]{1,12}$') then
        v_errors := v_errors || jsonb_build_object('row', (v_nv ->> 'row_number')::integer,
                                                   'message', 'cost: escribe un importe como 199.50');
        continue;
      end if;
      v_extra := v_extra || jsonb_build_object('cost', v_nv -> 'cost');
    end if;
    -- ADR-026: contenido y porciones de la presentación (null = vale el del producto).
    if v_nv ? 'net_content' then
      if jsonb_typeof(v_nv -> 'net_content') <> 'null'
         and (jsonb_typeof(v_nv -> 'net_content') <> 'string'
              or char_length(btrim(v_nv ->> 'net_content')) not between 1 and 100) then
        v_errors := v_errors || jsonb_build_object('row', (v_nv ->> 'row_number')::integer,
                                                   'message', 'variant_net_content: máximo 100 caracteres');
        continue;
      end if;
      v_extra := v_extra || jsonb_build_object('net_content', v_nv -> 'net_content');
    end if;
    if v_nv ? 'servings_per_container' then
      if jsonb_typeof(v_nv -> 'servings_per_container') <> 'null'
         and (jsonb_typeof(v_nv -> 'servings_per_container') <> 'number'
              or (v_nv ->> 'servings_per_container') !~ '^[0-9]{1,5}$'
              or (v_nv ->> 'servings_per_container')::integer not between 1 and 10000) then
        v_errors := v_errors || jsonb_build_object('row', (v_nv ->> 'row_number')::integer,
                     'message', 'variant_servings: escribe un número entero entre 1 y 10000');
        continue;
      end if;
      v_extra := v_extra || jsonb_build_object('servings_per_container', v_nv -> 'servings_per_container');
    end if;
    -- La variante del payload que corresponde a la fila: por SKU o, sin SKU, por opciones.
    select t.o - 1 into v_idx
      from jsonb_array_elements(v_vars) with ordinality t(x, o)
     where case when nullif(v_nv ->> 'sku', '') is not null
                then upper(t.x ->> 'sku') = upper(v_nv ->> 'sku')
                else app.import_options_key(coalesce(t.x -> 'options', '{}'::jsonb))
                     = app.import_options_key(coalesce(v_nv -> 'options', '{}'::jsonb)) end
     order by t.o
     limit 1;
    if v_idx is not null then
      v_vars := jsonb_set(v_vars, array[v_idx::text], (v_vars -> v_idx) || v_extra);
    end if;
  end loop;
  if v_costs and v_res ? 'payload' then
    v_res := jsonb_set(v_res, '{payload,variants}', v_vars);
  end if;
  return v_res || (v_x - 'errors')
         || jsonb_build_object('errors', (v_res -> 'errors') || (v_x -> 'errors') || v_errors,
                               'touches_catalog', (v_res ->> 'touches_catalog')::boolean
                                                  or p_n ? 'regulatory' or p_n ? 'attributes' or v_costs);
end
$$;
revoke all on function app.import_resolve(uuid, text, jsonb) from public;

-- -----------------------------------------------------------------------------
-- 2. Alta de la importación
-- -----------------------------------------------------------------------------
create or replace function public.imports_create(p_store_id uuid, p_mode text, p_file_name text,
                                                 p_columns text[], p_ignored text[], p_rows jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid;
  v_job       uuid;
  v_r         record;
  v_res       jsonb;
  v_n         jsonb;
  v_e         jsonb;
  v_msg       text;
  v_brands    boolean := app.has_store_permission(p_store_id, 'brands.manage');
  v_can_new   boolean := app.has_store_permission(p_store_id, 'products.create');
  v_can_edit  boolean := app.has_store_permission(p_store_id, 'products.update');
  v_can_pub   boolean := app.has_store_permission(p_store_id, 'products.publish');
  v_can_stock boolean := app.has_store_permission(p_store_id, 'inventory.adjust');
  v_can_cost  boolean := app.has_store_permission(p_store_id, 'products.cost.read');
  v_has_cost  boolean;
  v_cat       text;
  v_needs     text[] := array['imports.run'];
  v_known     constant text[] := array['handle', 'title', 'status', 'description', 'brand', 'categories', 'tags',
    'option1_name', 'option1_value', 'option2_name', 'option2_value', 'option3_name', 'option3_value',
    'sku', 'barcode', 'price', 'compare_at_price', 'inventory_quantity', 'inventory_policy',
    'requires_shipping', 'weight_g', 'length_mm', 'width_mm', 'height_mm', 'variant_status',
    'seo_title', 'seo_description',
    -- R-T05
    'regulatory_category', 'regulatory_form', 'regulatory_serving_size', 'regulatory_servings_per_container',
    'regulatory_ingredients', 'regulatory_nutrition', 'regulatory_usage', 'regulatory_warnings',
    'regulatory_storage', 'regulatory_allergens', 'regulatory_sanitary_notice', 'attributes',
    -- Fase A
    'regulatory_net_content',
    -- Fase B
    'cost',
    -- ADR-026
    'variant_net_content', 'variant_servings'];
begin
  v_uid := app.require_store_permission(p_store_id, 'imports.run');
  if p_mode is null or p_mode not in ('create_only', 'update_existing', 'upsert') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'mode';
  end if;
  if p_columns is null or not ('handle' = any (p_columns)) or not (p_columns <@ v_known)
     or cardinality(p_columns) <> (select count(distinct c) from unnest(p_columns) c) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'columns';
  end if;
  if coalesce(cardinality(p_ignored), 0) > 50
     or exists (select 1 from unnest(coalesce(p_ignored, '{}')) c where char_length(c) > 100) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'columns';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rows';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'too_many_rows';
  end if;
  -- Forma del plan: lo arma el servidor, pero la base no confía en ella.
  if exists (
    select 1 from jsonb_array_elements(p_rows) x
     where jsonb_typeof(x -> 'row_number') is distinct from 'number'
        or jsonb_typeof(coalesce(x -> 'raw', '{}'::jsonb)) <> 'object'
        or jsonb_typeof(coalesce(x -> 'errors', '[]'::jsonb)) <> 'array'
        or (jsonb_typeof(x -> 'normalized') = 'object'
            and (nullif(x -> 'normalized' ->> 'handle', '') is null
                 or jsonb_typeof(x -> 'normalized' -> 'variants') is distinct from 'array'
                 or jsonb_typeof(coalesce(x -> 'normalized' -> 'product', '{}'::jsonb)) <> 'object'
                 or jsonb_typeof(coalesce(x -> 'normalized' -> 'categories', '[]'::jsonb)) <> 'array'
                 or jsonb_typeof(coalesce(x -> 'normalized' -> 'regulatory', '{}'::jsonb)) <> 'object'
                 or jsonb_typeof(coalesce(x -> 'normalized' -> 'attributes', '{}'::jsonb)) <> 'object'))
        or coalesce(jsonb_typeof(x -> 'normalized'), 'null') not in ('object', 'null')
        or octet_length(coalesce(x -> 'normalized', 'null'::jsonb)::text) > 262144
  ) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rows';
  end if;

  insert into public.import_jobs (store_id, type, mode, status, file_name, requested_by, columns, ignored_columns)
  values (p_store_id, 'products', p_mode, 'validating', left(btrim(coalesce(nullif(p_file_name, ''), 'archivo.csv')), 200),
          v_uid, p_columns, coalesce(p_ignored, '{}'))
  returning id into v_job;

  begin
    insert into public.import_job_rows (store_id, import_job_id, row_number, raw, normalized, errors)
    select p_store_id, v_job, (x ->> 'row_number')::integer,
           -- Solo las columnas de la plantilla (lo ignorado no se guarda).
           (select coalesce(jsonb_object_agg(e.key, left(e.value, 10000)), '{}'::jsonb)
              from jsonb_each_text(coalesce(x -> 'raw', '{}'::jsonb)) e where e.key = any (p_columns)),
           nullif(x -> 'normalized', 'null'::jsonb),
           (select coalesce(jsonb_agg(left(e, 300)), '[]'::jsonb)
              from jsonb_array_elements_text(coalesce(x -> 'errors', '[]'::jsonb)) e)
      from jsonb_array_elements(p_rows) x;
  exception when unique_violation or check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rows';
  end;

  for v_r in
    select r.id, r.row_number, r.normalized from public.import_job_rows r
     where r.import_job_id = v_job and r.normalized is not null order by r.row_number
  loop
    v_n := v_r.normalized;
    v_res := app.import_resolve(p_store_id, p_mode, v_n);
    -- Los permisos que exigirá la confirmación, avisados por fila desde ya (el worker los revalida).
    if v_res ->> 'action' = 'create' and not v_can_new
       or v_res ->> 'action' = 'update' and (v_res ->> 'touches_catalog')::boolean and not v_can_edit then
      v_res := jsonb_set(v_res, '{errors}', (v_res -> 'errors') || jsonb_build_object('row', v_r.row_number,
                 'message', 'handle: tu rol no puede crear o editar productos (solo existencias)'));
    end if;
    v_needs := v_needs
      || case when v_res ->> 'action' = 'create' then array['products.create'] else '{}' end
      || case when v_res ->> 'action' = 'update' and (v_res ->> 'touches_catalog')::boolean
              then array['products.update'] else '{}' end
      || case when v_n ? 'status' then array['products.publish'] else '{}' end
      -- La ficha y los atributos se guardan con las RPC del panel (products.update).
      || case when v_n ? 'regulatory' or v_n ? 'attributes' then array['products.update'] else '{}' end
      || case when jsonb_array_length(v_res -> 'targets') > 0 then array['inventory.adjust'] else '{}' end
      || case when nullif(btrim(v_n ->> 'brand'), '') is not null
                   and not exists (select 1 from public.brands b where b.store_id = p_store_id and b.deleted_at is null
                                                                  and lower(b.name) = lower(btrim(v_n ->> 'brand')))
              then array['brands.manage'] else '{}' end;
    -- Fase B: el costo se guarda con catalog_upsert_product, que exige products.cost.read.
    v_has_cost := exists (select 1 from jsonb_array_elements(coalesce(v_n -> 'variants', '[]'::jsonb)) x
                           where x ? 'cost');
    if v_has_cost then
      v_needs := v_needs || array['products.cost.read', 'products.update'];
      if not v_can_cost then
        v_res := jsonb_set(v_res, '{errors}', (v_res -> 'errors') || jsonb_build_object('row', v_r.row_number,
                   'message', 'cost: tu rol no puede ver ni cambiar costos'));
      end if;
    end if;
    if (v_n ? 'regulatory' or v_n ? 'attributes') and not v_can_edit then
      v_res := jsonb_set(v_res, '{errors}', (v_res -> 'errors') || jsonb_build_object('row', v_r.row_number,
                 'message', 'regulatory_category: tu rol no puede editar la ficha ni los atributos'));
    end if;
    if v_n ? 'status' and not v_can_pub then
      v_res := jsonb_set(v_res, '{errors}', (v_res -> 'errors') || jsonb_build_object('row', v_r.row_number,
                 'message', 'status: tu rol no puede publicar ni despublicar productos'));
    end if;
    if jsonb_array_length(v_res -> 'targets') > 0 and not v_can_stock then
      v_res := jsonb_set(v_res, '{errors}', (v_res -> 'errors') || jsonb_build_object('row', v_r.row_number,
                 'message', 'inventory_quantity: tu rol no puede ajustar existencias'));
    end if;
    if nullif(btrim(v_n ->> 'brand'), '') is not null and not v_brands
       and not exists (select 1 from public.brands b where b.store_id = p_store_id and b.deleted_at is null
                                                     and lower(b.name) = lower(btrim(v_n ->> 'brand'))) then
      v_res := jsonb_set(v_res, '{errors}', (v_res -> 'errors') || jsonb_build_object('row', v_r.row_number,
                 'message', 'brand: no existe y tu rol no puede crear marcas'));
    end if;
    for v_cat in select c #>> '{}' from jsonb_array_elements(coalesce(v_n -> 'categories', '[]'::jsonb)) c
                  where jsonb_typeof(c) = 'string' and nullif(btrim(c #>> '{}'), '') is not null loop
      if app.category_by_path(p_store_id, v_cat) is null then
        v_res := jsonb_set(v_res, '{errors}', (v_res -> 'errors') || jsonb_build_object('row', v_r.row_number,
                   'message', format('categories: no existe la categoría %s', left(v_cat, 200))));
      end if;
    end loop;

    update public.import_job_rows set action = v_res ->> 'action' where id = v_r.id;
    for v_e in select * from jsonb_array_elements(v_res -> 'errors') loop
      -- Un número de fila ajeno al archivo se anota en la fila del producto.
      update public.import_job_rows r
         set errors = r.errors || to_jsonb(left(v_e ->> 'message', 300))
       where r.import_job_id = v_job
         and r.row_number = coalesce((select r2.row_number from public.import_job_rows r2
                                       where r2.import_job_id = v_job and r2.row_number = (v_e ->> 'row')::integer),
                                     v_r.row_number);
    end loop;
  end loop;

  update public.import_job_rows set action = 'error' where import_job_id = v_job and jsonb_array_length(errors) > 0;
  update public.import_jobs j
     set status = 'validated',
         needs = (select array_agg(distinct n order by n) from unnest(v_needs) n),
         totals = (select jsonb_build_object(
                     'rows', count(*),
                     'products', count(*) filter (where r.normalized is not null),
                     'create', count(*) filter (where r.action = 'create'),
                     'update', count(*) filter (where r.action = 'update'),
                     'errors', count(*) filter (where r.action = 'error'))
                     from public.import_job_rows r where r.import_job_id = v_job)
   where j.id = v_job;
  perform audit.record('import.requested', 'import_job', v_job,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, (select jsonb_build_object('type', 'products', 'mode', p_mode, 'file', j.file_name)
                                     || j.totals || jsonb_build_object('ignored_columns', to_jsonb(j.ignored_columns))
                                from public.import_jobs j where j.id = v_job));
  return v_job;
end
$$;
revoke all on function public.imports_create(uuid, text, text, text[], text[], jsonb) from public;
grant execute on function public.imports_create(uuid, text, text, text[], text[], jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Exportación
-- -----------------------------------------------------------------------------
create or replace function public.exports_rows(p_store_id uuid, p_entity text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pii   boolean;
  v_inv   boolean;
  v_cost  boolean;
  v_count integer;
  v_rows  jsonb;
  v_max   constant integer := 5000;
begin
  perform app.require_store_permission(p_store_id, 'exports.run');
  if p_entity is null or p_entity not in ('products', 'inventory', 'orders', 'customers') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'entity';
  end if;
  perform app.require_store_permission(p_store_id, case p_entity
    when 'products' then 'products.read' when 'inventory' then 'inventory.read'
    when 'orders' then 'orders.read' else 'customers.read' end);
  -- APP-M3 (GATE0 §8.3): cada rol exporta su área — catálogo, inventario o pedidos —
  -- y los clientes solo la administración de la tienda (quien puede anonimizarlos).
  perform app.require_store_permission(p_store_id, case p_entity
    when 'products' then 'products.update' when 'inventory' then 'inventory.adjust'
    when 'orders' then 'orders.update' else 'customers.delete' end);
  v_pii := app.has_store_permission(p_store_id, 'customers.pii.read');
  v_inv := app.has_store_permission(p_store_id, 'inventory.read');
  v_cost := app.has_store_permission(p_store_id, 'products.cost.read');

  if p_entity = 'products' then
    select count(*) into v_count from public.product_variants v
      join public.products p on p.store_id = v.store_id and p.id = v.product_id and p.deleted_at is null
     where v.store_id = p_store_id and v.deleted_at is null;
  elsif p_entity = 'inventory' then
    select count(*) into v_count from public.inventory_levels l where l.store_id = p_store_id;
  elsif p_entity = 'orders' then
    select count(*) into v_count from public.orders o where o.store_id = p_store_id;
  else
    select count(*) into v_count from public.customers c where c.store_id = p_store_id and c.deleted_at is null;
  end if;
  if v_count > v_max then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'too_many_rows';
  end if;

  if p_entity = 'products' then
    -- Una fila por variante, con el formato de la futura plantilla de importación.
    select coalesce(jsonb_agg(r order by r ->> 'handle', (r ->> 'position')::integer), '[]'::jsonb) into v_rows
      from (select jsonb_build_object(
              'handle', p.slug, 'title', p.title, 'status', p.status, 'description', p.description_html,
              'brand', b.name,
              'categories', (select string_agg(app.category_name_path(c.store_id, c.id), '|' order by pc.position)
                               from public.product_categories pc
                               join public.categories c on c.store_id = pc.store_id and c.id = pc.category_id
                              where pc.store_id = p.store_id and pc.product_id = p.id),
              'tags', array_to_string(p.tags, '|'),
              'options', (select coalesce(jsonb_agg(jsonb_build_object('name', split_part(kv, '=', 1),
                                                                       'value', split_part(kv, '=', 2))
                                                    order by coalesce(o.position, 99), split_part(kv, '=', 1)), '[]'::jsonb)
                            from regexp_split_to_table(nullif(v.option_signature, ''), '\|') kv
                            left join public.product_options o
                              on o.store_id = p.store_id and o.product_id = p.id and o.name = split_part(kv, '=', 1)),
              'sku', v.sku, 'barcode', v.barcode, 'price', v.price, 'compare_at_price', v.compare_at_price,
              'weight_g', v.weight_g, 'length_mm', v.length_mm, 'width_mm', v.width_mm, 'height_mm', v.height_mm,
              'requires_shipping', v.requires_shipping, 'inventory_policy', v.inventory_policy,
              'variant_status', v.status, 'position', v.position,
              -- ADR-026: contenido y porciones de la presentación.
              'net_content', v.net_content, 'servings_per_container', v.servings_per_container,
              -- Existencias físicas en la ubicación principal (lo que fija la importación).
              'on_hand', case when v_inv then (select l.on_hand from public.inventory_levels l
                                                 join public.inventory_locations loc
                                                   on loc.store_id = l.store_id and loc.id = l.location_id and loc.is_default
                                                where l.store_id = v.store_id and l.variant_id = v.id) end,
              'seo_title', p.seo_title, 'seo_description', p.seo_description,
              -- Fase B: costo unitario, solo con products.cost.read.
              'cost', case when v_cost then (select c.cost from public.variant_costs c
                                               where c.store_id = v.store_id and c.variant_id = v.id) end,
              -- R-T05: ficha sanitaria (null = sin clasificar) y atributos por clave.
              'regulatory', (select jsonb_build_object('category', i.category_key, 'data', i.data)
                               from public.product_regulatory_info i
                              where i.store_id = p.store_id and i.product_id = p.id),
              'attributes', (select coalesce(jsonb_agg(jsonb_build_object('key', x.key, 'values', x.vals)
                                                       order by x.position, x.key), '[]'::jsonb)
                               from (select a.key, a.position,
                                            jsonb_agg(av.key order by av.position, av.key) as vals
                                       from public.product_attribute_values pav
                                       join public.attribute_values av on av.store_id = pav.store_id and av.id = pav.value_id
                                       join public.attributes a on a.store_id = av.store_id and a.id = av.attribute_id
                                      where pav.store_id = p.store_id and pav.product_id = p.id
                                      group by a.id, a.key, a.position) x)) as r
              from public.product_variants v
              join public.products p on p.store_id = v.store_id and p.id = v.product_id and p.deleted_at is null
              left join public.brands b on b.store_id = p.store_id and b.id = p.brand_id
             where v.store_id = p_store_id and v.deleted_at is null) q;
  elsif p_entity = 'inventory' then
    select coalesce(jsonb_agg(r order by r ->> 'title', r ->> 'sku'), '[]'::jsonb) into v_rows
      from (select jsonb_build_object('title', p.title, 'variant', v.option_signature, 'sku', v.sku,
                                      'location', loc.name, 'on_hand', l.on_hand, 'reserved', l.reserved,
                                      'available', l.available, 'low_stock_threshold', l.low_stock_threshold) as r
              from public.inventory_levels l
              join public.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
              join public.products p on p.store_id = v.store_id and p.id = v.product_id
              join public.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id
             where l.store_id = p_store_id) q;
  elsif p_entity = 'orders' then
    select coalesce(jsonb_agg(r order by r ->> 'placed_at' desc), '[]'::jsonb) into v_rows
      from (select jsonb_build_object(
              'number', o.display_number, 'placed_at', o.placed_at, 'status', o.status,
              'payment_status', o.payment_status, 'fulfillment_status', o.fulfillment_status,
              'items', (select sum(i.quantity) from public.order_items i where i.store_id = o.store_id and i.order_id = o.id),
              'subtotal', o.subtotal, 'discount', o.discount_total, 'shipping', o.shipping_total, 'tax', o.tax_total,
              'total', o.total, 'paid', o.paid_total, 'refunded', o.refunded_total, 'currency', o.currency,
              'discount_code', o.discount_snapshot ->> 'code', 'shipping_method', o.shipping_snapshot ->> 'name')
              || case when v_pii then jsonb_build_object(
                   'email', o.email, 'customer_name', o.customer_name, 'phone', o.phone,
                   'city', o.shipping_address ->> 'city', 'region', o.shipping_address ->> 'region',
                   'postal_code', o.shipping_address ->> 'postal_code', 'country', o.shipping_address ->> 'country')
                 else '{}'::jsonb end as r
              from public.orders o where o.store_id = p_store_id) q;
  else
    select coalesce(jsonb_agg(app.customer_admin_view(c, v_pii) - 'id' - 'masked' order by c.created_at desc), '[]'::jsonb)
      into v_rows
      from public.customers c where c.store_id = p_store_id and c.deleted_at is null;
  end if;

  perform audit.record('export.requested', 'store', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('entity', p_entity, 'rows', v_count,
                                                'pii', v_pii and p_entity in ('orders', 'customers'),
                                                'costs', v_cost and p_entity = 'products'));
  -- Columnas opcionales del CSV de productos: solo si la tienda las usa (R-T05).
  return jsonb_build_object('entity', p_entity, 'pii', v_pii, 'rows', v_rows,
    'costs', v_cost and p_entity = 'products',
    'regulated', exists (select 1 from public.store_regulated_categories d where d.store_id = p_store_id)
                 or exists (select 1 from public.product_regulatory_info i
                             where i.store_id = p_store_id and i.category_key is not null),
    'has_attributes', exists (select 1 from public.attributes a where a.store_id = p_store_id));
end
$$;
revoke all on function public.exports_rows(uuid, text) from public;
grant execute on function public.exports_rows(uuid, text) to authenticated;
