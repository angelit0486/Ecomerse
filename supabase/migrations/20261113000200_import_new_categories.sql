-- =============================================================================
-- ADR-065, opción A (aprobada por el propietario, Orden 10 mensaje 4): crear
-- durante la importación las categorías que falten, con vista previa y
-- confirmación explícita. Apagado por defecto: sin aceptar nada, una categoría
-- que no existe sigue siendo un error de la fila (como siempre).
--
--  * app.import_missing_categories: qué categorías faltan en una vista previa,
--    con cuántos productos y filas las usan, si se pueden crear y avisos de
--    nombres parecidos (solo avisos: nunca se fusiona una categoría con otra).
--    Mismo criterio que app.category_by_path: por segmento, sin distinguir
--    mayúsculas. No se pueden crear: un nombre cuya dirección (slug) ya usa otra
--    categoría con otro nombre (p. ej. «Lacteos» frente a «Lácteos»), la misma
--    escrita distinto en otras filas, nombres no válidos o más de 3 niveles.
--  * public.imports_new_categories: lo anterior para la vista previa.
--  * public.imports_accept_categories: la tienda acepta (o deja de aceptar) la
--    lista; exige categories.manage. Recalcula los errores de categoría de las
--    filas y los totales; nada se crea todavía.
--  * system.import_commit: crea las categorías aceptadas al confirmar, en la
--    MISMA transacción que los productos y como quien confirmó (revalida sus
--    permisos, CF-10). Si la importación falla, no queda ninguna categoría.
--    Dos importaciones simultáneas que crean la misma categoría: el índice único
--    de la dirección decide y la segunda usa la que creó la primera.
--  * Puntos de extensión para la publicación masiva (20261113000300):
--    app.import_request_publish (aquí: publica como antes) y
--    app.import_after_rows (aquí: no hace nada).
--
-- Reversa: volver a la definición de system.import_commit de
--   20261027000200_import_skip_errors.sql; drop de las funciones nuevas y de la
--   columna import_jobs.new_categories. Las categorías ya creadas se quedan
--   (son datos de la tienda); se borran desde el panel si hace falta.
-- =============================================================================

alter table public.import_jobs
  add column new_categories text[] not null default '{}'
    check (cardinality(new_categories) <= 200);

-- Clave de comparación de una ruta («Ropa > Calzado»): como category_by_path.
create function app.import_category_key(p_path text)
returns text
language sql
immutable
set search_path = ''
as $$
  select string_agg(lower(btrim(s)), ' > ' order by o)
    from unnest(regexp_split_to_array(btrim(coalesce(p_path, '')), '\s*>\s*')) with ordinality as t(s, o)
$$;
revoke all on function app.import_category_key(text) from public;

