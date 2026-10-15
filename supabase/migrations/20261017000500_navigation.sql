-- =============================================================================
-- Fase 9 · F9-T04 — Navegación y listados (F9-DESIGN §10). Solo lecturas del
-- storefront, sin tablas nuevas:
--   1. storefront.list_products: `published_at` en cada tarjeta (insignia
--      «Nuevo») y `p_brands` (filtro de marca, OR entre marcas, AND con lo demás).
--   2. storefront.list_facets: `p_brands` y la faceta «Marca» (clave `marca`,
--      reservada para atributos desde R-T04) con conteo.
--   3. storefront.search_suggestions: productos, categorías, marcas y valores de
--      atributos filtrables publicados que coinciden con lo que se escribe.
-- Todas SECURITY DEFINER con search_path vacío, solo para storefront_gateway.
-- =============================================================================

-- Productos del listado que cumplen el filtro de marca (null = sin filtro).
create or replace function app.product_in_brands(p_store_id uuid, p_product_id uuid, p_brands text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_brands is null or cardinality(p_brands) = 0 or exists (
    select 1 from public.products p
      join public.brands b on b.store_id = p.store_id and b.id = p.brand_id and b.deleted_at is null
     where p.store_id = p_store_id and p.id = p_product_id and b.slug = any (p_brands))
$$;
revoke all on function app.product_in_brands(uuid, uuid, text[]) from public;

-- 1. Listado: mismo contrato que R-T04 más `p_brands` al final (con default: las
-- llamadas existentes no cambian) y `published_at` en cada tarjeta.
drop function storefront.list_products(uuid, text, text, text, text, bigint, bigint, boolean, jsonb, integer, jsonb);
create function storefront.list_products(
  p_store_id      uuid,
  p_category_path text default null,
  p_brand_slug    text default null,
  p_query         text default null,
  p_sort          text default null,
  p_min_price     bigint default null,
  p_max_price     bigint default null,
  p_available     boolean default false,
  p_cursor        jsonb default null,
  p_limit         integer default 24,
  p_attributes    jsonb default null,
  p_brands        text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q      text := nullif(btrim(coalesce(p_query, '')), '');
  v_tsq    tsquery;
  v_sort   text := coalesce(p_sort, case when nullif(btrim(coalesce(p_query, '')), '') is null
                                         then 'newest' else 'relevance' end);
  v_limit  integer := least(greatest(coalesce(p_limit, 24), 1), 48);
  v_c_key  numeric := (p_cursor ->> 'k')::numeric;
  v_c_id   uuid := (p_cursor ->> 'id')::uuid;
  v_brands text[] := (select array_agg(distinct x) from unnest(p_brands[1:20]) x where x is not null);
  v_values uuid[];
  v_groups integer;
  v_items  jsonb;
  v_more   boolean;
  v_next   jsonb;
begin
  if not app.store_publicly_readable(p_store_id) then
    return jsonb_build_object('items', '[]'::jsonb, 'next_cursor', null);
  end if;
  if v_sort not in ('relevance', 'newest', 'price_asc', 'price_desc', 'best_selling')
     or (v_sort = 'relevance' and v_q is null) then
    v_sort := 'newest';
  end if;
  if v_q is not null then
    v_tsq := websearch_to_tsquery('spanish', extensions.unaccent(left(v_q, 200)));
  end if;
  select coalesce(array_agg(s.value_id), '{}'), count(distinct s.attribute_id)
    into v_values, v_groups
    from app.attribute_selection(p_store_id, p_attributes) s;

  with base as (
    select p.id,
           case v_sort
             when 'newest' then extract(epoch from p.published_at)::numeric
             when 'price_asc' then -coalesce(p.min_price, 9223372036854775807)::numeric
             when 'price_desc' then coalesce(p.min_price, -1)::numeric
             when 'best_selling' then p.sales_count::numeric
             else round((ts_rank(p.search_vector, v_tsq)
                         + extensions.similarity(p.title, v_q)
                         + case when exists (select 1 from public.product_variants sv
                                              where sv.product_id = p.id and sv.deleted_at is null
                                                and sv.status = 'active' and (sv.sku = upper(v_q) or sv.barcode = v_q))
                                then 10 else 0 end)::numeric, 6)
           end as k,
           p.slug, p.title, b.name as brand, p.min_price, p.max_price, p.published_at,
           (select min(v.compare_at_price) from public.product_variants v
             where v.product_id = p.id and v.status = 'active' and v.deleted_at is null
               and v.price = p.min_price) as compare_at
      from app.listing_products(p_store_id, p_category_path, p_brand_slug, v_q, p_min_price, p_max_price) l
      join public.products p on p.store_id = p_store_id and p.id = l.product_id
      left join public.brands b on b.store_id = p.store_id and b.id = p.brand_id and b.deleted_at is null
     where (v_groups = 0 or app.product_attribute_groups(p_store_id, p.id, v_values) = v_groups)
       and (v_brands is null or b.slug = any (v_brands))
  ),
  page as (
    select b.*, row_number() over (order by b.k desc, b.id desc) as rn
      from base b
     where (v_c_key is null or (b.k, b.id) < (v_c_key, v_c_id))
       and (not coalesce(p_available, false) or app.product_state(p_store_id, b.id) <> 'out_of_stock')
     order by b.k desc, b.id desc
     limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'slug', x.slug, 'title', x.title, 'brand', x.brand,
           'min_price', x.min_price, 'max_price', x.max_price, 'compare_at_price', x.compare_at,
           'availability', app.product_state(p_store_id, x.id),
           'published_at', x.published_at,
           'image', app.product_cover(p_store_id, x.id)) order by x.rn) filter (where x.rn <= v_limit), '[]'::jsonb),
         count(*) > v_limit,
         (array_agg(jsonb_build_object('k', x.k, 'id', x.id) order by x.rn))[v_limit]
    into v_items, v_more, v_next
    from page x;

  return jsonb_build_object('items', v_items, 'sort', v_sort, 'next_cursor', case when v_more then v_next end);
