-- =============================================================================
-- Fase 8 · Importación de productos por CSV (F8-T04b). Contrato: GATE0 §26.1.
--
-- * import_jobs / import_job_rows (tablas de tienda: RLS forzado, FKc, sin
--   escritura directa). Lectura con imports.run.
-- * imports_create: guarda el plan validado en el servidor (mismos validadores
--   que el editor) y añade las validaciones contra la base (modo, SKU de otro
--   producto, marca y categorías). Nada se escribe en el catálogo.
-- * imports_commit: TODO o NADA (≤ 5 000 filas, una transacción). Usa
--   catalog_upsert_product / catalog_publish_product / inventory_adjust con la
--   sesión del solicitante: mismos permisos, invariantes y límites del plan.
--   El store_id del archivo no existe: lo fija el job.
-- * D-F8-05: validación síncrona en el servidor (≤ 5 000 filas, ≤ 5 MB); el
--   job asíncrono y los lotes > 5 000 quedan para cuando haga falta.
-- =============================================================================

create table public.import_jobs (
  id           uuid primary key default app.uuid_v7(),
  store_id     uuid not null references public.stores (id) on delete cascade,
  type         text not null check (type in ('products')),
  mode         text not null check (mode in ('create_only', 'update_existing', 'upsert')),
  status       text not null default 'validated'
               check (status in ('uploaded', 'validating', 'validated', 'committing', 'completed', 'failed',
                                 'cancelled', 'blocked')),
  file_name    text not null check (char_length(file_name) between 1 and 200),
  requested_by uuid references auth.users (id) on delete set null,
  totals       jsonb not null default '{}'::jsonb check (jsonb_typeof(totals) = 'object'),
  error        text check (error is null or char_length(error) <= 500),
  committed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (store_id, id)
);
create index import_jobs_store_idx on public.import_jobs (store_id, created_at desc);

create table public.import_job_rows (
  id            uuid primary key default app.uuid_v7(),
  store_id      uuid not null references public.stores (id) on delete cascade,
  import_job_id uuid not null,
  row_number    integer not null check (row_number between 2 and 100000),
  raw           jsonb not null check (jsonb_typeof(raw) = 'object'),
  normalized    jsonb,
  errors        jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  action        text check (action is null or action in ('create', 'update', 'skip', 'error')),
  entity_id     uuid,
  unique (store_id, id),
  unique (import_job_id, row_number),
  foreign key (store_id, import_job_id) references public.import_jobs (store_id, id) on delete cascade
);

create trigger import_jobs_set_updated_at before update on public.import_jobs
  for each row execute function app.set_updated_at();
create trigger import_jobs_prevent_tenant_change before update on public.import_jobs
  for each row execute function app.prevent_tenant_change();
create trigger import_job_rows_prevent_tenant_change before update on public.import_job_rows
  for each row execute function app.prevent_tenant_change();

alter table public.import_jobs enable row level security;
alter table public.import_jobs force row level security;
alter table public.import_job_rows enable row level security;
alter table public.import_job_rows force row level security;
revoke all on table public.import_jobs, public.import_job_rows from public, anon, authenticated, service_role;
grant select on table public.import_jobs, public.import_job_rows to authenticated;
create policy import_jobs_select on public.import_jobs for select to authenticated
  using (app.has_store_permission(store_id, 'imports.run'));
create policy import_job_rows_select on public.import_job_rows for select to authenticated
  using (app.has_store_permission(store_id, 'imports.run'));

-- Categoría por ruta de nombres ("Ropa > Camisas"), sin distinguir mayúsculas.
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
  foreach v_name in array regexp_split_to_array(p_path, '\s*>\s*') loop
    select c.id into v_id from public.categories c
     where c.store_id = p_store_id and c.deleted_at is null and lower(c.name) = lower(btrim(v_name))
       and c.parent_id is not distinct from v_parent
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

-- Inversa: "Ropa > Camisas" de una categoría (la exportación usa la misma ruta).
create or replace function app.category_name_path(p_store_id uuid, p_category_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select c.id, c.parent_id, c.name, 0 as depth from public.categories c
     where c.store_id = p_store_id and c.id = p_category_id
    union all
    select c.id, c.parent_id, c.name, up.depth + 1 from public.categories c
      join up on c.store_id = p_store_id and c.id = up.parent_id
     where up.depth < 20
  )
  select string_agg(name, ' > ' order by depth desc) from up