-- Qué categorías faltan en la vista previa de una importación.
create function app.import_missing_categories(p_store_id uuid, p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job     public.import_jobs;
  v_item    record;
  v_out     jsonb := '[]'::jsonb;
  v_segs    text[];
  v_parent  uuid;
  v_id      uuid;
  v_seg     text;
  v_i       integer;
  v_reason  text;
  v_hint    text;
  v_slugs   jsonb := '{}'::jsonb;   -- padre + dirección de cada categoría nueva → su nombre
  v_slugkey text;
  v_pkey    text;                   -- identidad del padre: id existente o ruta nueva
  v_deleted boolean;
  v_similar jsonb;
begin
  select * into v_job from public.import_jobs j where j.store_id = p_store_id and j.id = p_job_id;
  if v_job.id is null then
    return '[]'::jsonb;
  end if;
  for v_item in
    with c as (
      select btrim(x.c) as path, app.import_category_key(x.c) as key, r.row_number,
             coalesce(r.normalized ->> 'handle', '') as handle
        from public.import_job_rows r
        cross join lateral jsonb_array_elements_text(
          case when jsonb_typeof(r.normalized -> 'categories') = 'array' then r.normalized -> 'categories'
               else '[]'::jsonb end) as x(c)
       where r.store_id = p_store_id and r.import_job_id = p_job_id and r.normalized is not null
         and nullif(btrim(x.c), '') is not null
    )
    select c.key,
           (array_agg(c.path order by c.row_number))[1] as path,
           min(c.row_number) as first_row,
           count(distinct c.handle)::integer as products,
           count(*)::integer as rows
      from c
     where app.category_by_path(p_store_id, c.path) is null
     group by c.key
     order by min(c.row_number)
  loop
    v_reason := null;
    v_hint := null;
    v_segs := regexp_split_to_array(v_item.path, '\s*>\s*');
    if cardinality(v_segs) > 3 then
      v_reason := 'too_deep';
    end if;
    -- Recorre la ruta: los segmentos que existen se reutilizan; el primero que
    -- falta (y los que siguen) se crearían.
    v_parent := null;
    v_pkey := 'raiz';
    v_i := 0;
    foreach v_seg in array v_segs loop
      exit when v_reason is not null;
      v_i := v_i + 1;
      v_seg := btrim(v_seg);
      if char_length(v_seg) not between 1 and 120 or v_seg ~ '[|>]' or not app.slug_valid(app.slugify(v_seg)) then
        v_reason := 'invalid_name';
        exit;
      end if;
      select c.id into v_id from public.categories c
       where c.store_id = p_store_id and c.deleted_at is null and lower(c.name) = lower(v_seg)
         and c.parent_id is not distinct from v_parent
       order by (c.name = v_seg) desc, c.position, c.created_at, c.id limit 1;
      if v_id is not null then
        v_parent := v_id;
        v_pkey := 'id:' || v_id::text;
        v_id := null;
        continue;
      end if;
      -- Falta este segmento: su dirección no puede chocar con otra categoría
      -- (la dirección es única por padre, también con las borradas).
      if v_pkey not like 'nueva:%' then
        select c.name, c.deleted_at is not null into v_hint, v_deleted
          from public.categories c
         where c.store_id = p_store_id and c.parent_id is not distinct from v_parent
           and c.slug = app.slugify(v_seg)
         order by c.deleted_at nulls first limit 1;
        if v_hint is not null then
          v_reason := case when v_deleted then 'slug_deleted' else 'slug_taken' end;
          exit;
        end if;
      end if;
      -- Dos nuevas con la misma dirección escritas distinto («Lacteos», «Lácteos»).
      v_slugkey := v_pkey || '/' || app.slugify(v_seg);
      if v_slugs ? v_slugkey and v_slugs ->> v_slugkey <> lower(v_seg) then
        v_reason := 'spelling';
        v_hint := v_slugs ->> v_slugkey;
        exit;
      end if;
      v_slugs := v_slugs || jsonb_build_object(v_slugkey, lower(v_seg));
      -- Lo que sigue cuelga de una categoría nueva: no hay nada que buscar en la base.
      v_pkey := 'nueva:' || v_slugkey;
    end loop;

    -- Avisos de nombres parecidos (nunca se fusionan solos).
    select coalesce(jsonb_agg(s.name order by s.score desc), '[]'::jsonb) into v_similar
      from (select c.name, extensions.similarity(lower(c.name), lower(btrim(v_segs[cardinality(v_segs)]))) as score
              from public.categories c
             where c.store_id = p_store_id and c.deleted_at is null
               and lower(c.name) <> lower(btrim(v_segs[cardinality(v_segs)]))
               and extensions.similarity(lower(c.name), lower(btrim(v_segs[cardinality(v_segs)]))) >= 0.4
             order by 2 desc limit 3) s;

    v_out := v_out || jsonb_build_object(
      'path', v_item.path, 'key', v_item.key, 'first_row', v_item.first_row,
      'products', v_item.products, 'rows', v_item.rows,
      'creatable', v_reason is null, 'reason', v_reason, 'hint', v_hint,
      'similar', v_similar,
      'accepted', v_item.key = any (select app.import_category_key(a) from unnest(v_job.new_categories) a));
  end loop;
  return v_out;
end
$$;
revoke all on function app.import_missing_categories(uuid, uuid) from public;

-- Para la vista previa del panel.
create function public.imports_new_categories(p_store_id uuid, p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'imports.run');
  if not exists (select 1 from public.import_jobs j where j.store_id = p_store_id and j.id = p_job_id) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'import_job';
  end if;
  return jsonb_build_object(
    'can_create', app.has_store_permission(p_store_id, 'categories.manage'),
    'accepted', (select to_jsonb(j.new_categories) from public.import_jobs j where j.id = p_job_id),
    'missing', app.import_missing_categories(p_store_id, p_job_id));
end
$$;
revoke all on function public.imports_new_categories(uuid, uuid) from public;
grant execute on function public.imports_new_categories(uuid, uuid) to authenticated;

-- Recalcula los errores de categoría de cada fila con la lista aceptada y los
-- totales de la importación. Uso interno (accept y lotes).
create function app.import_recheck_categories(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job      public.import_jobs;
  v_accepted text[];
  v_row      record;
  v_errors   jsonb;
  v_cat      text;
  v_res      jsonb;
begin
  select * into v_job from public.import_jobs j where j.id = p_job_id for update;
  v_accepted := array(select app.import_category_key(a) from unnest(v_job.new_categories) a);
  for v_row in
    select r.id, r.row_number, r.normalized, r.errors, r.action from public.import_job_rows r
     where r.store_id = v_job.store_id and r.import_job_id = v_job.id and r.normalized is not null
       and jsonb_typeof(r.normalized -> 'categories') = 'array'
  loop
    -- Sin los errores de categoría que puso la validación…
    select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into v_errors
      from jsonb_array_elements(v_row.errors) with ordinality as t(e, o)
     where (e #>> '{}') not like 'categories: no existe la categoría %';
    -- …y con los de hoy: las que siguen sin existir y no se aceptaron.
    for v_cat in select c #>> '{}' from jsonb_array_elements(v_row.normalized -> 'categories') c
                  where jsonb_typeof(c) = 'string' and nullif(btrim(c #>> '{}'), '') is not null loop
      if app.category_by_path(v_job.store_id, v_cat) is null
         and not (app.import_category_key(v_cat) = any (v_accepted)) then
        v_errors := v_errors || to_jsonb(left(format('categories: no existe la categoría %s', left(v_cat, 200)), 300));
      end if;
    end loop;
    continue when v_errors = v_row.errors;
    update public.import_job_rows set errors = v_errors where id = v_row.id;
    if jsonb_array_length(v_errors) > 0 then
      update public.import_job_rows set action = 'error' where id = v_row.id;
    elsif v_row.action = 'error' then
      -- La fila quedó sin errores: se resuelve otra vez con los datos de ahora.
      v_res := app.import_resolve(v_job.store_id, v_job.mode, v_row.normalized);
      if jsonb_array_length(v_res -> 'errors') > 0 then
        update public.import_job_rows
           set errors = (select coalesce(jsonb_agg(to_jsonb(left(x ->> 'message', 300))), '[]'::jsonb)
                           from jsonb_array_elements(v_res -> 'errors') x),
               action = 'error'
         where id = v_row.id;
      else
        update public.import_job_rows set action = v_res ->> 'action' where id = v_row.id;
      end if;
    end if;
  end loop;
  update public.import_jobs j
     -- imports_create nunca pide categories.manage: solo lo pide la lista aceptada.
     set needs = (select array_agg(distinct n order by n)
                    from unnest(array_remove(coalesce(j.needs, '{}'), 'categories.manage') ||
                                case when cardinality(j.new_categories) > 0 then array['categories.manage'] else '{}' end) n),
         totals = j.totals || (select jsonb_build_object(
                     'rows', count(*),
                     'products', count(*) filter (where r.normalized is not null),
                     'create', count(*) filter (where r.action = 'create'),
                     'update', count(*) filter (where r.action = 'update'),
                     'errors', count(*) filter (where r.action = 'error'),
                     'new_categories', cardinality(j.new_categories))
                     from public.import_job_rows r where r.import_job_id = j.id)
   where j.id = v_job.id;
end
$$;
revoke all on function app.import_recheck_categories(uuid) from public;

-- La tienda acepta la lista de categorías que se crearán al confirmar.
create function public.imports_accept_categories(p_store_id uuid, p_job_id uuid, p_paths text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid;
  v_job     public.import_jobs;
  v_missing jsonb;
  v_keys    text[];
  v_paths   text[];
begin
  v_uid := app.require_store_permission(p_store_id, 'imports.run');
  perform app.require_store_permission(p_store_id, 'categories.manage');
  select * into v_job from public.import_jobs j where j.store_id = p_store_id and j.id = p_job_id for update;
  if v_job.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'import_job';
  end if;
  if v_job.status <> 'validated' then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'import_not_validated';
  end if;
  if coalesce(cardinality(p_paths), 0) > 200 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'categories';
  end if;
  -- Cada ruta pedida debe ser una de las que faltan y poderse crear; se guarda
  -- con la forma en que la escribió el archivo (la primera vez que aparece).
  v_missing := app.import_missing_categories(p_store_id, p_job_id);
  v_keys := array(select distinct app.import_category_key(p) from unnest(coalesce(p_paths, '{}')) p
                   where nullif(btrim(p), '') is not null);
  if exists (select 1 from unnest(v_keys) k
              where not exists (select 1 from jsonb_array_elements(v_missing) m
                                 where m ->> 'key' = k and (m ->> 'creatable')::boolean)) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'categories';
  end if;
  v_paths := array(select m ->> 'path' from jsonb_array_elements(v_missing) m where m ->> 'key' = any (v_keys)
                    order by (m ->> 'first_row')::integer);
  update public.import_jobs set new_categories = v_paths where id = v_job.id;
  perform app.import_recheck_categories(v_job.id);
  perform audit.record('import.categories_accepted', 'import_job', v_job.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('categories', to_jsonb(v_paths)));
  return (select jsonb_build_object('accepted', to_jsonb(j.new_categories), 'totals', j.totals)
            from public.import_jobs j where j.id = v_job.id);
end
$$;
revoke all on function public.imports_accept_categories(uuid, uuid, text[]) from public;
grant execute on function public.imports_accept_categories(uuid, uuid, text[]) to authenticated;

-- Crea (o encuentra) una ruta de categorías como quien confirmó la importación.
-- Solo dentro de system.import_commit (la sesión del solicitante ya está puesta).
create function app.import_ensure_category(p_store_id uuid, p_path text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent  uuid;
  v_id      uuid;
  v_seg     text;
  v_created boolean := false;
begin
  foreach v_seg in array regexp_split_to_array(btrim(p_path), '\s*>\s*') loop
    v_seg := btrim(v_seg);
    select c.id into v_id from public.categories c
     where c.store_id = p_store_id and c.deleted_at is null and lower(c.name) = lower(v_seg)
       and c.parent_id is not distinct from v_parent
     order by (c.name = v_seg) desc, c.position, c.created_at, c.id limit 1;
    if v_id is null then
      begin
        v_id := public.catalog_upsert_category(p_store_id, jsonb_build_object('name', v_seg, 'parent_id', v_parent));
        v_created := true;
      exception when others then
        -- Otra importación la creó al mismo tiempo (el índice único de la
        -- dirección esperó a que terminara): se usa esa.
        select c.id into v_id from public.categories c
         where c.store_id = p_store_id and c.deleted_at is null and lower(c.name) = lower(v_seg)
           and c.parent_id is not distinct from v_parent
         order by c.created_at, c.id limit 1;
        if v_id is null then
          raise exception using errcode = 'P0001', message = 'import_category',
            detail = format('no se pudo crear la categoría %s', left(p_path, 200));
        end if;
      end;
    end if;
    v_parent := v_id;
    v_id := null;
  end loop;
  return v_created;
end
$$;
revoke all on function app.import_ensure_category(uuid, text) from public;

-- Puntos de extensión de la confirmación (la publicación masiva los redefine).
create function app.import_request_publish(p_job_id uuid, p_store_id uuid, p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Comportamiento de siempre: publicar ahora (si no cumple, la importación falla).
  perform public.catalog_publish_product(p_store_id, p_product_id);
end
$$;
revoke all on function app.import_request_publish(uuid, uuid, uuid) from public;

create function app.import_after_rows(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  return;
end
$$;
revoke all on function app.import_after_rows(uuid) from public;

-- La confirmación: igual que en 20261027000200, más las categorías aceptadas y
-- los dos puntos de extensión.
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
  v_cats     integer := 0;
  v_path     text;
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
  select count(*) into v_creates from public.import_job_rows r
   where r.import_job_id = v_job.id and r.action = 'create'
     and not exists (select 1 from public.import_job_rows e
                                 where e.import_job_id = r.import_job_id and jsonb_array_length(e.errors) > 0
                                   and lower(btrim(coalesce(e.raw ->> 'handle', '')))
                                       = lower(btrim(coalesce(r.raw ->> 'handle', ''))));
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

    -- ADR-065: las categorías aceptadas en la vista previa, dentro de esta misma
    -- transacción (si la importación falla, no queda ninguna).
    foreach v_path in array v_job.new_categories loop
      if app.import_ensure_category(v_job.store_id, v_path) then
        v_cats := v_cats + 1;
      end if;
    end loop;

    for v_row in
      select r.id, r.row_number, r.normalized from public.import_job_rows r
       where r.import_job_id = v_job.id and r.normalized is not null
         and not exists (select 1 from public.import_job_rows e
                                 where e.import_job_id = r.import_job_id and jsonb_array_length(e.errors) > 0
                                   and lower(btrim(coalesce(e.raw ->> 'handle', '')))
                                       = lower(btrim(coalesce(r.raw ->> 'handle', ''))))
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
        -- Una categoría que sigue sin existir (no se aceptó, o la borraron
        -- después de la vista previa) es un error de la fila, no un producto a medias.
        if exists (select 1 from jsonb_array_elements(v_payload -> 'categories') x where x -> 'id' = 'null'::jsonb) then
          raise exception using errcode = 'P0001', message = 'import_row',
            detail = 'categories: una categoría de la fila ya no existe';
        end if;
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
          perform app.import_request_publish(v_job.id, v_job.store_id, v_product);
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

    v_rownum := null;
    perform app.import_after_rows(v_job.id);

    -- Comprobación final del límite con todo lo creado, ahora con el candado de la
    -- organización (lo suelta el commit, un instante después).
    if v_creates > 0 then
      delete from system.product_limit_bulk where txid = pg_catalog.txid_current() and store_id = v_job.store_id;
      perform app.assert_within_limit(v_org, 'max_products', 0);
    end if;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
    v_error := case
      when v_msg in ('import_row', 'import_category') then v_detail
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
         totals = totals || jsonb_build_object('created', v_created, 'updated', v_updated,
                                           'skipped', coalesce((totals ->> 'errors')::integer, 0),
                                           'categories_created', v_cats)
   where id = v_job.id;
  perform audit.record('import.committed', 'import_job', v_job.id, v_org, v_job.store_id,
                       null, jsonb_build_object('created', v_created, 'updated', v_updated, 'file', v_job.file_name,
                                          'skipped_error_rows', coalesce((v_job.totals ->> 'errors')::integer, 0),
                                          'categories_created', v_cats));
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('status', 'completed', 'created', v_created, 'updated', v_updated,
                            'categories_created', v_cats);
end
$$;

-- Versión del esquema (D-POR-06).
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261113000200'::text
$$;
