-- =============================================================================
-- Gate F8 · Correcciones de la Fase 8. Contrato: GATE0 §26.1 (CF-10), §38 F8.
--
-- 1. Importación de productos (D-F8-06):
--    * La confirmación ya no escribe el catálogo dentro de la petición (5 000 filas
--      tardaban minutos y PostgREST corta a los 8 s en Supabase): imports_commit
--      encola `import.commit` y el worker ejecuta system.import_commit, que
--      REVALIDA los permisos del solicitante (system.user_has_store_permission) y
--      aplica TODO o NADA con las RPC del catálogo actuando como esa persona.
--    * Columnas ausentes = sin cambios (también en las variantes), celdas vacías
--      = borrar el dato opcional; las variantes que no vienen en el archivo se
--      conservan (nunca se retiran por importar). Columnas ajenas se ignoran.
--    * Existencias como movimientos `adjustment` con reference_type 'import' y
--      clave job:fila (§26.1 paso 7). Auditoría import.failed.
--    * Límite de productos del plan: una comprobación por lote con el candado de
--      la organización (antes: un conteo por producto → cuadrático).
-- 2. exports_rows: existencias de la ubicación principal sin app.default_level en
--    un WHERE (se evaluaba por cada nivel de inventario → cuadrático).
-- =============================================================================

-- 1.1 ------------------------------------------------------------------------
alter table public.import_jobs
  add column columns             text[] not null default '{}'
    check (cardinality(columns) <= 40),
  add column ignored_columns     text[] not null default '{}'
    check (cardinality(ignored_columns) <= 50
           and coalesce(char_length(array_to_string(ignored_columns, ',')), 0) <= 2000),
  add column commit_requested_by uuid references auth.users (id) on delete set null,
  add column commit_requested_at timestamptz,
  -- Permisos que exige confirmar este lote (se comprueban al confirmar y en el worker).
  add column needs               text[] not null default '{}' check (cardinality(needs) <= 10);
create index import_jobs_committing_idx on public.import_jobs (commit_requested_at) where status = 'committing';

-- 1.2 Límite de productos: una sola comprobación por lote de importación --------
create or replace function app.enforce_product_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or (old.deleted_at is not null and new.deleted_at is null) then
    -- system.import_commit comprueba el lote completo con el candado de la
    -- organización tomado, y otra vez al terminar (Gate F8: un conteo por
    -- producto hacía cuadrática una importación de 5 000 filas).
    if current_setting('app.bulk_product_limit_store', true) = new.store_id::text then
      return new;
    end if;
    perform app.assert_within_limit((select s.organization_id from public.stores s where s.id = new.store_id),
                                    'max_products');
  end if;
  return new;
end
$$;
revoke all on function app.enforce_product_limit() from public;

-- 1.3 Opciones del archivo con los nombres del producto (sin distinguir mayúsculas)
create or replace function app.import_options_as(p_options jsonb, p_names text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(n, (select e.value from jsonb_each_text(coalesce(p_options, '{}'::jsonb)) e
                                        where lower(btrim(e.key)) = lower(n) limit 1)), '{}'::jsonb)
    from unnest(p_names) n
$$;
revoke all on function app.import_options_as(jsonb, text[]) from public;

-- Mismo mapa {opción: valor} sin distinguir mayúsculas ni espacios en los valores.
create or replace function app.import_options_key(p_options jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(lower(btrim(e.key)), lower(btrim(e.value))), '{}'::jsonb)
    from jsonb_each_text(coalesce(p_options, '{}'::jsonb)) e
$$;
revoke all on function app.import_options_key(jsonb) from public;