$$;
revoke all on function app.category_name_path(uuid, uuid) from public;

-- p_rows: [{row_number, raw, errors[], normalized|null}] (plan del servidor).
create or replace function public.imports_create(p_store_id uuid, p_mode text, p_file_name text, p_rows jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid;
  v_job       uuid;
  v_row       record;
  v_errors    jsonb;
  v_product   uuid;
  v_action    text;
  v_cat       text;
  v_var       jsonb;
  v_brands    boolean;
  v_can_new   boolean;
  v_can_edit  boolean;
  v_can_pub   boolean;
  v_can_stock boolean;
  v_create    integer := 0;
  v_update    integer := 0;
  v_failed    integer := 0;
begin
  v_uid := app.require_store_permission(p_store_id, 'imports.run');
  if p_mode is null or p_mode not in ('create_only', 'update_existing', 'upsert') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'mode';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rows';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'too_many_rows';
  end if;
  v_brands := app.has_store_permission(p_store_id, 'brands.manage');
  v_can_new := app.has_store_permission(p_store_id, 'products.create');
  v_can_edit := app.has_store_permission(p_store_id, 'products.update');
  v_can_pub := app.has_store_permission(p_store_id, 'products.publish');
  v_can_stock := app.has_store_permission(p_store_id, 'inventory.adjust');

  insert into public.import_jobs (store_id, type, mode, status, file_name, requested_by)
  values (p_store_id, 'products', p_mode, 'validating', left(btrim(coalesce(p_file_name, 'archivo.csv')), 200), v_uid)
  returning id into v_job;

  for v_row in
    select (x ->> 'row_number')::integer as row_number, coalesce(x -> 'raw', '{}'::jsonb) as raw,
           coalesce(x -> 'errors', '[]'::jsonb) as errors,
           nullif(x -> 'normalized', 'null'::jsonb) as normalized -- filas de variante: JSON null
      from jsonb_array_elements(p_rows) x
  loop
    -- Forma del plan: lo arma el servidor, pero la base no confía en ella.
    if v_row.row_number is null or jsonb_typeof(v_row.errors) <> 'array'
       or v_row.normalized is not null and (
            jsonb_typeof(v_row.normalized) <> 'object'
            or jsonb_typeof(v_row.normalized -> 'payload') is distinct from 'object'
            or jsonb_typeof(v_row.normalized -> 'payload' -> 'variants') is distinct from 'array'
            or jsonb_typeof(coalesce(v_row.normalized -> 'categories', '[]')) <> 'array'
            or jsonb_typeof(coalesce(v_row.normalized -> 'inventory', '[]')) <> 'array'
            or nullif(v_row.normalized ->> 'handle', '') is null) then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rows';
    end if;
    v_errors := v_row.errors;
    v_action := null;
    if v_row.normalized is not null and jsonb_typeof(v_row.normalized) = 'object' then
      select p.id into v_product from public.products p
       where p.store_id = p_store_id and p.slug = v_row.normalized ->> 'handle' and p.deleted_at is null;
      if v_product is null and p_mode = 'update_existing' then
        v_errors := v_errors || to_jsonb('handle: no existe un producto con ese handle'::text);
      elsif v_product is not null and p_mode = 'create_only' then
        v_errors := v_errors || to_jsonb('handle: ya existe un producto con ese handle'::text);
      end if;
      v_action := case when v_product is null then 'create' else 'update' end;
      -- Los mismos permisos que exigirá la confirmación, avisados por fila desde ya.
      if v_action = 'create' and not v_can_new or v_action = 'update' and not v_can_edit then
        v_errors := v_errors || to_jsonb('handle: tu rol no puede crear o editar productos'::text);
      end if;
      if (v_row.normalized ->> 'publish')::boolean and not v_can_pub then
        v_errors := v_errors || to_jsonb('status: tu rol no puede publicar productos'::text);
      end if;
      if jsonb_array_length(coalesce(v_row.normalized -> 'inventory', '[]')) > 0 and not v_can_stock then
        v_errors := v_errors || to_jsonb('inventory_quantity: tu rol no puede ajustar existencias'::text);
      end if;
      -- SKU de OTRO producto de la tienda.
      for v_var in select * from jsonb_array_elements(v_row.normalized -> 'payload' -> 'variants') loop
        if nullif(v_var ->> 'sku', '') is not null and exists (
             select 1 from public.product_variants pv
              where pv.store_id = p_store_id and pv.sku = upper(v_var ->> 'sku') and pv.deleted_at is null
                and pv.product_id is distinct from v_product) then
          v_errors := v_errors || to_jsonb(format('sku: %s ya pertenece a otro producto', v_var ->> 'sku'));
        end if;
      end loop;
      if nullif(v_row.normalized ->> 'brand', '') is not null and not v_brands
         and not exists (select 1 from public.brands b where b.store_id = p_store_id and b.deleted_at is null
                                                       and lower(b.name) = lower(v_row.normalized ->> 'brand')) then
        v_errors := v_errors || to_jsonb('brand: no existe y tu rol no puede crear marcas'::text);
      end if;
      for v_cat in select * from jsonb_array_elements_text(coalesce(v_row.normalized -> 'categories', '[]')) loop
        if app.category_by_path(p_store_id, v_cat) is null then
          v_errors := v_errors || to_jsonb(format('categories: no existe la categoría %s', v_cat));
        end if;
      end loop;
      v_product := null;
    end if;
    if jsonb_array_length(v_errors) > 0 then
      v_action := 'error';
      v_failed := v_failed + 1;
    elsif v_action = 'create' then
      v_create := v_create + 1;
    elsif v_action = 'update' then
      v_update := v_update + 1;
    end if;
    insert into public.import_job_rows (store_id, import_job_id, row_number, raw, normalized, errors, action)
    values (p_store_id, v_job, v_row.row_number, v_row.raw, v_row.normalized, v_errors, v_action);
  end loop;

  update public.import_jobs
     set status = 'validated',
         totals = jsonb_build_object('rows', jsonb_array_length(p_rows), 'create', v_create, 'update', v_update,
                                     'errors', v_failed)
   where id = v_job;
  perform audit.record('import.requested', 'import_job', v_job,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('type', 'products', 'mode', p_mode, 'rows', jsonb_array_length(p_rows),
                                                'errors', v_failed));
  return v_job;
end
$$;

create or replace function public.imports_commit(p_store_id uuid, p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job     public.import_jobs;
  v_row     record;
  v_n       jsonb;
  v_payload jsonb;
  v_product uuid;
  v_brand   uuid;
  v_inv     jsonb;
  v_variant uuid;
  v_current integer;
  v_created integer := 0;
  v_updated integer := 0;
  v_rownum  integer;
  v_msg     text;
  v_detail  text;
  v_hint    text;
begin
  perform app.require_store_permission(p_store_id, 'imports.run');
  select * into v_job from public.import_jobs j where j.store_id = p_store_id and j.id = p_job_id for update;
  if v_job.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'import_job';
  end if;
  if v_job.status = 'completed' then
    return jsonb_build_object('status', 'completed', 'replayed', true, 'totals', v_job.totals);
  end if;
  if v_job.status <> 'validated' or (v_job.totals ->> 'errors')::integer > 0 then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'import_not_ready';
  end if;

  -- Todo o nada: el bloque se revierte entero ante el primer error.
  begin
    for v_row in
      select r.* from public.import_job_rows r
       where r.store_id = p_store_id and r.import_job_id = v_job.id and r.normalized is not null
       order by r.row_number
    loop
      v_rownum := v_row.row_number;
      v_n := v_row.normalized;
      v_payload := v_n -> 'payload';
      select p.id into v_product from public.products p
       where p.store_id = p_store_id and p.slug = v_n ->> 'handle' and p.deleted_at is null;
      if v_product is not null and v_job.mode = 'create_only' or v_product is null and v_job.mode = 'update_existing' then
        raise exception using errcode = 'P0001', message = 'conflict', detail = 'handle';
      end if;
      -- Variantes existentes por SKU (se conservan sus ids); sin SKU, catalog_upsert_product
      -- las encuentra por su combinación de opciones. Las que el archivo no trae se retiran.
      if v_product is not null then
        v_payload := v_payload || jsonb_build_object('id', v_product, 'variants', (
          select jsonb_agg(v || coalesce((
                   select jsonb_build_object('id', pv.id) from public.product_variants pv
                    where pv.store_id = p_store_id and pv.product_id = v_product and pv.deleted_at is null
                      and nullif(v ->> 'sku', '') is not null and pv.sku = upper(v ->> 'sku')
                    limit 1), '{}'::jsonb) order by ord)
            from jsonb_array_elements(v_payload -> 'variants') with ordinality as t(v, ord)));
      end if;
      if nullif(v_n ->> 'brand', '') is not null then
        select b.id into v_brand from public.brands b
         where b.store_id = p_store_id and b.deleted_at is null and lower(b.name) = lower(v_n ->> 'brand') limit 1;
        if v_brand is null then
          v_brand := public.catalog_upsert_brand(p_store_id, jsonb_build_object('name', v_n ->> 'brand'));
        end if;
        v_payload := v_payload || jsonb_build_object('brand_id', v_brand);
      end if;
      if jsonb_array_length(coalesce(v_n -> 'categories', '[]')) > 0 then
        v_payload := v_payload || jsonb_build_object('categories', (
          select jsonb_agg(jsonb_build_object('id', app.category_by_path(p_store_id, c), 'is_primary', ord = 1) order by ord)
            from jsonb_array_elements_text(v_n -> 'categories') with ordinality as t(c, ord)));
      end if;
      v_product := (public.catalog_upsert_product(p_store_id, v_payload) ->> 'id')::uuid;
      if v_row.action = 'create' then v_created := v_created + 1; else v_updated := v_updated + 1; end if;

      -- Existencias físicas absolutas en la ubicación principal (clave por fila).
      for v_inv in select * from jsonb_array_elements(coalesce(v_n -> 'inventory', '[]')) loop
        select pv.id into v_variant from public.product_variants pv
         where pv.store_id = p_store_id and pv.product_id = v_product and pv.deleted_at is null
           and pv.position = (v_inv ->> 'variant_index')::integer
         limit 1;
        -- Sin cambio no hay movimiento (inventory_adjust rechaza un delta 0).
        if v_variant is not null and (select l.on_hand from public.inventory_levels l
                                       where l.id = app.default_level(p_store_id, v_variant))
                                     is distinct from (v_inv ->> 'quantity')::integer then
          perform public.inventory_adjust(p_store_id, v_variant, 'adjustment', (v_inv ->> 'quantity')::integer,
                                          'Importación ' || v_job.file_name, 'set',
                                          'import:' || v_job.id || ':' || (v_inv ->> 'row_number'));
        end if;
      end loop;
      if (v_n ->> 'publish')::boolean
         and (select p.status from public.products p where p.id = v_product) <> 'active' then
        perform public.catalog_publish_product(p_store_id, v_product);
      end if;
      update public.import_job_rows set entity_id = v_product where id = v_row.id;
    end loop;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
    update public.import_jobs
       set status = 'failed',
           error = left(format('Fila %s: %s', v_rownum, case
                    when v_msg = 'validation_failed' and v_detail = 'publish'
                      then 'no se puede publicar (' || coalesce(v_hint, 'revisa precio y variantes') || ')'
                    when v_msg = 'validation_failed' then 'dato no válido en ' || coalesce(v_detail, 'el producto')
                    when v_msg = 'forbidden' then 'tu rol no permite esta operación'
                    when v_msg = 'limit_reached' then 'se alcanzó el límite de productos de tu plan'
                    else 'no se pudo aplicar (' || v_msg || ')' end), 500)
     where id = v_job.id;
    return jsonb_build_object('status', 'failed', 'row_number', v_rownum, 'error', v_msg, 'detail', v_detail,
                              'hint', v_hint);
  end;

  update public.import_jobs
     set status = 'completed', committed_at = now(),
         totals = totals || jsonb_build_object('created', v_created, 'updated', v_updated)
   where id = v_job.id;
  perform audit.record('import.committed', 'import_job', v_job.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('created', v_created, 'updated', v_updated));
  return jsonb_build_object('status', 'completed', 'replayed', false, 'created', v_created, 'updated', v_updated);
end
$$;

revoke all on function public.imports_create(uuid, text, text, jsonb) from public;
revoke all on function public.imports_commit(uuid, uuid) from public;
grant execute on function public.imports_create(uuid, text, text, jsonb) to authenticated;
grant execute on function public.imports_commit(uuid, uuid) to authenticated;

-- exports_rows (F8-T04a): inventory_quantity de productos = on_hand de la ubicación
-- principal, el mismo significado que en la importación.
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
              -- Existencias físicas en la ubicación principal: lo mismo que fija la importación
              -- (ida y vuelta sin cambios). Antes salía "disponible" (descontaba reservas).
              'on_hand', case when v_inv then (select l.on_hand from public.inventory_levels l
                                               where l.id = app.default_level(v.store_id, v.id)) end,
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
