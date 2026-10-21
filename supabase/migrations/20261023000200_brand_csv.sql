-- =============================================================================
-- Importación CSV: logo y descripción de la marca (misión Portada/Marcas,
-- Paso 2). Columnas opcionales `brand_logo_url` (https) y `brand_description`
-- en el CSV de productos; requieren la columna `brand` y el permiso de marcas.
--
-- 1. imports_create: acepta y valida `normalized.brand_profile` (la base no
--    confía en el plan del servidor).
-- 2. system.import_apply_brand_profiles: en la misma transacción del job,
--    después de import_commit, guarda la descripción y reserva el logo como
--    medio de marca pendiente con `source_url`; el worker lo descarga con los
--    controles de SSRF (ADR-033) y lo procesa como siempre (§25.3).
-- =============================================================================

create or replace function public.imports_create(p_store_id uuid, p_mode text, p_file_name text, p_columns text[], p_ignored text[], p_rows jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
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
    'variant_net_content', 'variant_servings',
    -- ADR-033
    'image_urls',
    -- Misión Portada/Marcas: logo (enlace https) y descripción de la marca.
    'brand_logo_url', 'brand_description'];
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
                 or jsonb_typeof(coalesce(x -> 'normalized' -> 'attributes', '{}'::jsonb)) <> 'object'
                 -- ADR-033: hasta 10 enlaces https por producto.
                 or jsonb_typeof(coalesce(x -> 'normalized' -> 'images', '[]'::jsonb)) <> 'array'
                 or jsonb_array_length(coalesce(x -> 'normalized' -> 'images', '[]'::jsonb)) > 10
                 or exists (select 1 from jsonb_array_elements(coalesce(x -> 'normalized' -> 'images', '[]'::jsonb)) u
                             where jsonb_typeof(u) <> 'string'
                                or char_length(u #>> '{}') > 2000
                                or (u #>> '{}') !~ '^https://[^/@\s]+(/[^\s]*)?$')
                 -- Perfil de la marca: solo con la marca, logo https y descripción ≤ 1000.
                 or (x -> 'normalized' ? 'brand_profile'
                     and (jsonb_typeof(x -> 'normalized' -> 'brand_profile') <> 'object'
                          or nullif(btrim(x -> 'normalized' ->> 'brand'), '') is null
                          or not (x -> 'normalized' -> 'brand_profile' ?| array['logo_url', 'description'])
                          or exists (select 1 from jsonb_object_keys(x -> 'normalized' -> 'brand_profile') k
                                      where k not in ('logo_url', 'description'))
                          or (x -> 'normalized' -> 'brand_profile' ? 'logo_url'
                              and (jsonb_typeof(x -> 'normalized' -> 'brand_profile' -> 'logo_url') <> 'string'
                                   or char_length(x -> 'normalized' -> 'brand_profile' ->> 'logo_url') > 2000
                                   or (x -> 'normalized' -> 'brand_profile' ->> 'logo_url')
                                        !~ '^https://[^/@\s]+(/[^\s]*)?$'))
                          or (x -> 'normalized' -> 'brand_profile' ? 'description'
                              and (jsonb_typeof(x -> 'normalized' -> 'brand_profile' -> 'description') <> 'string'
                                   or char_length(x -> 'normalized' -> 'brand_profile' ->> 'description')
                                        not between 1 and 1000))))))
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
      -- ADR-033: las fotos de producto exigen el permiso de medios (products.update).
      || case when jsonb_array_length(coalesce(v_n -> 'images', '[]'::jsonb)) > 0
              then array['products.update'] else '{}' end
      || case when jsonb_array_length(v_res -> 'targets') > 0 then array['inventory.adjust'] else '{}' end
      || case when nullif(btrim(v_n ->> 'brand'), '') is not null
                   and not exists (select 1 from public.brands b where b.store_id = p_store_id and b.deleted_at is null
                                                                  and lower(b.name) = lower(btrim(v_n ->> 'brand')))
              then array['brands.manage'] else '{}' end
      -- Logo y descripción de la marca: permiso de marcas.
      || case when v_n ? 'brand_profile' then array['brands.manage'] else '{}' end;
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
    if jsonb_array_length(coalesce(v_n -> 'images', '[]'::jsonb)) > 0 and not v_can_edit then
      v_res := jsonb_set(v_res, '{errors}', (v_res -> 'errors') || jsonb_build_object('row', v_r.row_number,
                 'message', 'image_urls: tu rol no puede agregar fotos a los productos'));
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
    if v_n ? 'brand_profile' and not v_brands then
      v_res := jsonb_set(v_res, '{errors}', (v_res -> 'errors') || jsonb_build_object('row', v_r.row_number,
                 'message', 'brand_logo_url: tu rol no puede cambiar el logo ni la descripción de las marcas'));
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
$function$

;

revoke all on function public.imports_create(uuid, text, text, text[], text[], jsonb) from public;
grant execute on function public.imports_create(uuid, text, text, text[], text[], jsonb) to authenticated;

create or replace function system.import_apply_brand_profiles(p_job_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job   public.import_jobs;
  v_row   record;
  v_brand public.brands;
  v_id    uuid;
  v_done  uuid[] := '{}';
  v_count integer := 0;
begin
  select * into v_job from public.import_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'completed' then
    return 0;
  end if;
  for v_row in
    select r.normalized ->> 'brand' as brand, r.normalized -> 'brand_profile' as profile
      from public.import_job_rows r
     where r.import_job_id = p_job_id and r.store_id = v_job.store_id
       and jsonb_typeof(r.normalized -> 'brand_profile') = 'object'
       and nullif(btrim(r.normalized ->> 'brand'), '') is not null
     order by r.row_number
  loop
    select * into v_brand from public.brands b
     where b.store_id = v_job.store_id and b.deleted_at is null and lower(b.name) = lower(btrim(v_row.brand))
       for update;
    -- La primera fila de cada marca manda (varias filas del mismo archivo la repiten).
    continue when v_brand.id is null or v_brand.id = any (v_done);
    v_done := v_done || v_brand.id;
    if v_row.profile ? 'description' and char_length(v_row.profile ->> 'description') between 1 and 1000 then
      update public.brands set description = v_row.profile ->> 'description'
       where store_id = v_job.store_id and id = v_brand.id;
    end if;
    -- Se valida al crear la importación; aquí se vuelve a exigir (la base es la autoridad).
    continue when not (v_row.profile ? 'logo_url')
              or (v_row.profile ->> 'logo_url') !~ '^https://'
              or char_length(v_row.profile ->> 'logo_url') > 2000;
    -- El mismo enlace ya es su logo: reimportar no duplica.
    continue when exists (select 1 from public.media m
                           where m.store_id = v_job.store_id and m.id = v_brand.logo_media_id
                             and m.source_url = v_row.profile ->> 'logo_url' and m.deleted_at is null);
    v_id := app.uuid_v7();
    -- Tipo provisional: el worker fija el real al descargar (la ruta no cambia).
    insert into public.media (id, store_id, owner_type, product_id, status, storage_path, mime_type,
                              position, created_by, source_url, alt_text)
    values (v_id, v_job.store_id, 'brand', null, 'pending',
            format('%s/brand/%s/%s/original.jpg', v_job.store_id, v_job.store_id, v_id),
            'image/jpeg', 0, v_job.requested_by, v_row.profile ->> 'logo_url',
            left('Logo de ' || v_brand.name, 250));
    update public.brands set logo_media_id = v_id where store_id = v_job.store_id and id = v_brand.id;
    perform app.enqueue_job('media.fetch_remote', jsonb_build_object('media_id', v_id), v_job.store_id,
                            'media.fetch_remote:' || v_id::text, now(), 5);
    v_count := v_count + 1;
  end loop;
  update public.import_jobs
     set totals = totals || jsonb_build_object('brand_logos', v_count)
   where id = p_job_id;
  return v_count;
end
$$;

revoke all on function system.import_apply_brand_profiles(uuid) from public;
grant execute on function system.import_apply_brand_profiles(uuid) to system_worker;