-- 1.4 Resolución de un producto del archivo contra la base -------------------------
-- Entrada: el plan del servidor (src/server/imports/products.ts). Salida:
--   action ('create' | 'update'), product_id, status actual, errors [{row, message}],
--   payload completo para catalog_upsert_product (fusionado con lo existente) y
--   targets [{row_number, quantity, id | sku + options}] para las existencias.
-- Solo lee. La usan imports_create (para avisar por fila) y system.import_commit
-- (que vuelve a resolver con los datos del momento de confirmar).
create or replace function app.import_resolve(p_store_id uuid, p_mode text, p_n jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_handle    text := p_n ->> 'handle';
  v_prod      jsonb := coalesce(p_n -> 'product', '{}'::jsonb);
  v_existing  public.products;
  v_errors    jsonb := '[]'::jsonb;
  v_ex_opts   jsonb := '[]'::jsonb;
  v_ex_vars   jsonb := '[]'::jsonb;
  v_names     text[];
  v_has_opts  boolean;
  v_used      jsonb := '{}'::jsonb;  -- {variant_id: fila}
  v_out       jsonb := '[]'::jsonb;
  v_targets   jsonb := '[]'::jsonb;
  v_var       jsonb;
  v_match     jsonb;
  v_outv      jsonb;
  v_opts      jsonb;
  v_row       integer;
  v_first     integer;
  v_sku       text;
  v_next_pos  integer := 0;
  v_count     integer;
  v_payload   jsonb;
  v_opt_out   jsonb;
  v_qty       jsonb;
  v_touches   boolean := false;  -- ¿cambia algo del catálogo (no solo existencias)?
begin
  if jsonb_typeof(p_n -> 'variants') is distinct from 'array' or jsonb_array_length(p_n -> 'variants') = 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rows';
  end if;
  v_count := jsonb_array_length(p_n -> 'variants');
  v_first := (p_n -> 'variants' -> 0 ->> 'row_number')::integer;
  if v_count > 100 then
    v_errors := v_errors || jsonb_build_object('row', v_first, 'message', 'un producto puede tener hasta 100 variantes');
  end if;
  if p_n ? 'status' and coalesce(p_n ->> 'status', '') not in ('draft', 'active', 'archived') then
    v_errors := v_errors || jsonb_build_object('row', v_first, 'message', 'status: usa draft, active o archived');
  end if;
  if p_n ? 'brand' and (jsonb_typeof(p_n -> 'brand') not in ('string', 'null') or char_length(p_n ->> 'brand') > 120) then
    v_errors := v_errors || jsonb_build_object('row', v_first, 'message', 'brand: hasta 120 caracteres');
  end if;
  if p_n ? 'categories' and (jsonb_array_length(p_n -> 'categories') > 20 or exists (
       select 1 from jsonb_array_elements(p_n -> 'categories') c
        where jsonb_typeof(c) <> 'string' or nullif(btrim(c #>> '{}'), '') is null or char_length(c #>> '{}') > 300)) then
    v_errors := v_errors || jsonb_build_object('row', v_first, 'message', 'categories: hasta 20 rutas de categoría');
  end if;
  v_touches := v_prod <> '{}'::jsonb or p_n ? 'brand' or p_n ? 'categories';

  select * into v_existing from public.products p
   where p.store_id = p_store_id and p.slug = v_handle and p.deleted_at is null;
  if v_existing.id is null and p_mode = 'update_existing' then
    v_errors := v_errors || jsonb_build_object('row', v_first, 'message', 'handle: no existe un producto con ese handle');
  elsif v_existing.id is not null and p_mode = 'create_only' then
    v_errors := v_errors || jsonb_build_object('row', v_first, 'message', 'handle: ya existe un producto con ese handle');
  end if;
  if v_existing.id is null and nullif(btrim(v_prod ->> 'title'), '') is null then
    v_errors := v_errors || jsonb_build_object('row', v_first, 'message', 'title: es obligatorio para crear el producto');
  end if;

  -- Opciones del archivo para este producto (null = el archivo no trae columnas de opciones).
  if jsonb_typeof(p_n -> 'option_names') = 'array' then
    select coalesce(array_agg(btrim(x) order by o), '{}') into v_names
      from jsonb_array_elements_text(p_n -> 'option_names') with ordinality t(x, o)
     where btrim(x) <> '';
  end if;
  v_has_opts := coalesce(cardinality(v_names), 0) > 0;
  if v_existing.id is null and not v_has_opts and v_count > 1 then
    v_errors := v_errors || jsonb_build_object('row', v_first, 'message',
      'option1_name: para crear un producto con varias variantes incluye las columnas de opciones');
  end if;

  if v_existing.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', o.name,
             'values', (select coalesce(jsonb_agg(ov.value order by ov.position, ov.value), '[]'::jsonb)
                          from public.product_option_values ov where ov.option_id = o.id))
           order by o.position, o.name), '[]'::jsonb)
      into v_ex_opts
      from public.product_options o where o.product_id = v_existing.id;
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', pv.id, 'sku', pv.sku, 'barcode', pv.barcode, 'price', pv.price,
             'compare_at_price', pv.compare_at_price, 'status', pv.status, 'position', pv.position,
             'options', (select coalesce(jsonb_object_agg(o.name, ov.value), '{}'::jsonb)
                           from public.variant_option_values vov
                           join public.product_option_values ov on ov.id = vov.option_value_id
                           join public.product_options o on o.id = vov.option_id
                          where vov.variant_id = pv.id))
           order by pv.position, pv.id), '[]'::jsonb)
      into v_ex_vars
      from public.product_variants pv where pv.product_id = v_existing.id and pv.deleted_at is null;
    select coalesce(max((x ->> 'position')::integer) + 1, 0) into v_next_pos from jsonb_array_elements(v_ex_vars) x;

    if v_has_opts then
      if jsonb_array_length(v_ex_opts) = 0 then
        v_errors := v_errors || jsonb_build_object('row', v_first, 'message',
          'option1_name: el producto no tiene opciones; agrégalas desde el panel antes de importar variantes');
      elsif (select array_agg(lower(x ->> 'name') order by lower(x ->> 'name')) from jsonb_array_elements(v_ex_opts) x)
            is distinct from (select array_agg(lower(n) order by lower(n)) from unnest(v_names) n) then
        v_errors := v_errors || jsonb_build_object('row', v_first, 'message',
          format('option1_name: usa las opciones del producto (%s)',
                 (select string_agg(x ->> 'name', ', ') from jsonb_array_elements(v_ex_opts) x)));
      end if;
    end if;
    -- Con un producto existente se usan sus nombres de opción (y su orden).
    select coalesce(array_agg(x ->> 'name'), '{}') into v_names from jsonb_array_elements(v_ex_opts) x;
  else
    v_names := coalesce(v_names, '{}');
  end if;

  for v_var in select x from jsonb_array_elements(p_n -> 'variants') x loop
    v_row := (v_var ->> 'row_number')::integer;
    v_sku := upper(nullif(btrim(v_var ->> 'sku'), ''));
    v_opts := case when v_has_opts then app.import_options_as(v_var -> 'options', v_names) else null end;
    v_match := null;

    if v_var ? 'price' and jsonb_typeof(v_var -> 'price') <> 'number' then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'price: escribe un importe como 199.50');
    end if;
    v_qty := v_var -> 'quantity';
    if v_qty is not null and (jsonb_typeof(v_qty) <> 'number' or (v_qty #>> '{}')::numeric
                                not between 0 and 1000000 or (v_qty #>> '{}')::numeric % 1 <> 0) then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'inventory_quantity: usa un entero entre 0 y 1000000');
      v_qty := null;
    end if;
    if v_sku is not null and exists (
         select 1 from public.product_variants pv
          where pv.store_id = p_store_id and pv.sku = v_sku and pv.deleted_at is null
            and pv.product_id is distinct from v_existing.id) then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', format('sku: %s ya pertenece a otro producto', v_sku));
    end if;
    if nullif(btrim(v_var ->> 'barcode'), '') is not null and exists (
         select 1 from public.product_variants pv
          where pv.store_id = p_store_id and pv.barcode = btrim(v_var ->> 'barcode') and pv.deleted_at is null
            and pv.product_id is distinct from v_existing.id) then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'barcode: ya pertenece a otro producto');
    end if;

    if v_existing.id is not null then
      -- 1) por SKU; 2) por combinación de opciones; 3) producto simple de una sola fila.
      if v_sku is not null then
        select x into v_match from jsonb_array_elements(v_ex_vars) x where upper(x ->> 'sku') = v_sku;
      end if;
      if v_match is null and v_has_opts then
        select x into v_match from jsonb_array_elements(v_ex_vars) x
         where app.import_options_key(x -> 'options') = app.import_options_key(v_opts);
      end if;
      if v_match is null and jsonb_array_length(v_ex_opts) = 0 and jsonb_array_length(v_ex_vars) = 1 and v_count = 1 then
        v_match := v_ex_vars -> 0;
      end if;
    end if;

    if v_match is not null and v_used ? (v_match ->> 'id') then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message',
        format('variante repetida: es la misma de la fila %s', v_used ->> (v_match ->> 'id')));
      continue;
    end if;

    if v_match is not null then
      v_used := v_used || jsonb_build_object(v_match ->> 'id', v_row);
      -- Solo existencias (y la identificación de la variante) no tocan el catálogo.
      if exists (select 1 from jsonb_object_keys(v_var) k where k not in ('row_number', 'quantity', 'sku', 'options'))
         or (v_var ? 'sku' and v_sku is distinct from upper(v_match ->> 'sku'))
         or (v_has_opts and app.import_options_key(v_opts) <> app.import_options_key(v_match -> 'options')) then
        v_touches := true;
      end if;
      -- Lo que el archivo no trae se conserva (pesos y medidas: catalog_upsert_product
      -- conserva las claves ausentes; el resto se copia de la variante actual).
      v_outv := jsonb_build_object(
        'id', v_match -> 'id',
        'options', coalesce(v_opts, v_match -> 'options'),
        'sku', case when v_var ? 'sku' then to_jsonb(v_sku) else v_match -> 'sku' end,
        'barcode', case when v_var ? 'barcode' then to_jsonb(nullif(btrim(v_var ->> 'barcode'), '')) else v_match -> 'barcode' end,
        'price', coalesce(v_var -> 'price', v_match -> 'price'),
        'compare_at_price', case when v_var ? 'compare_at_price' then v_var -> 'compare_at_price'
                                 else v_match -> 'compare_at_price' end,
        'status', coalesce(v_var -> 'status', v_match -> 'status'),
        'position', v_match -> 'position');
    else
      if v_existing.id is not null and jsonb_array_length(v_ex_opts) > 0 and not v_has_opts then
        v_errors := v_errors || jsonb_build_object('row', v_row, 'message',
          'sku: no coincide con ninguna variante del producto; para agregar variantes incluye las columnas de opciones');
      elsif v_existing.id is not null and jsonb_array_length(v_ex_opts) = 0 then
        v_errors := v_errors || jsonb_build_object('row', v_row, 'message',
          'el producto no tiene opciones: solo puede tener una variante (indica su SKU)');
      elsif not (v_var ? 'price') then
        v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'price: es obligatorio para una variante nueva');
      end if;
      v_touches := true;
      v_outv := jsonb_build_object(
        'options', coalesce(v_opts, '{}'::jsonb),
        'sku', to_jsonb(v_sku),
        'barcode', to_jsonb(nullif(btrim(v_var ->> 'barcode'), '')),
        'price', v_var -> 'price',
        'compare_at_price', v_var -> 'compare_at_price',
        'status', coalesce(v_var -> 'status', to_jsonb('active'::text)),
        'position', v_next_pos);
      v_next_pos := v_next_pos + 1;
    end if;
    v_outv := v_outv || (select coalesce(jsonb_object_agg(k, v_var -> k), '{}'::jsonb)
                           from unnest(array['weight_g', 'length_mm', 'width_mm', 'height_mm',
                                             'requires_shipping', 'inventory_policy']) k
                          where v_var ? k);
    v_out := v_out || v_outv;
    if v_qty is not null then
      v_targets := v_targets || jsonb_build_object('row_number', v_row, 'quantity', v_qty, 'id', v_outv -> 'id',
                                                   'sku', to_jsonb(v_outv ->> 'sku'), 'options', v_outv -> 'options');
    end if;
  end loop;

  -- Las variantes que el archivo no menciona se conservan tal cual.
  v_out := v_out || (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', x -> 'id', 'options', x -> 'options', 'sku', x -> 'sku', 'barcode', x -> 'barcode',
                        'price', x -> 'price', 'compare_at_price', x -> 'compare_at_price', 'status', x -> 'status',
                        'position', x -> 'position')), '[]'::jsonb)
                       from jsonb_array_elements(v_ex_vars) x where not v_used ? (x ->> 'id'));

  -- Valores de opción: los actuales (nunca se borran) + los nuevos del archivo, en orden de aparición.
  select coalesce(jsonb_agg(jsonb_build_object('name', n.name, 'values', coalesce((
           select jsonb_agg(d.val order by d.seq)
             from (select distinct on (lower(btrim(u.val))) btrim(u.val) as val, u.seq
                     from (select e.val, e.seq from jsonb_array_elements_text(n.ex_values) with ordinality e(val, seq)
                           union all
                           select x -> 'options' ->> n.name, 100000 + o
                             from jsonb_array_elements(v_out) with ordinality t(x, o)
                            where nullif(btrim(x -> 'options' ->> n.name), '') is not null) u
                    order by lower(btrim(u.val)), u.seq) d), '[]'::jsonb))
         order by n.ord), '[]'::jsonb)
    into v_opt_out
    from (select nm as name, ord,
                 coalesce((select y -> 'values' from jsonb_array_elements(v_ex_opts) y where y ->> 'name' = nm),
                          '[]'::jsonb) as ex_values
            from unnest(v_names) with ordinality q(nm, ord)) n;

  v_payload := jsonb_build_object(
    'title', coalesce(nullif(btrim(v_prod ->> 'title'), ''), v_existing.title),
    'slug', v_handle,
    'description_html', case when v_prod ? 'description_html' then v_prod -> 'description_html'
                             else to_jsonb(v_existing.description_html) end,
    'tags', case when v_prod ? 'tags' then coalesce(v_prod -> 'tags', '[]'::jsonb)
                 else to_jsonb(coalesce(v_existing.tags, '{}'::text[])) end,
    'seo_title', case when v_prod ? 'seo_title' then v_prod -> 'seo_title' else to_jsonb(v_existing.seo_title) end,
    'seo_description', case when v_prod ? 'seo_description' then v_prod -> 'seo_description'
                            else to_jsonb(v_existing.seo_description) end,
    'options', v_opt_out,
    'variants', v_out);
  if v_existing.id is not null then
    v_payload := v_payload || jsonb_build_object('id', v_existing.id, 'brand_id', v_existing.brand_id);
  end if;

  return jsonb_build_object('action', case when v_existing.id is null then 'create' else 'update' end,
                            'product_id', v_existing.id, 'status', v_existing.status, 'first_row', v_first,
                            'touches_catalog', v_existing.id is null or v_touches,
                            'errors', v_errors, 'payload', v_payload, 'targets', v_targets);
