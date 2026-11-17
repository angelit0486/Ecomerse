-- =============================================================================
-- Reversa de 20261117000100_import_commit_speed.sql (importación más rápida,
-- issue #18). 2026-11-17.
--
-- SIN PÉRDIDA: la migración no agregó tablas, columnas ni datos; solo redefinió
-- app.products_derive y system.import_commit y subió la versión. Esto vuelve a
-- las definiciones de 20261111000100_search_lexicon.sql (products_derive) y de
-- 20261113000200_import_new_categories.sql (import_commit) y deja
-- public.app_schema_version() EXACTA a la de 20261113000400. El esquema queda
-- idéntico (pg_dump -s, con permisos) al de una base con las migraciones hasta
-- 20261113000400; lo prueba scripts/ops/reversa/comprobar-0400.sh (paso 0).
--
-- El código no usa nada nuevo de esta migración, pero espera su versión
-- (EXPECTED_SCHEMA_VERSION 20261117000100, D-POR-06): con la base en 0400 el panel
-- y la tienda mostrarían «mantenimiento». Orden: 1. desplegar el código que
-- espera 20261113000400 (producto/orden-10 sin este cambio); 2. correr esto.
-- Una importación que se esté aplicando al correr esto termina con la
-- definición con que empezó (CREATE OR REPLACE no la corta).
--
-- ORDEN DE REVERSA: de la migración más nueva a la más vieja, cada una con su
-- candado de versión. La reversa de 0400 se rechaza mientras la base esté en
-- esta versión.
--
-- Uso (SOLO con autorización y en la ventana): psql -X -1 -v ON_ERROR_STOP=1 -f <este archivo>
-- =============================================================================

-- Candado: solo sobre una base exactamente en 20261117000100.
do $$
begin
  if coalesce(public.app_schema_version(), '') <> '20261117000100' then
    raise exception using errcode = 'P0001', message = 'reversa_bloqueada',
      detail = format('La base está en %s; esta reversa solo aplica a 20261117000100.',
                      coalesce(public.app_schema_version(), 'desconocida'));
  end if;
end
$$;

-- 1. app.products_derive como en 20261111000100_search_lexicon.sql.
create or replace function app.products_derive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select min(pv.price), max(pv.price) into new.min_price, new.max_price
    from public.product_variants pv
   where pv.product_id = new.id and pv.status = 'active' and pv.deleted_at is null;
  new.search_vector := app.product_search_vector(new);
  new.search_lexicon := app.product_lexicon_of(new);
  return new;
end
$$;

-- 2. system.import_commit como en 20261113000200_import_new_categories.sql.
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

-- 3. Versión del esquema (D-POR-06): idéntica a la de 20261113000400_import_batches.sql.
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261113000400'::text
$$;
