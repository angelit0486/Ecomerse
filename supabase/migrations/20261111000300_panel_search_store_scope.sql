-- =============================================================================
-- Búsqueda del panel acotada a la tienda (Orden 06, escalón D, hallazgo CAP-08).
--
-- Medido con 500,000 productos en 50 tiendas: buscar en el panel de una tienda
-- de 10,000 productos pasó de 48 ms (una tienda) a 160 ms, y «agotados» de 61
-- a 200 ms. Causa: las subconsultas de `catalog_search_products` (SKU exacto,
-- existencias y sus ubicaciones) no decían de qué tienda eran; el planificador
-- recorría las variantes de TODA la plataforma. Crecía con el número de
-- tiendas, no con el tamaño de la tienda.
--
-- Arreglo: las mismas subconsultas con `store_id` (las llaves compuestas ya
-- garantizan que es la misma tienda: mismos resultados). Solo la función.
-- Reversa: la definición anterior está en 20261018003300 y posteriores.
-- =============================================================================

create or replace function public.catalog_search_products(
  p_store_id uuid, p_query text default null, p_status text default null, p_category_id uuid default null,
  p_deleted boolean default false, p_cursor jsonb default null, p_limit integer default 50,
  p_brand_id uuid default null, p_issue text default null, p_sort text default null)
returns table (id uuid, title text, slug text, status text, min_price bigint, max_price bigint, variant_count integer,
               updated_at timestamptz, deleted_at timestamptz, sort_key text)
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
         (select count(*)::integer from public.product_variants pv where pv.store_id = p.store_id and pv.product_id = p.id and pv.deleted_at is null),
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
             where v.store_id = p.store_id and v.product_id = p.id and v.deleted_at is null and v.status = 'active'
               and v.track_inventory and v.inventory_policy = 'deny'
               and coalesce((select sum(l.available) from public.inventory_levels l
                               join public.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id and loc.is_active
                              where l.store_id = v.store_id and l.variant_id = v.id), 0) <= 0))
     and (p_issue is distinct from 'pocas_existencias' or exists (
            select 1 from public.product_variants v
              join public.inventory_levels l on l.store_id = v.store_id and l.variant_id = v.id
              join public.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id and loc.is_active
             where v.store_id = p.store_id and v.product_id = p.id and v.deleted_at is null and v.status = 'active'
               and v.track_inventory and l.low_stock_threshold is not null
               and l.available > 0 and l.available <= l.low_stock_threshold))
     and (v_q is null
          or p.search_vector @@ v_tsq
          or extensions.similarity(p.title, v_q) > 0.3
          or exists (select 1 from public.product_variants pv where pv.store_id = p_store_id and pv.product_id = p.id
                       and pv.sku = upper(v_q) and pv.deleted_at is null))
     and (v_c_id is null
          or v_sort = 'recientes' and (p.updated_at, p.id) < (v_c_time, v_c_id)
          or v_sort = 'nombre' and (lower(p.title), p.id) > (v_c_text, v_c_id)
          or v_sort = 'precio_asc' and (coalesce(p.min_price, 0), p.id) > (v_c_num, v_c_id)
          or v_sort = 'precio_desc' and (coalesce(p.min_price, 0), p.id) < (v_c_num, v_c_id))
     -- El producto con el SKU exacto va primero solo en la primera página.
     and (v_c_id is null or v_q is null or not exists (
            select 1 from public.product_variants pv where pv.store_id = p_store_id and pv.product_id = p.id
               and pv.sku = upper(v_q) and pv.deleted_at is null))
   order by
     (v_q is not null and exists (select 1 from public.product_variants pv where pv.store_id = p_store_id and pv.product_id = p.id
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

-- ---------------------------------------------- Texto de búsqueda con orden fijo
-- `product_lexicon_of` (20261111000100) unía categorías, atributos y opciones
-- sin orden: el mismo producto podía guardar «vainilla chocolate» o «chocolate
-- vainilla». Con orden fijo, el texto guardado siempre coincide con el recalculado.
create or replace function app.product_lexicon_of(p_product public.products)
returns text
language sql
stable
set search_path = ''
as $$
  select lower(extensions.unaccent(concat_ws(' ',
           p_product.title,
           (select b.name from public.brands b where b.store_id = p_product.store_id and b.id = p_product.brand_id
                                                 and b.deleted_at is null),
           (select string_agg(c.name, ' ' order by c.name, c.id) from public.product_categories pc
              join public.categories c on c.store_id = pc.store_id and c.id = pc.category_id
             where pc.store_id = p_product.store_id and pc.product_id = p_product.id and c.deleted_at is null),
           (select string_agg(av.label, ' ' order by av.label, av.id) from public.product_attribute_values pav
              join public.attribute_values av on av.store_id = pav.store_id and av.id = pav.value_id
             where pav.store_id = p_product.store_id and pav.product_id = p_product.id),
           (select string_agg(ov.value, ' ' order by o.position, ov.position, ov.value) from public.product_options o
              join public.product_option_values ov on ov.store_id = o.store_id and ov.option_id = o.id
             where o.store_id = p_product.store_id and o.product_id = p_product.id))))
$$;
alter table public.products disable trigger products_set_updated_at;
update public.products p set search_lexicon = app.product_lexicon_of(p)
 where p.search_lexicon is distinct from app.product_lexicon_of(p);
alter table public.products enable trigger products_set_updated_at;

-- Versión del esquema (D-POR-06).
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261111000300'::text
$$;