end
$$;
revoke all on function app.import_resolve(uuid, text, jsonb) from public;

-- Variante recién creada o actualizada a la que van las existencias de una fila.
create or replace function app.import_find_variant(p_product_id uuid, p_sku text, p_options jsonb)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pv.id from public.product_variants pv
   where pv.product_id = p_product_id and pv.deleted_at is null
     and case when nullif(p_sku, '') is not null then pv.sku = p_sku
              else app.import_options_key((select coalesce(jsonb_object_agg(o.name, ov.value), '{}'::jsonb)
                                             from public.variant_option_values vov
                                             join public.product_option_values ov on ov.id = vov.option_value_id
                                             join public.product_options o on o.id = vov.option_id
                                            where vov.variant_id = pv.id))
                   = app.import_options_key(p_options) end
   limit 1
$$;
revoke all on function app.import_find_variant(uuid, text, jsonb) from public;

-- 1.5 imports_create: columnas del archivo y validación por fila contra la base ----
drop function public.imports_create(uuid, text, text, jsonb);

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
    'seo_title', 'seo_description'];
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
                 or jsonb_typeof(coalesce(x -> 'normalized' -> 'categories', '[]'::jsonb)) <> 'array'))
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
      || case when jsonb_array_length(v_res -> 'targets') > 0 then array['inventory.adjust'] else '{}' end
      || case when nullif(btrim(v_n ->> 'brand'), '') is not null
                   and not exists (select 1 from public.brands b where b.store_id = p_store_id and b.deleted_at is null
                                                                  and lower(b.name) = lower(btrim(v_n ->> 'brand')))
              then array['brands.manage'] else '{}' end;
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