end
$$;
revoke all on function storefront.list_products(uuid, text, text, text, text, bigint, bigint, boolean, jsonb, integer,
                                                jsonb, text[]) from public;
grant execute on function storefront.list_products(uuid, text, text, text, text, bigint, bigint, boolean, jsonb,
                                                   integer, jsonb, text[]) to storefront_gateway;

-- 2. Filtros: los de atributos (mismas reglas que R-T04) cumpliendo también la
-- marca elegida, y la faceta «Marca» al principio: su conteo cumple los
-- atributos elegidos pero no la marca (OR entre marcas). En la página de una
-- marca (`p_brand_slug`) no hay faceta de marca.
drop function storefront.list_facets(uuid, text, text, text, boolean, jsonb);
create function storefront.list_facets(
  p_store_id      uuid,
  p_category_path text default null,
  p_brand_slug    text default null,
  p_query         text default null,
  p_available     boolean default false,
  p_attributes    jsonb default null,
  p_brands        text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q      text := nullif(btrim(coalesce(p_query, '')), '');
  v_brands text[] := (select array_agg(distinct x) from unnest(p_brands[1:20]) x where x is not null);
  v_values uuid[];
  v_attrs  uuid[];
  v_result jsonb;
  v_brand  jsonb;
begin
  if not app.store_publicly_readable(p_store_id) then
    return '[]'::jsonb;
  end if;
  select coalesce(array_agg(s.value_id), '{}'), coalesce(array_agg(distinct s.attribute_id), '{}')
    into v_values, v_attrs
    from app.attribute_selection(p_store_id, p_attributes) s;

  with base as (
    select l.product_id
      from app.listing_products(p_store_id, p_category_path, p_brand_slug, v_q, null, null) l
     where not coalesce(p_available, false) or app.product_state(p_store_id, l.product_id) <> 'out_of_stock'
  ),
  branded as (
    select b.product_id from base b where app.product_in_brands(p_store_id, b.product_id, v_brands)
  ),
  hits as (
    select b.product_id, av.attribute_id
      from branded b
      join public.product_attribute_values pav on pav.store_id = p_store_id and pav.product_id = b.product_id
      join public.attribute_values av on av.store_id = pav.store_id and av.id = pav.value_id
     where pav.value_id = any (v_values)
     group by b.product_id, av.attribute_id
  ),
  sat as (
    select b.product_id, count(h.attribute_id)::integer as n
      from branded b
      left join hits h on h.product_id = b.product_id
     group by b.product_id
  ),
  counts as (
    select pav.value_id, count(*)::integer as n
      from sat s
      join public.product_attribute_values pav on pav.store_id = p_store_id and pav.product_id = s.product_id
      join public.attribute_values av on av.store_id = pav.store_id and av.id = pav.value_id
     where s.n = cardinality(v_attrs)
        or (av.attribute_id = any (v_attrs) and s.n = cardinality(v_attrs) - 1
            and not exists (select 1 from hits h where h.product_id = s.product_id and h.attribute_id = av.attribute_id))
     group by pav.value_id
  )
  select coalesce(jsonb_agg(f.facet order by f.position, f.name), '[]'::jsonb) into v_result
    from (select a.position, a.name,
                 jsonb_build_object('key', a.key, 'name', a.name, 'values',
                   jsonb_agg(jsonb_build_object('key', av.key, 'label', av.label, 'count', coalesce(c.n, 0),
                                                'selected', av.id = any (v_values))
                             order by av.position, av.label)) as facet
            from public.attributes a
            join public.attribute_values av on av.store_id = a.store_id and av.attribute_id = a.id
            left join counts c on c.value_id = av.id
           where a.store_id = p_store_id and a.is_filterable
             and (c.n is not null or av.id = any (v_values))
           group by a.id, a.position, a.name, a.key) f;

  if p_brand_slug is null then
    with base as (
      select l.product_id
        from app.listing_products(p_store_id, p_category_path, null, v_q, null, null) l
       where (not coalesce(p_available, false) or app.product_state(p_store_id, l.product_id) <> 'out_of_stock')
         and (cardinality(v_attrs) = 0
              or app.product_attribute_groups(p_store_id, l.product_id, v_values) = cardinality(v_attrs))
    ),
    counts as (
      select p.brand_id, count(*)::integer as n
        from base x join public.products p on p.store_id = p_store_id and p.id = x.product_id
       where p.brand_id is not null
       group by p.brand_id
    )
    select jsonb_build_object('key', 'marca', 'name', 'Marca', 'values',
             coalesce(jsonb_agg(jsonb_build_object('key', b.slug, 'label', b.name, 'count', coalesce(c.n, 0),
                                                   'selected', b.slug = any (coalesce(v_brands, '{}')))
                                order by b.name, b.slug), '[]'::jsonb))
      into v_brand
      from public.brands b
      left join counts c on c.brand_id = b.id
     where b.store_id = p_store_id and b.deleted_at is null
       and (c.n is not null or b.slug = any (coalesce(v_brands, '{}')));
    -- Una sola marca sin elegir no ayuda a filtrar: no se muestra.
    if jsonb_array_length(v_brand -> 'values') > 1
       or jsonb_path_exists(v_brand, '$.values[*] ? (@.selected == true)') then
      v_result := jsonb_build_array(v_brand) || v_result;
    end if;
  end if;
  return v_result;
end
$$;
revoke all on function storefront.list_facets(uuid, text, text, text, boolean, jsonb, text[]) from public;
grant execute on function storefront.list_facets(uuid, text, text, text, boolean, jsonb, text[]) to storefront_gateway;

-- 3. Sugerencias del buscador: lo publicado que contiene lo escrito (sin
-- acentos ni mayúsculas) o empieza por cada palabra (búsqueda de texto con
-- prefijo). Mínimo 2 caracteres, máximo 60; cada grupo acotado.
create or replace function storefront.search_suggestions(p_store_id uuid, p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q    text := lower(extensions.unaccent(btrim(regexp_replace(left(coalesce(p_query, ''), 60), '\s+', ' ', 'g'))));
  v_like text;
  v_tsq  tsquery;
begin
  if char_length(v_q) < 2 or not app.store_publicly_readable(p_store_id) then
    return jsonb_build_object('products', '[]'::jsonb, 'categories', '[]'::jsonb,
                              'brands', '[]'::jsonb, 'values', '[]'::jsonb);
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  -- Cada palabra como prefijo: «crea mono» → crea:* & mono:*.
  select to_tsquery('spanish', string_agg(w || ':*', ' & '))
    into v_tsq
    from regexp_split_to_table(regexp_replace(v_q, '[^[:alnum:] ]', ' ', 'g'), ' ') w
   where w <> '';

  return jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('slug', x.slug, 'title', x.title, 'brand', x.brand,
                                          'min_price', x.min_price, 'image', app.product_cover(p_store_id, x.id))
                       order by x.starts desc, x.sales_count desc, x.title)
        from (select p.id, p.slug, p.title, p.min_price, p.sales_count, b.name as brand,
                     lower(extensions.unaccent(p.title)) like v_q || '%' as starts
                from app.listing_products(p_store_id, null, null, null, null, null) l
                join public.products p on p.store_id = p_store_id and p.id = l.product_id
                left join public.brands b on b.store_id = p.store_id and b.id = p.brand_id and b.deleted_at is null
               where lower(extensions.unaccent(p.title)) like v_like
                  or (v_tsq is not null and p.search_vector @@ v_tsq)
               order by 7 desc, p.sales_count desc, p.title
               limit 6) x), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('name', c.name, 'path', c.path) order by c.depth, c.name)
        from (select c.name, c.path, c.depth
                from public.categories c
               where c.store_id = p_store_id and c.deleted_at is null and c.is_visible
                 and lower(extensions.unaccent(c.name)) like v_like
                 and app.category_public(p_store_id, c.id)
               order by c.depth, c.name
               limit 3) c), '[]'::jsonb),
    'brands', coalesce((
      select jsonb_agg(jsonb_build_object('name', b.name, 'slug', b.slug) order by b.name)
        from (select b.name, b.slug
                from public.brands b
               where b.store_id = p_store_id and b.deleted_at is null
                 and lower(extensions.unaccent(b.name)) like v_like
                 and exists (select 1 from app.listing_products(p_store_id, null, b.slug, null, null, null))
               order by b.name
               limit 3) b), '[]'::jsonb),
    -- Valores de atributos filtrables (objetivo, sabor…) que tienen productos.
    'values', coalesce((
      select jsonb_agg(jsonb_build_object('attribute', v.attr_key, 'attribute_name', v.attr_name,
                                          'key', v.key, 'label', v.label) order by v.attr_pos, v.label)
        from (select a.key as attr_key, a.name as attr_name, a.position as attr_pos, av.key, av.label
                from public.attributes a
                join public.attribute_values av on av.store_id = a.store_id and av.attribute_id = a.id
               where a.store_id = p_store_id and a.is_filterable
                 and lower(extensions.unaccent(av.label)) like v_like
                 and exists (select 1
                               from public.product_attribute_values pav
                               join app.listing_products(p_store_id, null, null, null, null, null) l
                                 on l.product_id = pav.product_id
                              where pav.store_id = p_store_id and pav.value_id = av.id)
               order by a.position, av.label
               limit 4) v), '[]'::jsonb)
  );
end
$$;
revoke all on function storefront.search_suggestions(uuid, text) from public;
grant execute on function storefront.search_suggestions(uuid, text) to storefront_gateway;
