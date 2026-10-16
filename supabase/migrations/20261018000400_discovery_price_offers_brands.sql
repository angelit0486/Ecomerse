-- =============================================================================
-- Descubrimiento (super prompt §5, §7 y §8) — precio, ofertas reales y marcas
--
-- 1. app.product_on_sale: un producto está en oferta solo si alguna variante
--    activa tiene un precio de comparación mayor que su precio (descuento real,
--    el mismo dato que muestra la tarjeta). Nada se marca a mano.
-- 2. storefront.list_products: `p_on_sale` al final (los llamadores existentes
--    siguen igual). Igual que en 20261017000800 salvo eso.
-- 3. storefront.list_facets: precio mínimo y máximo y `p_on_sale`, para que los
--    conteos de los filtros respeten lo que filtra el listado. Igual que en
--    20261017000500 salvo eso.
-- 4. storefront.list_brands: directorio de marcas con productos publicados.
-- 5. storefront.discovery_summary: cuántas marcas y ofertas hay (el menú solo
--    muestra «Marcas» y «Ofertas» cuando tienen algo que mostrar).
-- =============================================================================

create or replace function app.product_on_sale(p_store_id uuid, p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.product_variants v
                  where v.store_id = p_store_id and v.product_id = p_product_id and v.deleted_at is null
                    and v.status = 'active' and v.compare_at_price is not null and v.compare_at_price > v.price)
$$;
revoke all on function app.product_on_sale(uuid, uuid) from public;

-- -----------------------------------------------------------------------------
-- 2. Listado
-- -----------------------------------------------------------------------------
drop function storefront.list_products(uuid, text, text, text, text, bigint, bigint, boolean, jsonb, integer, jsonb,
                                       text[]);
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
  p_brands        text[] default null,
  p_on_sale       boolean default false
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
  v_total  bigint;
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
       and (not coalesce(p_on_sale, false) or app.product_on_sale(p_store_id, p.id))
  ),
  -- Total de resultados solo en la primera página (revisión de conversión, M6):
  -- en las siguientes no se muestra y no se paga el conteo.
  total as (
    select count(*) as n
      from base b
     where v_c_key is null
       and (not coalesce(p_available, false) or app.product_state(p_store_id, b.id) <> 'out_of_stock')
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
           'servings', (select case when jsonb_typeof(i.data -> 'servings_per_container') = 'number'
                                 then (i.data ->> 'servings_per_container')::integer end
                       from public.product_regulatory_info i where i.store_id = p_store_id and i.product_id = x.id),
           'image', app.product_cover(p_store_id, x.id)) order by x.rn) filter (where x.rn <= v_limit), '[]'::jsonb),
         count(*) > v_limit,
         (array_agg(jsonb_build_object('k', x.k, 'id', x.id) order by x.rn))[v_limit],
         case when v_c_key is null then (select t.n from total t) end
    into v_items, v_more, v_next, v_total
    from page x;

  return jsonb_build_object('items', v_items, 'sort', v_sort, 'next_cursor', case when v_more then v_next end,
                            'total', v_total);
end
$$;
revoke all on function storefront.list_products(uuid, text, text, text, text, bigint, bigint, boolean, jsonb, integer,
                                                jsonb, text[], boolean) from public;
grant execute on function storefront.list_products(uuid, text, text, text, text, bigint, bigint, boolean, jsonb,
                                                   integer, jsonb, text[], boolean) to storefront_gateway;

-- -----------------------------------------------------------------------------
-- 3. Filtros con conteo
-- -----------------------------------------------------------------------------
drop function storefront.list_facets(uuid, text, text, text, boolean, jsonb, text[]);
create function storefront.list_facets(
  p_store_id      uuid,
  p_category_path text default null,
  p_brand_slug    text default null,
  p_query         text default null,
  p_available     boolean default false,
  p_attributes    jsonb default null,
  p_brands        text[] default null,
  p_min_price     bigint default null,
  p_max_price     bigint default null,
  p_on_sale       boolean default false
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
      from app.listing_products(p_store_id, p_category_path, p_brand_slug, v_q, p_min_price, p_max_price) l
     where (not coalesce(p_available, false) or app.product_state(p_store_id, l.product_id) <> 'out_of_stock')
       and (not coalesce(p_on_sale, false) or app.product_on_sale(p_store_id, l.product_id))
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
        from app.listing_products(p_store_id, p_category_path, null, v_q, p_min_price, p_max_price) l
       where (not coalesce(p_available, false) or app.product_state(p_store_id, l.product_id) <> 'out_of_stock')
         and (not coalesce(p_on_sale, false) or app.product_on_sale(p_store_id, l.product_id))
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
revoke all on function storefront.list_facets(uuid, text, text, text, boolean, jsonb, text[], bigint, bigint, boolean)
  from public;
grant execute on function storefront.list_facets(uuid, text, text, text, boolean, jsonb, text[], bigint, bigint, boolean)
  to storefront_gateway;

-- -----------------------------------------------------------------------------
-- 4. Directorio de marcas: solo marcas con productos publicados, con su logo si
--    lo tienen y cuántos productos publicados hay.
-- -----------------------------------------------------------------------------
create or replace function storefront.list_brands(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', b.slug, 'name', b.name, 'count', x.n,
           'logo', (select jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height)
                      from public.media m
                     where m.store_id = b.store_id and m.id = b.logo_media_id and m.status = 'ready'
                       and m.deleted_at is null))
           order by lower(b.name), b.slug), '[]'::jsonb)
    from public.brands b
    join lateral (select count(*)::integer as n from public.products p
                   where p.store_id = b.store_id and p.brand_id = b.id and p.status = 'active'
                     and p.deleted_at is null) x on x.n > 0
   where b.store_id = p_store_id and b.deleted_at is null and app.store_publicly_readable(p_store_id)
$$;
revoke all on function storefront.list_brands(uuid) from public;
grant execute on function storefront.list_brands(uuid) to storefront_gateway;

-- -----------------------------------------------------------------------------
-- 5. Resumen para el menú
-- -----------------------------------------------------------------------------
create or replace function storefront.discovery_summary(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'brands', (select count(distinct p.brand_id)::integer from public.products p
                join public.brands b on b.store_id = p.store_id and b.id = p.brand_id and b.deleted_at is null
               where p.store_id = p_store_id and p.status = 'active' and p.deleted_at is null),
    'offers', (select count(*)::integer from public.products p
                where p.store_id = p_store_id and p.status = 'active' and p.deleted_at is null
                  and app.product_on_sale(p_store_id, p.id)))
   where app.store_publicly_readable(p_store_id)
$$;
revoke all on function storefront.discovery_summary(uuid) from public;
grant execute on function storefront.discovery_summary(uuid) to storefront_gateway;