-- 1.6 imports_commit: confirma y encola (el worker hace el trabajo) ------------------
create or replace function public.imports_commit(p_store_id uuid, p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_job public.import_jobs;
begin
  v_uid := app.require_store_permission(p_store_id, 'imports.run');
  select * into v_job from public.import_jobs j where j.store_id = p_store_id and j.id = p_job_id for update;
  if v_job.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'import_job';
  end if;
  if v_job.status in ('completed', 'committing') then
    return jsonb_build_object('status', v_job.status, 'replayed', true);
  end if;
  if v_job.status <> 'validated' or coalesce((v_job.totals ->> 'errors')::integer, 1) > 0 then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'import_not_ready';
  end if;
  -- DB-L6: quien confirma debe tener lo que exige el lote (si no, el job queda intacto).
  if exists (select 1 from unnest(v_job.needs) n where not app.has_store_permission(p_store_id, n)) then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'import_permissions';
  end if;
  update public.import_jobs
     set status = 'committing', commit_requested_by = v_uid, commit_requested_at = now(), error = null
   where id = v_job.id;
  perform app.enqueue_job('import.commit', jsonb_build_object('import_job_id', v_job.id), p_store_id,
                          'import.commit:' || v_job.id, now(), 3);
  return jsonb_build_object('status', 'committing', 'replayed', false);
end
$$;
revoke all on function public.imports_commit(uuid, uuid) from public;
grant execute on function public.imports_commit(uuid, uuid) to authenticated;

-- 1.7 Fallo de una importación (desde el worker o el mantenimiento) ------------------
create or replace function app.import_mark_failed(p_job_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.import_jobs;
begin
  update public.import_jobs set status = 'failed', error = left(coalesce(p_error, 'Error desconocido'), 500)
   where id = p_job_id and status = 'committing'
  returning * into v_job;
  if v_job.id is not null then
    perform audit.record('import.failed', 'import_job', v_job.id,
                         (select s.organization_id from public.stores s where s.id = v_job.store_id), v_job.store_id,
                         null, jsonb_build_object('error', v_job.error));
  end if;
end
$$;
revoke all on function app.import_mark_failed(uuid, text) from public;

create or replace function system.import_commit_failed(p_job_id uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$ select app.import_mark_failed(p_job_id, p_error) $$;
revoke all on function system.import_commit_failed(uuid, text) from public;
grant execute on function system.import_commit_failed(uuid, text) to system_worker;

-- 1.8 system.import_commit: el trabajo de la confirmación, TODO o NADA -------------
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
    -- Límite del plan una vez por el lote (el candado de la organización queda tomado).
    perform app.assert_within_limit(v_org, 'max_products', v_creates);
    perform set_config('app.bulk_product_limit_store', v_job.store_id::text, true);

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

    -- Comprobación final del límite con todo lo creado.
    v_rownum := null;
    perform set_config('app.bulk_product_limit_store', '', true);
    if app.current_usage(v_org, 'max_products') > app.effective_limit(v_org, 'max_products') then
      raise exception using errcode = 'P0001', message = 'limit_reached', detail = 'max_products';
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

-- 1.9 Mantenimiento: una confirmación que nunca terminó (worker caído) -------------
create or replace function system.fail_stuck_imports()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job   uuid;
  v_count integer := 0;
begin
  for v_job in
    select j.id from public.import_jobs j
     where j.status = 'committing' and j.commit_requested_at < now() - interval '30 minutes'
       and not exists (select 1 from system.jobs q
                        where q.dedupe_key = 'import.commit:' || j.id and q.status in ('queued', 'running'))
     for update skip locked
  loop
    perform app.import_mark_failed(v_job, 'La importación no terminó. No se cambió nada: vuelve a subir el archivo.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;
revoke all on function system.fail_stuck_imports() from public;
grant execute on function system.fail_stuck_imports() to system_worker;

-- 1.10 Devolver un job a la cola sin gastar un intento (no quedaba tiempo) ---------
create or replace function system.release_job(p_job_id uuid, p_worker_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update system.jobs j
     set status = 'queued', attempts = greatest(j.attempts - 1, 0), locked_at = null, locked_by = null,
         run_after = now()
   where j.id = p_job_id and j.status = 'running' and j.locked_by = p_worker_id;
  return found;
end
$$;
revoke all on function system.release_job(uuid, text) from public;
grant execute on function system.release_job(uuid, text) to system_worker;

-- 1.11 Mantenimiento de cada ejecución del runner: + importaciones atascadas ----------
create or replace function system.enqueue_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.enqueue_job('media.purge_orphans', '{}'::jsonb, null,
                          'media.purge_orphans:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
  perform app.enqueue_job('orders.expire', '{}'::jsonb, null,
                          'orders.expire:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'), now(), 3);
  perform app.enqueue_job('rate_limits.purge', '{}'::jsonb, null,
                          'rate_limits.purge:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
  perform app.enqueue_job('payments.reconcile', '{}'::jsonb, null,
                          'payments.reconcile:' || to_char(date_trunc('hour', now() at time zone 'utc')
                            + floor(extract(minute from now() at time zone 'utc') / 10) * interval '10 minutes',
                            'YYYY-MM-DD"T"HH24:MI'), now(), 3);
  perform app.enqueue_job('orders.complete', '{}'::jsonb, null,
                          'orders.complete:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
  perform system.fail_stuck_imports();
end
$$;
revoke all on function system.enqueue_maintenance() from public;
grant execute on function system.enqueue_maintenance() to system_worker;

-- 2. exports_rows sin app.default_level en un WHERE y con el alcance por rol (APP-M3) ----
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
              'seo_title', p.seo_title, 'seo_description', p.seo_description) as r
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
  return jsonb_build_object('entity', p_entity, 'pii', v_pii, 'rows', v_rows);
end
$$;

revoke all on function public.exports_rows(uuid, text) from public;
grant execute on function public.exports_rows(uuid, text) to authenticated;

-- =============================================================================
-- 3. Hallazgos de la revisión del gate (PHASE-08-REPORT §5)
-- =============================================================================

-- 3.1 DB-H1: vincular exige que ESTA sesión haya entrado con un código por email
-- (amr otp/magiclink reciente). email_confirmed_at solo no basta: con la
-- confirmación automática, un alta con contraseña "confirma" un email ajeno.
create or replace function app.session_proved_email(p_within interval default interval '15 minutes')
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from jsonb_array_elements(
                    case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) a
     where a ->> 'method' in ('otp', 'magiclink', 'email/signup')
       and jsonb_typeof(a -> 'timestamp') = 'number'
       and (a ->> 'timestamp')::numeric >= extract(epoch from now() - p_within))
$$;
revoke all on function app.session_proved_email(interval) from public;

-- DB-L1: la cuenta solo ve al cliente cuyo email sigue siendo el suyo.
create or replace function app.account_customer(p_store_id uuid)
returns public.customers
language sql
stable
security definer
set search_path = ''
as $$
  select c.* from public.customers c
    join public.stores s on s.id = c.store_id and s.status = 'active'
    join auth.users u on u.id = c.user_id
   where c.store_id = p_store_id and c.user_id = auth.uid() and auth.uid() is not null
     and c.email = lower(u.email)
     and c.anonymized_at is null and c.deleted_at is null
$$;
revoke all on function app.account_customer(uuid) from public;

create or replace function public.storefront_link_customer(p_store_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_cust  public.customers;
  v_old   public.customers;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'session';
  end if;
  select lower(u.email) into v_email from auth.users u
   where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null or not app.session_proved_email() then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'email_unverified';
  end if;
  if not exists (select 1 from public.stores s where s.id = p_store_id and s.status = 'active') then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'store';
  end if;

  select * into v_old from public.customers c where c.store_id = p_store_id and c.user_id = v_uid for update;
  if v_old.id is not null and v_old.email = v_email then
    return v_old.id;
  end if;

  select * into v_cust from public.customers c where c.store_id = p_store_id and c.email = v_email for update;
  if v_cust.anonymized_at is not null or v_cust.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'customer_closed';
  end if;
  if v_cust.user_id is not null and v_cust.user_id <> v_uid and exists (
       select 1 from auth.users u where u.id = v_cust.user_id and lower(u.email) = v_cust.email) then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'customer_linked';
  end if;
  -- La cuenta cambió de email: su cliente anterior (otro email) deja de ser suyo.
  if v_old.id is not null then
    update public.customers set user_id = null where id = v_old.id;
  end if;
  if v_cust.id is null then
    insert into public.customers (store_id, email, user_id) values (p_store_id, v_email, v_uid)
    returning * into v_cust;
  else
    -- Un vínculo de una cuenta que ya no tiene este email se libera (el email es la identidad).
    update public.customers set user_id = v_uid where id = v_cust.id;
  end if;
  perform audit.record('customer.account_linked', 'customer', v_cust.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, null);
  return v_cust.id;
end
$$;
revoke all on function public.storefront_link_customer(uuid) from public;
grant execute on function public.storefront_link_customer(uuid) to authenticated;

-- 3.2 DB-M1 / APP-M1: la marca del código queda atada a LA petición que lo pidió.
-- El servidor registra el intento con un nonce que viaja en redirect_to; el hook
-- solo aplica la marca de la tienda si el nonce coincide. Sin él (login del
-- panel, llamadas directas a Auth): plantilla de plataforma.
-- DB-L3: además del límite por tienda, uno global por email y por IP.
alter table system.auth_login_intents add column nonce_hash bytea check (nonce_hash is null or octet_length(nonce_hash) = 32);
drop function storefront.record_login_intent(uuid, text, text);
drop function system.login_intent_store(text);

create or replace function storefront.record_login_intent(p_store_id uuid, p_email text, p_ip_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_hash  bytea;
  v_nonce text;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'client';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'email';
  end if;
  if not exists (select 1 from public.stores s where s.id = p_store_id and s.status = 'active') then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'store';
  end if;
  v_hash := sha256(convert_to(v_email, 'UTF8'));
  if not app.rate_limit_take('buyer_otp:ip:' || p_store_id || ':' || p_ip_hash, 10, 900)
     or not app.rate_limit_take('buyer_otp:email:' || p_store_id || ':' || encode(v_hash, 'hex'), 5, 900)
     or not app.rate_limit_take('buyer_otp:ip:' || p_ip_hash, 30, 900)
     or not app.rate_limit_take('buyer_otp:email:' || encode(v_hash, 'hex'), 10, 900) then
    perform system.record_security_event('customer.login_rate_limited', 'warning', null, p_store_id, null, null, null,
                                         jsonb_build_object('ip_hash', left(p_ip_hash, 16)));
    return null;
  end if;
  v_nonce := encode(uuid_send(gen_random_uuid()), 'hex');  -- 122 bits aleatorios, sin extensiones
  delete from system.auth_login_intents where created_at < now() - interval '1 day';
  insert into system.auth_login_intents (email_hash, store_id, nonce_hash)
  values (v_hash, p_store_id, sha256(convert_to(v_nonce, 'UTF8')));
  return v_nonce;
end
$$;
revoke all on function storefront.record_login_intent(uuid, text, text) from public;
grant execute on function storefront.record_login_intent(uuid, text, text) to storefront_gateway;

create or replace function system.login_intent_store(p_email text, p_nonce text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'name', s.name,
    'logo_path', (select m.storage_path from public.store_themes t
                    join public.media m on m.store_id = t.store_id and m.id = t.logo_media_id
                   where t.store_id = s.id and m.status = 'ready' and m.deleted_at is null),
    'primary_color', (select t.settings -> 'colors' ->> 'primary' from public.store_themes t where t.store_id = s.id))
    from system.auth_login_intents i
    join public.stores s on s.id = i.store_id
   where p_nonce ~ '^[0-9a-f]{32}$'
     and i.email_hash = sha256(convert_to(lower(btrim(p_email)), 'UTF8'))
     and i.nonce_hash = sha256(convert_to(p_nonce, 'UTF8'))
     and i.created_at > now() - interval '15 minutes' and s.status = 'active'
   limit 1
$$;
revoke all on function system.login_intent_store(text, text) from public;
grant execute on function system.login_intent_store(text, text) to system_worker;

-- APP-M4: intentos de verificación del código por email (en todas las tiendas) y por IP.
create or replace function storefront.take_code_attempt(p_store_id uuid, p_email text, p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea := sha256(convert_to(lower(btrim(coalesce(p_email, ''))), 'UTF8'));
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'client';
  end if;
  if app.rate_limit_take('buyer_code:email:' || encode(v_hash, 'hex'), 8, 900)
     and app.rate_limit_take('buyer_code:ip:' || p_ip_hash, 30, 900) then
    return true;
  end if;
  perform system.record_security_event('customer.code_rate_limited', 'warning', null, p_store_id, null, null, null,
                                       jsonb_build_object('ip_hash', left(p_ip_hash, 16)));
  return false;
end
$$;
revoke all on function storefront.take_code_attempt(uuid, text, text) from public;
grant execute on function storefront.take_code_attempt(uuid, text, text) to storefront_gateway;

-- 3.3 DB-M2: la matriz de §12.3 permite al comprador (sus datos de contacto) y al
-- staff con customers.update editar la fila. Lo que valida la RPC se exige ahora en
-- la tabla (formato del teléfono, el mismo del checkout) y un cliente anonimizado
-- no recupera datos por ninguna vía.
alter table public.customers add constraint customers_phone_format
  check (phone is null or phone ~ '^\+?[0-9 ()-]{7,20}$') not valid;

create or replace function app.customers_anonymized_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Un cliente anonimizado no recupera datos personales por ninguna vía (ni un pago
  -- tardío de un pedido viejo, que no debe fallar por esto): se conservan los anónimos.
  if old.anonymized_at is not null then
    new.email := old.email;
    new.first_name := null;
    new.last_name := null;
    new.phone := null;
    new.note := null;
    new.user_id := null;
    new.accepts_marketing := false;
    new.marketing_consent_at := null;
    new.marketing_consent_source := null;
    new.anonymized_at := old.anonymized_at;
  end if;
  return new;
end
$$;
revoke all on function app.customers_anonymized_guard() from public;
create trigger customers_anonymized_guard before update on public.customers
  for each row execute function app.customers_anonymized_guard();

-- 3.4 DB-M3 / APP-M2: la auditoría nunca guarda el email completo de un comprador:
-- quien no es staff de la organización ni de la plataforma queda como «Cliente» con
-- el email enmascarado.
create or replace function app.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- DB-L2: nunca la parte local completa ni el dominio completo (a***@d***.com).
  select case when p_email is null or position('@' in p_email) = 0 then null
              else case when char_length(split_part(p_email, '@', 1)) <= 1 then ''
                        else left(split_part(p_email, '@', 1), 1) end
                   || '***@' || left(split_part(p_email, '@', 2), 1) || '***'
                   || coalesce(substring(split_part(p_email, '@', 2) from '(\.[^.]+)$'), '') end
$$;

create or replace function audit.record(
  p_action           text,
  p_entity_type      text,
  p_entity_id        uuid,
  p_organization_id  uuid  default null,
  p_store_id         uuid  default null,
  p_before           jsonb default null,
  p_after            jsonb default null,
  p_reason           text  default null,
  p_metadata         jsonb default '{}'::jsonb,
  p_support_grant_id uuid  default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_actor jsonb := nullif(current_setting('app.actor', true), '')::jsonb;
  v_type  text;
  v_label text;
begin
  if v_actor is not null then
    v_type  := coalesce(v_actor ->> 'type', 'system');
    v_label := coalesce(v_actor ->> 'label', 'system');
  elsif v_uid is not null then
    if exists (select 1 from public.platform_staff ps where ps.user_id = v_uid and ps.status = 'active') then
      v_type := 'platform_staff';
      v_label := coalesce((select u.email from auth.users u where u.id = v_uid), v_uid::text);
    elsif exists (select 1 from public.organization_members m
                   where m.user_id = v_uid
                     and m.organization_id = coalesce(p_organization_id,
                                                      (select s.organization_id from public.stores s where s.id = p_store_id))) then
      v_type := 'user';
      v_label := coalesce((select u.email from auth.users u where u.id = v_uid), v_uid::text);
    else
      -- Comprador (o alguien ajeno a la organización): sin PII completa (§29.3).
      v_type := 'user';
      v_label := 'Cliente ' || coalesce(app.mask_email((select u.email from auth.users u where u.id = v_uid)), '');
    end if;
  else
    v_type  := 'system';
    v_label := 'system';
  end if;

  insert into audit.audit_logs (
    organization_id, store_id, actor_type, actor_user_id, actor_label, support_grant_id,
    action, entity_type, entity_id, before, after, reason, metadata
  ) values (
    p_organization_id, p_store_id, v_type, v_uid, left(btrim(v_label), 200), p_support_grant_id,
    p_action, p_entity_type, p_entity_id, p_before, p_after, p_reason, coalesce(p_metadata, '{}'::jsonb)
  );
end
$$;

-- 3.5 DB-L9: retirar el consentimiento borra también su fecha y su origen.
create or replace function app.customers_consent_withdrawn()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.accepts_marketing and not new.accepts_marketing then
    new.marketing_consent_at := null;
    new.marketing_consent_source := null;
  end if;
  return new;
end
$$;
revoke all on function app.customers_consent_withdrawn() from public;
create trigger customers_consent_withdrawn before update of accepts_marketing on public.customers
  for each row execute function app.customers_consent_withdrawn();

-- 3.6 DB-L10: al anonimizar, sus carritos tampoco conservan email ni dirección.
create or replace function app.customers_anonymize_carts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.anonymized_at is null and new.anonymized_at is not null then
    update public.carts c set email = null, shipping_address = null
     where c.store_id = new.store_id and (c.customer_id = new.id or c.email = old.email);
  end if;
  return new;
end
$$;
revoke all on function app.customers_anonymize_carts() from public;
create trigger customers_anonymize_carts after update of anonymized_at on public.customers
  for each row execute function app.customers_anonymize_carts();

-- 3.7 DB-L8: categorías por ruta sin ambigüedad (orden fijo; mayúsculas exactas
-- primero) y nombres sin los separadores de la importación.
create or replace function app.category_by_path(p_store_id uuid, p_path text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parent uuid;
  v_id     uuid;
  v_name   text;
begin
  if nullif(btrim(p_path), '') is null then
    return null;
  end if;
  foreach v_name in array regexp_split_to_array(btrim(p_path), '\s*>\s*') loop
    select c.id into v_id from public.categories c
     where c.store_id = p_store_id and c.deleted_at is null and lower(c.name) = lower(btrim(v_name))
       and c.parent_id is not distinct from v_parent
     order by (c.name = btrim(v_name)) desc, c.position, c.created_at, c.id
     limit 1;
    if v_id is null then
      return null;
    end if;
    v_parent := v_id;
    v_id := null;
  end loop;
  return v_parent;
end
$$;
revoke all on function app.category_by_path(uuid, text) from public;
alter table public.categories add constraint categories_name_no_separators check (name !~ '[|>]') not valid;

-- 3.8 DB-L4/L5: rango de fechas del dashboard y existencias bajas ---------------
create or replace function public.dashboard_kpis(p_store_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz     text;
  v_to     date;
  v_from   date;
  v_start  timestamptz;
  v_end    timestamptz;
  v_gross  bigint;
  v_count  integer;
  v_refund bigint;
begin
  perform app.require_store_permission(p_store_id, 'analytics.read');
  select s.timezone into v_tz from public.stores s where s.id = p_store_id;
  if not isfinite(coalesce(p_from, current_date)) or not isfinite(coalesce(p_to, current_date)) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'range';
  end if;
  v_to := coalesce(p_to, (now() at time zone v_tz)::date);
  v_from := coalesce(p_from, v_to - 29);
  -- DB-L4: hasta 366 días contando ambos extremos.
  if v_to < v_from or v_to - v_from > 365 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'range';
  end if;
  v_start := v_from::timestamp at time zone v_tz;
  v_end := (v_to + 1)::timestamp at time zone v_tz;

  select coalesce(sum(o.total), 0)::bigint, count(*)::integer into v_gross, v_count
    from public.orders o
   where o.store_id = p_store_id and o.paid_at >= v_start and o.paid_at < v_end;
  select coalesce(sum(r.amount), 0)::bigint into v_refund
    from public.refunds r
   where r.store_id = p_store_id and r.status = 'succeeded' and r.updated_at >= v_start and r.updated_at < v_end;

  return jsonb_build_object(
    'from', v_from, 'to', v_to, 'timezone', v_tz,
    'gross_sales', v_gross,
    'refunds', v_refund,
    'net_sales', v_gross - v_refund,
    'orders', v_count,
    'average_ticket', case when v_count > 0 then round(v_gross::numeric / v_count)::bigint else 0 end,
    'series', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day::date, 'sales', coalesce(x.sales, 0),
                                                            'orders', coalesce(x.orders, 0)) order by d.day), '[]'::jsonb)
                 from generate_series(v_from, v_to, interval '1 day') as d(day)
                 left join (select (o.paid_at at time zone v_tz)::date as day, sum(o.total)::bigint as sales,
                                   count(*)::integer as orders
                              from public.orders o
                             where o.store_id = p_store_id and o.paid_at >= v_start and o.paid_at < v_end
                             group by 1) x on x.day = d.day::date),
    'top_products', (select coalesce(jsonb_agg(t order by (t ->> 'quantity')::integer desc, t ->> 'title'), '[]'::jsonb)
                       from (select jsonb_build_object('product_id', i.product_id, 'title', min(i.product_title),
                                                       'quantity', sum(i.quantity)::integer,
                                                       'revenue', sum(i.line_total)::bigint) as t
                               from public.order_items i
                               join public.orders o on o.store_id = i.store_id and o.id = i.order_id
                              where o.store_id = p_store_id and o.paid_at >= v_start and o.paid_at < v_end
                              -- Producto borrado después de la venta: se agrupa por el título del snapshot.
                              group by i.product_id, case when i.product_id is null then i.product_title end
                              order by sum(i.quantity) desc, min(i.product_title)
                              limit 5) q),
    'pending_payment', (select count(*)::integer from public.orders o
                         where o.store_id = p_store_id and o.status = 'pending_payment'),
    'needs_attention', (select count(*)::integer from public.orders o
                         where o.store_id = p_store_id and o.needs_attention),
    'to_fulfill', (select count(*)::integer from public.orders o
                    where o.store_id = p_store_id and o.status = 'open'
                      and o.fulfillment_status in ('unfulfilled', 'partially_fulfilled')),
    'low_stock', case when app.has_store_permission(p_store_id, 'inventory.read') then (
        select coalesce(jsonb_agg(jsonb_build_object('variant_id', l.variant_id, 'title', p.title,
                                                     'variant', v.option_signature, 'sku', v.sku,
                                                     'available', l.available, 'threshold', l.low_stock_threshold)
                                  order by l.available, p.title), '[]'::jsonb)
          -- DB-L5: lo borrado se descarta ANTES del límite de 10.
          from (select l.* from public.inventory_levels l
                  join public.product_variants v0 on v0.store_id = l.store_id and v0.id = l.variant_id
                                                 and v0.deleted_at is null
                  join public.products p0 on p0.store_id = v0.store_id and p0.id = v0.product_id
                                         and p0.deleted_at is null
                 where l.store_id = p_store_id and l.low_stock_threshold is not null
                   and l.available <= l.low_stock_threshold
                 order by l.available, l.id limit 10) l
          join public.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
          join public.products p on p.store_id = v.store_id and p.id = v.product_id)
      end);
end
$$;

revoke all on function public.dashboard_kpis(uuid, date, date) from public;
grant execute on function public.dashboard_kpis(uuid, date, date) to authenticated;

-- 3.9 DB-L11/APP-L15 y APP-M2: áreas de Actividad y compradores sin email ----------
create or replace function public.audit_list(p_store_id uuid, p_area text, p_cursor text, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prefixes text[];
  v_limit    integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_at       timestamptz;
  v_id       uuid;
  v_rows     jsonb;
  v_next     text;
begin
  perform app.require_store_permission(p_store_id, 'audit.read');
  v_prefixes := case coalesce(p_area, '')
    when '' then null
    when 'pedidos' then array['order.', 'payments.']
    when 'clientes' then array['customer.']
    when 'catalogo' then array['product.', 'brand.', 'category.', 'media.', 'inventory.']
    when 'tienda' then array['store.', 'theme.', 'menu.', 'page.', 'shipping.', 'discount.', 'config.', 'flag.',
                             'override.']
    when 'equipo' then array['member.', 'support_session.']
    when 'datos' then array['import.', 'export.']
    else array['invalid'] end;
  if v_prefixes = array['invalid'] then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'area';
  end if;
  if p_cursor is not null then
    begin
      v_at := split_part(p_cursor, '|', 1)::timestamptz;
      v_id := split_part(p_cursor, '|', 2)::uuid;
    exception when others then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'cursor';
    end;
  end if;

  with page as (
    select a.id, a.occurred_at, a.actor_type, a.actor_user_id, a.actor_label, a.support_grant_id is not null as via_support,
           a.action, a.entity_type, a.entity_id, a.before, a.after, a.reason
      from audit.audit_logs a
     where a.store_id = p_store_id
       and (v_prefixes is null or exists (select 1 from unnest(v_prefixes) p where starts_with(a.action, p)))
       and (v_at is null or (a.occurred_at, a.id) < (v_at, v_id))
     order by a.occurred_at desc, a.id desc
     limit v_limit + 1
  ), numbered as (
    -- APP-M2: un actor ajeno a la organización (comprador) nunca se muestra con su email.
    select page.*, row_number() over (order by occurred_at desc, id desc) as rn, count(*) over () as total,
           (page.actor_type = 'user' and page.actor_label like '%@%' and page.actor_label not like 'Cliente %'
            and not exists (
              select 1 from public.organization_members m join public.stores s on s.organization_id = m.organization_id
               where s.id = p_store_id and m.user_id = page.actor_user_id)) as is_buyer
      from page
  )
  select coalesce(jsonb_agg(jsonb_build_object('occurred_at', occurred_at, 'actor_type', actor_type,
                                               'actor_label', case when is_buyer then 'Cliente ' || coalesce(app.mask_email(actor_label), '')
                                                                   else actor_label end,
                                               'via_support', via_support,
                                               'action', action, 'entity_type', entity_type, 'entity_id', entity_id,
                                               'before', before, 'after', after, 'reason', reason)
                            order by occurred_at desc, id desc) filter (where rn <= v_limit), '[]'::jsonb),
         max(case when rn = v_limit and total > v_limit then occurred_at::text || '|' || id end)
    into v_rows, v_next
    from numbered;
  return jsonb_build_object('items', v_rows, 'next_cursor', v_next);
end
$$;

revoke all on function public.audit_list(uuid, text, text, integer) from public;
grant execute on function public.audit_list(uuid, text, text, integer) to authenticated;

-- =============================================================================
-- 4. Búsquedas por clave que no dependen de las estadísticas (Gate F8)
-- Con tablas sin analizar (tienda o plataforma nuevas, o una importación que las
-- hace crecer dentro de su transacción) el planificador elegía índices que
-- empiezan por store_id y recorría toda la tienda en cada búsqueda: 5 000 filas
-- tardaban más de un minuto. Ahora solo puede usarse el índice único exacto; el
-- resultado es el mismo.
-- =============================================================================
create or replace function app.lock_product(p_store_id uuid, p_product_id uuid, p_include_deleted boolean default false)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.products;
begin
  -- Solo por la clave primaria; la tienda se comprueba después (misma semántica).
  select * into v from public.products p where p.id = p_product_id for update;
  if v.id is null or v.store_id is distinct from p_store_id or (v.deleted_at is not null and not p_include_deleted) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'product';
  end if;
  return v;
end
$$;
revoke all on function app.lock_product(uuid, uuid, boolean) from public;

create or replace function app.default_level(p_store_id uuid, p_variant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- (variant_id, location_id) único. La ubicación es de p_store_id y la FK compuesta
  -- (store_id, location_id) garantiza que el nivel es de la misma tienda.
  select l.id
    from public.inventory_levels l
   where l.variant_id = p_variant_id
     and l.location_id = (select loc.id from public.inventory_locations loc
                           where loc.store_id = p_store_id and loc.is_default)
$$;
revoke all on function app.default_level(uuid, uuid) from public;
