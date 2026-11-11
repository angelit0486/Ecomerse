-- =============================================================================
-- Disponibilidad en lote (Orden 06, T03, hallazgo CAP-02).
--
-- Medido con 10,000 productos en una tienda: el filtro «solo disponibles» del
-- catálogo tardaba ~4.4 s y los «productos relacionados» de la ficha ~1.8 s.
-- Causa: `app.product_state` se llamaba una vez por producto candidato (dos
-- veces en el listado: para el total y para la página).
--
-- Arreglo, sin cambiar qué resultados salen: `app.product_states` calcula el
-- estado de muchos productos en una sola pasada; el listado y los relacionados
-- la usan para filtrar. La disponibilidad que se muestra en cada tarjeta sigue
-- saliendo de `app.product_state` (solo los de la página).
--
-- Solo funciones (regla 17). Reversa: las definiciones anteriores están en
-- 20261110000100 y anteriores (list_products) y 20261018003300 (relacionados).
-- =============================================================================

-- Estado por producto, igual que `app.product_state` pero para una lista.
-- Un producto sin presentaciones activas no aparece: equivale a «agotado».
create function app.product_states(p_store_id uuid, p_product_ids uuid[])
returns table (product_id uuid, state text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.product_id,
         (array['in_stock', 'low_stock', 'backorder', 'out_of_stock'])[
           min(array_position(array['in_stock', 'low_stock', 'backorder', 'out_of_stock'], s.state))]
    from (
      select v.product_id,
             app.availability_state(v.track_inventory, v.inventory_policy,
                                    coalesce(sum(l.available) filter (where loc.is_active), 0)::integer,
                                    min(l.low_stock_threshold) filter (where loc.is_active)) as state
        from public.product_variants v
        left join public.inventory_levels l on l.store_id = v.store_id and l.variant_id = v.id
        left join public.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id
       where v.store_id = p_store_id and v.product_id = any (p_product_ids)
         and v.status = 'active' and v.deleted_at is null
       group by v.product_id, v.id, v.track_inventory, v.inventory_policy
    ) s
   group by s.product_id
$$;
revoke all on function app.product_states(uuid, uuid[]) from public;

create or replace function storefront.list_products(
  p_store_id uuid, p_category_path text default null, p_brand_slug text default null, p_query text default null,
  p_sort text default null, p_min_price bigint default null, p_max_price bigint default null,
  p_available boolean default false, p_cursor jsonb default null, p_limit integer default 24,
  p_attributes jsonb default null, p_brands text[] default null, p_on_sale boolean default false)
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
             when 'newest' then extract(epoch from coalesce(p.published_at, p.created_at))::numeric
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
           p.slug, p.title, b.name as brand, p.min_price, p.max_price, p.published_at, p.status,
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
  -- «Solo disponibles»: la disponibilidad de todos los candidatos en una sola
  -- pasada (antes, una llamada por producto: 4.4 s con 10,000 productos).
  avail as materialized (
    select s.product_id
      from app.product_states(p_store_id, (select array_agg(b.id) from base b where coalesce(p_available, false))) s
     where s.state <> 'out_of_stock'
  ),
  total as (
    select count(*) as n
      from base b
     where v_c_key is null
       and (not coalesce(p_available, false) or b.id in (select a.product_id from avail a))
  ),
  page as (
    select b.*, row_number() over (order by b.k desc, b.id desc) as rn
      from base b
     where (v_c_key is null or (b.k, b.id) < (v_c_key, v_c_id))
       and (not coalesce(p_available, false) or b.id in (select a.product_id from avail a))
     order by b.k desc, b.id desc
     limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'slug', x.slug, 'title', x.title, 'brand', x.brand,
           'min_price', x.min_price, 'max_price', x.max_price, 'compare_at_price', x.compare_at,
           'availability', app.product_state(p_store_id, x.id),
           'published_at', x.published_at,
           'unpublished', x.status <> 'active',
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

create or replace function storefront.related_products(p_store_id uuid, p_slug text, p_limit integer default 8)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.id
      from public.products p
     where p.store_id = p_store_id and p.slug = p_slug and p.deleted_at is null
       and p.status = any ((select app.visible_product_statuses(p_store_id))::text[])
       and app.store_publicly_readable(p_store_id)
  ),
  my_values as (
    select pav.value_id
      from me
      join public.product_attribute_values pav on pav.store_id = p_store_id and pav.product_id = me.id
      join public.attribute_values av on av.store_id = pav.store_id and av.id = pav.value_id
      join public.attributes a on a.store_id = av.store_id and a.id = av.attribute_id and a.is_filterable
  ),
  my_categories as (
    select pc.category_id
      from me
      join public.product_categories pc on pc.store_id = p_store_id and pc.product_id = me.id
      join public.categories c on c.store_id = pc.store_id and c.id = pc.category_id and c.deleted_at is null
     where app.category_public(p_store_id, c.id)
  ),
  scored as (
    select p.id, p.slug, p.title, p.min_price, p.max_price, p.sales_count, p.published_at, p.status,
           b.name as brand,
           (select count(*) from public.product_attribute_values pav
             where pav.store_id = p_store_id and pav.product_id = p.id
               and pav.value_id in (select value_id from my_values)) as shared,
           exists (select 1 from public.product_categories pc
                    where pc.store_id = p_store_id and pc.product_id = p.id
                      and pc.category_id in (select category_id from my_categories)) as same_category
      from app.listing_products(p_store_id, null, null, null, null, null) l
      join public.products p on p.store_id = p_store_id and p.id = l.product_id
      left join public.brands b on b.store_id = p.store_id and b.id = p.brand_id and b.deleted_at is null
     where exists (select 1 from me) and p.id <> (select id from me)
  ),
  candidates as materialized (
    select s.* from scored s where s.shared > 0 or s.same_category
  ),
  -- La disponibilidad de todos los candidatos en una sola pasada.
  states as materialized (
    select st.product_id, st.state
      from app.product_states(p_store_id, (select array_agg(c.id) from candidates c)) st
  ),
  picked as (
    select c.*, st.state
      from candidates c
      join states st on st.product_id = c.id
     where st.state <> 'out_of_stock'
     order by c.shared desc, c.same_category desc, c.sales_count desc, c.published_at desc nulls last, c.id desc
     limit least(greatest(coalesce(p_limit, 8), 1), 12)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'slug', x.slug, 'title', x.title, 'brand', x.brand,
           'min_price', x.min_price, 'max_price', x.max_price,
           'compare_at_price', (select min(v.compare_at_price) from public.product_variants v
                                 where v.product_id = x.id and v.status = 'active' and v.deleted_at is null
                                   and v.price = x.min_price),
           'availability', x.state,
           'published_at', x.published_at,
           'unpublished', x.status <> 'active',
           'servings', (select case when jsonb_typeof(i.data -> 'servings_per_container') = 'number'
                                 then (i.data ->> 'servings_per_container')::integer end
                       from public.product_regulatory_info i where i.store_id = p_store_id and i.product_id = x.id),
           'image', app.product_cover(p_store_id, x.id))
           order by x.shared desc, x.same_category desc, x.sales_count desc, x.published_at desc nulls last,
                    x.id desc),
         '[]'::jsonb)
    from picked x
$$;

-- Versión del esquema (D-POR-06).
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261111000200'::text
$$;
