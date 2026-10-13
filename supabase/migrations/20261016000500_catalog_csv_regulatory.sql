-- =============================================================================
-- Fase R · R-T05 — La ficha sanitaria y los atributos en el CSV de productos
-- (exportación e importación, F8-T04). La tabla nutrimental y los atributos van
-- en formato compacto (src/lib/catalog/compact.ts): `nombre|cantidad|unidad|%VNR`
-- separados por `;`, y `clave:valor|valor` separados por `;`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. `|` y `;` separan celdas y renglones de la tabla en el CSV: ya no se aceptan
--    dentro de la tabla nutrimental (lo exportado se vuelve a importar igual).
--    Igual que en R-T01 salvo esa regla.
-- -----------------------------------------------------------------------------
create or replace function app.regulatory_normalize(p_category text, p_data jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_limits constant jsonb := '{"form": 100, "serving_size": 100, "ingredients": 5000, "usage": 2000,
                                "warnings": 3000, "storage": 1000, "allergens": 1000, "sanitary_notice": 300}';
  v_cells  constant jsonb := '{"name": 100, "amount": 30, "unit": 20, "dv": 10}';
  v_out    jsonb := '{}'::jsonb;
  v_bad    text[] := '{}';
  v_key    text;
  v_val    jsonb;
  v_txt    text;
  v_row    jsonb;
  v_cell   text;
  v_clean  jsonb;
  v_rows   jsonb;
  v_row_ok boolean;
