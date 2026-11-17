-- =============================================================================
-- Aplicar una importación más rápido (system.import_commit), sin cambiar qué
-- hace. Issue #18: la prueba de 18,000 filas (import-batch.spec.ts) falla en CI
-- cuando una parte de ~5,000 filas agota sus 3 intentos por statement_timeout
-- (~50-57 s); en local una parte tardaba ~25 s (margen de 2x).
--
-- Medido con pg_stat_statements y track_functions (2 partes de 4,998 filas,
-- 3,332 productos con 3 tallas, PostgreSQL 17.7 local; 49.5 s en total):
--   * 29 %: app.products_derive recalculaba search_vector y search_lexicon
--     8 veces por producto (cada variante, opción y valor «toca» el producto).
--   * 20 %: las dos consultas que excluyen los productos con filas con error
--     recorrían el lote entero por cada fila (anti-join anidado, cuadrático).
--   * En una base sin estadísticas (como la de CI), la parte 1 tardaba ~9 s más:
--     el único ANALYZE (a los 200 productos) dejaba las tablas «pequeñas» para
--     el planificador mientras crecían a miles de filas.
--
-- Arreglo:
--   1. app.products_derive: durante system.import_commit (marca local de la
--      transacción con su txid) sigue calculando min_price y max_price, pero
--      deja el texto de búsqueda para el final.
--   2. system.import_commit: al terminar las filas recalcula una vez el texto de
--      búsqueda de cada producto tocado (con la marca ya apagada) y excluye los
--      productos con error con un subplan con hash, calculado una sola vez.
--   3. ANALYZE dentro de la transacción a los 100, 400 y 1,000 productos cuando
--      la base no tiene estadísticas o el lote al menos duplica los productos de
--      la plataforma (antes: una vez, a los 200, y solo sin estadísticas).
--   Resultado (misma máquina, mismo lote): parte de 4,998 filas en una base sin
--   estadísticas 29.5 s → 12.1 s; con estadísticas 21.0 s → 11.2 s; parte de
--   2,499 filas sin estadísticas 12.2 s → 6.4 s.
--   Mismo resultado: mismos productos, mismo texto de búsqueda al confirmar,
--   mismo «todo o nada», mismos errores. Si la parte falla, la marca se revierte
--   con el bloque (set_config local dentro del subbloque).
--   La marca no da permisos ni salta límites: quien pudiera ponerla solo dejaría
--   desactualizado el texto de búsqueda de sus propios productos hasta la
--   siguiente edición; vale solo para el txid de la transacción que la puso.
--
-- Reversa: scripts/ops/reversa/20261117000100_import_commit_speed.reversa.sql
--   (vuelve a las definiciones de 20261111000100 y 20261113000200; sin datos que
--   perder: no hay tablas ni columnas nuevas).
-- =============================================================================

create or replace function app.products_derive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select min(pv.price), max(pv.price) into new.min_price, new.max_price
    from public.product_variants pv
   where pv.product_id = new.id and pv.status = 'active' and pv.deleted_at is null;
  -- system.import_commit lo recalcula una vez por producto al final del lote.
  if current_setting('app.import_defer_search', true) is distinct from pg_catalog.txid_current()::text then
    new.search_vector := app.product_search_vector(new);
    new.search_lexicon := app.product_lexicon_of(new);
  end if;
  return new;
end
$$;

-- La confirmación: igual que en 20261113000200, con el texto de búsqueda al final
-- y la exclusión de productos con error calculada una vez.
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
  v_touched  uuid[] := '{}';
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
     -- Productos con alguna fila con error: se calcula UNA vez (subplan con hash);
     -- antes se recorría el lote entero por cada fila (cuadrático).
     and lower(btrim(coalesce(r.raw ->> 'handle', ''))) not in (
           select lower(btrim(coalesce(e.raw ->> 'handle', ''))) from public.import_job_rows e
            where e.import_job_id = v_job.id and jsonb_array_length(e.errors) > 0);
  -- Plataforma recién creada: sin estadísticas, el planificador recorre tablas
  -- enteras en cada búsqueda mientras el lote las hace crecer (cuadrático).
  v_cold := not exists (select 1 from pg_catalog.pg_stats st
                         where st.schemaname = 'public' and st.tablename = 'products' and st.attname = 'store_id')
         or not exists (select 1 from pg_catalog.pg_stats st
                         where st.schemaname = 'public' and st.tablename = 'inventory_levels' and st.attname = 'variant_id')
         -- O estadísticas de un catálogo mucho más chico que el que deja este lote
         -- (la importación al menos duplica los productos de toda la plataforma):
         -- los planes de una tabla «pequeña» se quedan aunque crezca a miles de filas.
         or (v_creates >= 100
             and (select c.reltuples from pg_catalog.pg_class c where c.oid = 'public.products'::regclass) < v_creates);

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

    -- El texto de búsqueda de cada producto se calcula UNA vez al final, no en
    -- cada variante, opción o categoría que se escribe (app.products_derive).
    -- Solo esta transacción (el valor es su txid) y se revierte con el bloque.
    perform set_config('app.import_defer_search', pg_catalog.txid_current()::text, true);

    for v_row in
      select r.id, r.row_number, r.normalized from public.import_job_rows r
       where r.import_job_id = v_job.id and r.normalized is not null
         and lower(btrim(coalesce(r.raw ->> 'handle', ''))) not in (
             select lower(btrim(coalesce(e.raw ->> 'handle', ''))) from public.import_job_rows e
              where e.import_job_id = v_job.id and jsonb_array_length(e.errors) > 0)
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

      -- Lo que entra en el texto de búsqueda (ficha, variantes, opciones,
      -- categorías, atributos) solo cambia por estas dos vías.
      if (v_res ->> 'touches_catalog')::boolean or v_res ? 'attribute_value_ids' then
        v_touched := v_touched || v_product;
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
      if v_cold and v_done in (100, 400, 1000) then
        -- ANALYZE ve las filas de esta transacción y los planes siguientes usan los
        -- índices únicos. Tres veces (100, 400 y 1,000 productos), porque con una
        -- sola, a los 200, las tablas seguían «pequeñas» para el planificador
        -- mientras crecían a miles de filas (medido: 20.1 s → 11.9 s la parte fría).
        analyze public.products, public.product_variants, public.product_options, public.product_option_values,
                public.variant_option_values, public.inventory_levels, public.inventory_movements,
                public.product_categories, public.brands;
        v_cold := v_done < 1000;
      end if;
    end loop;

    v_rownum := null;
    -- Texto de búsqueda (search_vector, search_lexicon) con los datos finales de
    -- cada producto tocado: el trigger products_derive lo recalcula al actualizar.
    perform set_config('app.import_defer_search', '', true);
    update public.products p set updated_at = now() where p.id = any(v_touched);
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
  select '20261117000100'::text
$$;