begin
  if app.regulatory_fields(p_category) is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'category';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'regulatory', hint = 'data';
  end if;

  for v_key, v_val in select e.key, e.value from jsonb_each(p_data) e loop
    if jsonb_typeof(v_val) = 'null' then
      continue;
    end if;
    if v_limits ? v_key then
      v_txt := case when jsonb_typeof(v_val) = 'string' then btrim(v_val #>> '{}') end;
      if v_txt is null or char_length(v_txt) > (v_limits ->> v_key)::integer
         or v_txt ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then
        v_bad := v_bad || v_key;
      elsif v_txt <> '' then
        v_out := v_out || jsonb_build_object(v_key, v_txt);
      end if;
    elsif v_key = 'servings_per_container' then
      if jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}') !~ '^[0-9]{1,6}$'
         or (v_val #>> '{}')::integer not between 1 and 100000 then
        v_bad := v_bad || v_key;
      else
        v_out := v_out || jsonb_build_object(v_key, (v_val #>> '{}')::integer);
      end if;
    elsif v_key = 'nutrition' then
      v_rows := '[]'::jsonb;
      v_row_ok := jsonb_typeof(v_val) = 'array' and jsonb_array_length(v_val) <= 60;
      if v_row_ok then
        for v_row in select r.value from jsonb_array_elements(v_val) r loop
          v_clean := '{}'::jsonb;
          if jsonb_typeof(v_row) <> 'object'
             or exists (select 1 from jsonb_object_keys(v_row) k where not (v_cells ? k)) then
            v_row_ok := false;
            exit;
          end if;
          for v_cell in select jsonb_object_keys(v_cells) loop
            continue when not (v_row ? v_cell) or jsonb_typeof(v_row -> v_cell) = 'null';
            v_txt := case when jsonb_typeof(v_row -> v_cell) = 'string' then btrim(v_row ->> v_cell) end;
            if v_txt is null or char_length(v_txt) > (v_cells ->> v_cell)::integer
               or v_txt ~ '[\x01-\x1F\x7F|;]' then
              v_row_ok := false;
            elsif v_txt <> '' then
              v_clean := v_clean || jsonb_build_object(v_cell, v_txt);
            end if;
          end loop;
          exit when not v_row_ok;
          continue when v_clean = '{}'::jsonb;  -- renglón vacío del formulario
          if not (v_clean ? 'name') or not (v_clean ? 'amount') then
            v_row_ok := false;
            exit;
          end if;
          v_rows := v_rows || jsonb_build_array(v_clean);
        end loop;
      end if;
      if not v_row_ok then
        v_bad := v_bad || v_key;
      elsif jsonb_array_length(v_rows) > 0 then
        v_out := v_out || jsonb_build_object(v_key, v_rows);
      end if;
    else
      v_bad := array_append(v_bad, 'data');  -- campo fuera de la lista blanca (sin repetir el nombre recibido)
    end if;
  end loop;

  if cardinality(v_bad) > 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'regulatory',
                          hint = (select string_agg(distinct b, ',') from unnest(v_bad) b);
  end if;
  return v_out;
end
$$;
revoke all on function app.regulatory_normalize(text, jsonb) from public;

-- -----------------------------------------------------------------------------
-- 2. import_resolve: la versión de F8 queda como base; esta agrega la ficha
--    sanitaria y los atributos (errores por fila, datos para el commit).
-- -----------------------------------------------------------------------------
alter function app.import_resolve(uuid, text, jsonb) rename to import_resolve_base;

create or replace function app.import_resolve_extras(p_store_id uuid, p_n jsonb, p_product_id uuid, p_row integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_errors   jsonb := '[]'::jsonb;
  v_out      jsonb := '{}'::jsonb;
  v_reg      jsonb := p_n -> 'regulatory';
  v_cat      text;
  v_info     public.product_regulatory_info;
  v_data     jsonb;
  v_given    jsonb;
  v_norm     jsonb;
  v_hint     text;
  v_ids      jsonb;
  v_missing  text;
begin
  if p_n ? 'regulatory' then
    v_cat := v_reg ->> 'category';
    v_given := coalesce(v_reg -> 'data', '{}'::jsonb);
    if jsonb_typeof(v_given) <> 'object' then
      v_errors := v_errors || jsonb_build_object('row', p_row, 'message', 'regulatory_category: ficha no válida');
    elsif v_cat is not null and not exists (select 1 from public.store_regulated_categories d
                                             where d.store_id = p_store_id and d.category_key = v_cat) then
      v_errors := v_errors || jsonb_build_object('row', p_row, 'message',
        'regulatory_category: tu tienda no declaró esa categoría (Ajustes → Cumplimiento)');
    elsif v_cat is null then
      v_out := v_out || jsonb_build_object('regulatory', jsonb_build_object('category', null, 'data', null));
    else
      -- Columnas ausentes = sin cambios; celda vacía (null) = se borra el dato.
      select * into v_info from public.product_regulatory_info i
       where i.store_id = p_store_id and i.product_id = p_product_id;
      v_data := case when v_info.category_key = v_cat then v_info.data else '{}'::jsonb end;
      v_data := (v_data || jsonb_strip_nulls(v_given))
                - coalesce((select array_agg(e.key) from jsonb_each(v_given) e where jsonb_typeof(e.value) = 'null'),
                           '{}');
      begin
        v_norm := app.regulatory_normalize(v_cat, v_data);
        v_out := v_out || jsonb_build_object('regulatory', jsonb_build_object('category', v_cat, 'data', v_norm));
      exception when others then
        get stacked diagnostics v_hint = pg_exception_hint;
        v_errors := v_errors || coalesce((
          select jsonb_agg(jsonb_build_object('row', p_row, 'message', 'regulatory_' || f || ': valor no válido'))
            from unnest(string_to_array(coalesce(nullif(v_hint, ''), 'data'), ',')) f),
          '[]'::jsonb);
      end;
    end if;
  end if;

  if p_n ? 'attributes' then
    if jsonb_typeof(p_n -> 'attributes') <> 'object' then
      v_errors := v_errors || jsonb_build_object('row', p_row, 'message', 'attributes: formato no válido');
    else
      select string_agg(format('«%s:%s»', e.key, v.val), ', ') into v_missing
        from jsonb_each(p_n -> 'attributes') e
        cross join lateral jsonb_array_elements_text(case when jsonb_typeof(e.value) = 'array' then e.value
                                                          else '[]'::jsonb end) v(val)
       where not exists (select 1 from public.attribute_values av
                           join public.attributes a on a.store_id = av.store_id and a.id = av.attribute_id
                          where a.store_id = p_store_id and a.key = e.key and av.key = v.val);
      select coalesce(jsonb_agg(distinct av.id), '[]'::jsonb) into v_ids
        from jsonb_each(p_n -> 'attributes') e
        cross join lateral jsonb_array_elements_text(case when jsonb_typeof(e.value) = 'array' then e.value
                                                          else '[]'::jsonb end) v(val)
        join public.attributes a on a.store_id = p_store_id and a.key = e.key
        join public.attribute_values av on av.store_id = a.store_id and av.attribute_id = a.id and av.key = v.val;
      if v_missing is not null then
        v_errors := v_errors || jsonb_build_object('row', p_row, 'message',
          'attributes: no existe ' || left(v_missing, 200) || ' (créalo en Productos → Atributos)');
      elsif jsonb_array_length(v_ids) > 40 then
        v_errors := v_errors || jsonb_build_object('row', p_row, 'message', 'attributes: hasta 40 valores por producto');
      else
        v_out := v_out || jsonb_build_object('attribute_value_ids', v_ids);
      end if;
    end if;
  end if;
  return v_out || jsonb_build_object('errors', v_errors);
end
$$;
revoke all on function app.import_resolve_extras(uuid, jsonb, uuid, integer) from public;

create or replace function app.import_resolve(p_store_id uuid, p_mode text, p_n jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_res jsonb := app.import_resolve_base(p_store_id, p_mode, p_n);
  v_x   jsonb := app.import_resolve_extras(p_store_id, p_n, (v_res ->> 'product_id')::uuid,
                                           (v_res ->> 'first_row')::integer);
begin
  return v_res || (v_x - 'errors')
         || jsonb_build_object('errors', (v_res -> 'errors') || (v_x -> 'errors'),
                               'touches_catalog', (v_res ->> 'touches_catalog')::boolean
                                                  or p_n ? 'regulatory' or p_n ? 'attributes');
end
$$;
revoke all on function app.import_resolve(uuid, text, jsonb) from public;

-- -----------------------------------------------------------------------------
-- 3. Alta de la importación: columnas nuevas y permiso para la ficha y los atributos.
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
    'regulatory_storage', 'regulatory_allergens', 'regulatory_sanitary_notice', 'attributes'];
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
-- 4. Confirmación: guarda la ficha y los atributos antes de publicar.
-- -----------------------------------------------------------------------------
create or replace function system.import_commit(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job      public.import_jobs;
  v_org      uuid;
  v_uid      uuid;
  v_row      record;
  v_n        jsonb;
  v_res      jsonb;
  v_payload  jsonb;
  v_product  uuid;
  v_brand    uuid;
  v_t        jsonb;
  v_variant  uuid;
  v_level    uuid;
  v_on_hand  integer;
  v_status   text;
  v_need     text;
  v_creates  integer;
  v_created  integer := 0;
  v_updated  integer := 0;
  v_rownum   integer;
  v_msg      text;
  v_detail   text;
  v_hint     text;
  v_error    text;
  v_done     integer := 0;
  v_cold     boolean;
begin
  select * into v_job from public.import_jobs j where j.id = p_job_id for update;
  if v_job.id is null then
    return jsonb_build_object('status', 'missing');
  end if;
  if v_job.status <> 'committing' then
    return jsonb_build_object('status', v_job.status, 'replayed', true);
  end if;
  select s.organization_id into v_org from public.stores s where s.id = v_job.store_id;
  v_uid := v_job.commit_requested_by;

  -- CF-10: quien confirmó debe CONSERVAR ahora los permisos que exige este lote.
  select n into v_need from unnest(array['imports.run'] || v_job.needs) with ordinality q(n, o)
   where not coalesce(system.user_has_store_permission(v_uid, v_job.store_id, n), false)
   order by o limit 1;
  if v_need is not null then
    perform app.import_mark_failed(v_job.id, format('Quien confirmó ya no tiene el permiso necesario (%s).', v_need));
    return jsonb_build_object('status', 'failed', 'error', 'forbidden', 'permission', v_need);
  end if;

  -- Las RPC del catálogo actúan como el solicitante: comprueban otra vez sus
  -- permisos y lo registran como autor. Solo dura esta transacción del worker.
  perform set_config('request.jwt.claims',
                     jsonb_build_object('sub', v_uid, 'role', 'authenticated', 'aal', 'aal2',
                                        'pruva_job', 'import.commit')::text, true);
  select count(*) into v_creates from public.import_job_rows r where r.import_job_id = v_job.id and r.action = 'create';
  -- Plataforma recién creada: sin estadísticas, el planificador recorre tablas
  -- enteras en cada búsqueda mientras el lote las hace crecer (cuadrático).
  v_cold := not exists (select 1 from pg_catalog.pg_stats st
                         where st.schemaname = 'public' and st.tablename = 'products' and st.attname = 'store_id')
         or not exists (select 1 from pg_catalog.pg_stats st
                         where st.schemaname = 'public' and st.tablename = 'inventory_levels' and st.attname = 'variant_id');

  begin
    -- Límite del plan (G-M2, G-M4): solo si el lote crea productos. Aviso temprano sin
    -- candado; la comprobación que cuenta va al final, con el candado de la
    -- organización, para no frenar su catálogo durante todo el lote. La marca de lote
    -- (G-M3) vive en una tabla del sistema que solo escriben funciones privilegiadas.
    if v_creates > 0 then
      if app.current_usage(v_org, 'max_products') + v_creates > app.effective_limit(v_org, 'max_products') then
        raise exception using errcode = 'P0001', message = 'limit_reached', detail = 'max_products';
      end if;
      insert into system.product_limit_bulk (txid, store_id) values (pg_catalog.txid_current(), v_job.store_id)
      on conflict do nothing;
    end if;

    for v_row in
      select r.id, r.row_number, r.normalized from public.import_job_rows r
       where r.import_job_id = v_job.id and r.normalized is not null
       order by r.row_number
    loop
      v_rownum := v_row.row_number;
      v_n := v_row.normalized;
      -- Se resuelve con los datos de AHORA (algo pudo cambiar desde la vista previa).
      v_res := app.import_resolve(v_job.store_id, v_job.mode, v_n);
      if jsonb_array_length(v_res -> 'errors') > 0 then
        v_rownum := coalesce((v_res -> 'errors' -> 0 ->> 'row')::integer, v_rownum);
        raise exception using errcode = 'P0001', message = 'import_row', detail = v_res -> 'errors' -> 0 ->> 'message';
      end if;
      v_payload := v_res -> 'payload';

      if v_n ? 'brand' then
        v_brand := null;
        if nullif(btrim(v_n ->> 'brand'), '') is not null then
          select b.id into v_brand from public.brands b
           where b.store_id = v_job.store_id and b.deleted_at is null and lower(b.name) = lower(btrim(v_n ->> 'brand'))
           limit 1;
          if v_brand is null then
            v_brand := public.catalog_upsert_brand(v_job.store_id, jsonb_build_object('name', btrim(v_n ->> 'brand')));
          end if;
        end if;
        v_payload := v_payload || jsonb_build_object('brand_id', v_brand);
      end if;
      if v_n ? 'categories' then
        v_payload := v_payload || jsonb_build_object('categories', coalesce((
          select jsonb_agg(jsonb_build_object('id', app.category_by_path(v_job.store_id, c), 'is_primary', ord = 1)
                           order by ord)
            from jsonb_array_elements_text(v_n -> 'categories') with ordinality as t(c, ord)), '[]'::jsonb));
      end if;

      if (v_res ->> 'touches_catalog')::boolean then
        v_product := (public.catalog_upsert_product(v_job.store_id, v_payload) ->> 'id')::uuid;
      else
        v_product := (v_res ->> 'product_id')::uuid;  -- solo existencias: el catálogo no cambia
      end if;
      if v_res ->> 'action' = 'create' then v_created := v_created + 1; else v_updated := v_updated + 1; end if;

      -- Existencias físicas absolutas en la ubicación principal (§26.1 paso 7).
      for v_t in select * from jsonb_array_elements(v_res -> 'targets') loop
        v_variant := coalesce(nullif(v_t ->> 'id', '')::uuid,
                              app.import_find_variant(v_product, v_t ->> 'sku', v_t -> 'options'));
        v_level := app.default_level(v_job.store_id, v_variant);
        if v_level is null then
          raise exception using errcode = 'P0001', message = 'not_found', detail = 'inventory_level';
        end if;
        select l.on_hand into v_on_hand from public.inventory_levels l where l.id = v_level for update;
        if v_on_hand is distinct from (v_t ->> 'quantity')::integer then
          perform app.apply_inventory_movement(v_job.store_id, v_level, 'adjustment',
                                               (v_t ->> 'quantity')::integer - v_on_hand, 0,
                                               'Importación ' || v_job.file_name, 'import', v_job.id,
                                               'import:' || v_job.id || ':' || (v_t ->> 'row_number'), 'user');
        end if;
      end loop;

      -- R-T05: ficha y atributos con las RPC del panel (mismas reglas; uno publicado sigue cumpliendo).
      if v_res ? 'regulatory' then
        perform public.catalog_save_regulatory_info(v_job.store_id, v_product, v_res -> 'regulatory' ->> 'category',
                                                    v_res -> 'regulatory' -> 'data');
      end if;
      if v_res ? 'attribute_value_ids' then
        perform public.catalog_set_product_attributes(v_job.store_id, v_product,
          array(select x::uuid from jsonb_array_elements_text(v_res -> 'attribute_value_ids') x));
      end if;

      if v_n ? 'status' then
        select p.status into v_status from public.products p where p.id = v_product;
        if v_n ->> 'status' = 'active' and v_status <> 'active' then
          perform public.catalog_publish_product(v_job.store_id, v_product);
        elsif v_n ->> 'status' in ('draft', 'archived') and v_status <> v_n ->> 'status' then
          perform public.catalog_set_product_status(v_job.store_id, v_product, v_n ->> 'status');
        end if;
      end if;
      update public.import_job_rows set entity_id = v_product where id = v_row.id;
      v_done := v_done + 1;
      if v_cold and v_done = 200 then
        -- Una sola vez: ANALYZE ve las filas de esta transacción y los planes siguientes
        -- usan los índices únicos. Solo ocurre en una base sin estadísticas.
        analyze public.products, public.product_variants, public.product_options, public.product_option_values,
                public.variant_option_values, public.inventory_levels, public.inventory_movements,
                public.product_categories, public.brands;
        v_cold := false;
      end if;
    end loop;

    -- Comprobación final del límite con todo lo creado, ahora con el candado de la
    -- organización (lo suelta el commit, un instante después).
    v_rownum := null;
    if v_creates > 0 then
      delete from system.product_limit_bulk where txid = pg_catalog.txid_current() and store_id = v_job.store_id;
      perform app.assert_within_limit(v_org, 'max_products', 0);
    end if;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
    v_error := case
      when v_msg = 'import_row' then v_detail
      when v_msg = 'validation_failed' and v_detail = 'publish'
        then 'no se puede publicar (' || coalesce(v_hint, 'revisa precio y variantes') || ')'
      when v_msg = 'validation_failed' then 'dato no válido en ' || coalesce(v_detail, 'el producto')
      when v_msg = 'insufficient_stock' then 'no puedes dejar menos existencias que las reservadas por pedidos'
      when v_msg in ('forbidden', 'mfa_required', 'unauthenticated') then 'tu rol no permite esta operación'
      when v_msg = 'limit_reached' then 'se alcanzaría el límite de productos de tu plan'
      else 'no se pudo aplicar este producto' end;
    perform app.import_mark_failed(v_job.id,
      case when v_rownum is null then initcap(left(v_error, 1)) || substr(v_error, 2)
           else format('Fila %s: %s', v_rownum, v_error) end);
    perform set_config('request.jwt.claims', '', true);
    return jsonb_build_object('status', 'failed', 'row_number', v_rownum, 'error', v_msg, 'detail', v_detail,
                              'hint', v_hint);
  end;

  update public.import_jobs
     set status = 'completed', committed_at = now(),
         totals = totals || jsonb_build_object('created', v_created, 'updated', v_updated)
   where id = v_job.id;
  perform audit.record('import.committed', 'import_job', v_job.id, v_org, v_job.store_id,
                       null, jsonb_build_object('created', v_created, 'updated', v_updated, 'file', v_job.file_name));
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('status', 'completed', 'created', v_created, 'updated', v_updated);
end
$$;
revoke all on function system.import_commit(uuid) from public;
grant execute on function system.import_commit(uuid) to system_worker;

-- -----------------------------------------------------------------------------
-- 5. Exportación: la ficha y los atributos de cada producto.
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
              -- Existencias físicas en la ubicación principal (lo que fija la importación).
              'on_hand', case when v_inv then (select l.on_hand from public.inventory_levels l
                                                 join public.inventory_locations loc
                                                   on loc.store_id = l.store_id and loc.id = l.location_id and loc.is_default
                                                where l.store_id = v.store_id and l.variant_id = v.id) end,
              'seo_title', p.seo_title, 'seo_description', p.seo_description,
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
                                                'pii', v_pii and p_entity in ('orders', 'customers')));
  -- Columnas opcionales del CSV de productos: solo si la tienda las usa (R-T05).
  return jsonb_build_object('entity', p_entity, 'pii', v_pii, 'rows', v_rows,
    'regulated', exists (select 1 from public.store_regulated_categories d where d.store_id = p_store_id)
                 or exists (select 1 from public.product_regulatory_info i
                             where i.store_id = p_store_id and i.category_key is not null),
    'has_attributes', exists (select 1 from public.attributes a where a.store_id = p_store_id));
end
$$;
revoke all on function public.exports_rows(uuid, text) from public;
grant execute on function public.exports_rows(uuid, text) to authenticated;
