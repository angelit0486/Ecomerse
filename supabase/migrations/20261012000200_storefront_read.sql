-- =============================================================================
-- Fase 5 · Lecturas públicas del storefront (F5-T02)
-- Contrato: GATE0 §21.3, §23 (búsqueda), §24 (sitemap).
--
-- Solo las ejecuta storefront_gateway (sin grants de tabla, §44.4). Devuelven
-- únicamente lo publicado: productos `active` no borrados, variantes activas,
-- medios `ready`, categorías visibles, páginas publicadas. Nunca costos ni
-- cantidades: la disponibilidad es un estado (in_stock, low_stock, backorder,
-- out_of_stock). La tienda llega resuelta por el proxy (store_domains); además
-- cada función exige que la tienda sea legible (activa o en borrador; el
-- borrador solo se sirve con vista previa, lo comprueba la app).
-- =============================================================================

create or replace function app.store_publicly_readable(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.stores s where s.id = p_store_id and s.status in ('active', 'draft'))
$$;
revoke all on function app.store_publicly_readable(uuid) from public;

-- Estado público de una variante (§21.3): nunca la cantidad.
create or replace function app.availability_state(p_track boolean, p_policy text, p_available integer,
                                                  p_threshold integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when not coalesce(p_track, true) then 'in_stock'
    when coalesce(p_available, 0) > 0 then
      case when p_threshold is not null and p_available <= p_threshold then 'low_stock' else 'in_stock' end
    when p_policy = 'continue' then 'backorder'
    else 'out_of_stock'
  end
$$;
revoke all on function app.availability_state(boolean, text, integer, integer) from public;

-- Estado de cada variante activa de un producto publicado (suma de ubicaciones activas, §15.6).
create or replace function app.variant_states(p_store_id uuid, p_product_id uuid)
returns table (variant_id uuid, state text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id,
         app.availability_state(v.track_inventory, v.inventory_policy,
                                coalesce(sum(l.available) filter (where loc.is_active), 0)::integer,
                                min(l.low_stock_threshold) filter (where loc.is_active))
    from public.product_variants v
    left join public.inventory_levels l on l.store_id = v.store_id and l.variant_id = v.id
    left join public.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id
   where v.store_id = p_store_id and v.product_id = p_product_id
     and v.status = 'active' and v.deleted_at is null
   group by v.id, v.track_inventory, v.inventory_policy
$$;
revoke all on function app.variant_states(uuid, uuid) from public;

-- El mejor estado entre las variantes (in_stock ▷ low_stock ▷ backorder ▷ out_of_stock).
create or replace function app.product_state(p_store_id uuid, p_product_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((array['in_stock', 'low_stock', 'backorder', 'out_of_stock'])[
           min(array_position(array['in_stock', 'low_stock', 'backorder', 'out_of_stock'], s.state))], 'out_of_stock')
    from app.variant_states(p_store_id, p_product_id) s
$$;
revoke all on function app.product_state(uuid, uuid) from public;

-- Primera imagen lista de un producto.
create or replace function app.product_cover(p_store_id uuid, p_product_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height, 'alt', m.alt_text)
    from public.media m
   where m.store_id = p_store_id and m.product_id = p_product_id and m.status = 'ready' and m.deleted_at is null
   order by m.position, m.id
   limit 1
$$;
revoke all on function app.product_cover(uuid, uuid) from public;

-- -----------------------------------------------------------------------------
-- Listado, categoría, marca y búsqueda (§23). Cursor sobre (clave, id): para
-- cada orden la clave crece en el sentido del listado, así siempre se pagina con
-- (clave, id) < cursor. Máximo 48 por página.
-- -----------------------------------------------------------------------------
create or replace function storefront.list_products(
  p_store_id      uuid,
  p_category_path text default null,
  p_brand_slug    text default null,
  p_query         text default null,
  p_sort          text default null,
  p_min_price     bigint default null,
  p_max_price     bigint default null,
  p_available     boolean default false,
  p_cursor        jsonb default null,
  p_limit         integer default 24
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

  with base as (
    select p.id,
           case v_sort
             when 'newest' then extract(epoch from p.published_at)::numeric
             when 'price_asc' then -coalesce(p.min_price, 0)::numeric
             when 'price_desc' then coalesce(p.min_price, 0)::numeric
             when 'best_selling' then p.sales_count::numeric
             else round((ts_rank(p.search_vector, v_tsq)
                         + extensions.similarity(p.title, v_q)
                         + case when exists (select 1 from public.product_variants sv
                                              where sv.product_id = p.id and sv.deleted_at is null
                                                and sv.status = 'active' and (sv.sku = upper(v_q) or sv.barcode = v_q))
                                then 10 else 0 end)::numeric, 6)
           end as k,
           p.slug, p.title, b.name as brand, p.min_price, p.max_price,
           (select min(v.compare_at_price) from public.product_variants v
             where v.product_id = p.id and v.status = 'active' and v.deleted_at is null
               and v.price = p.min_price) as compare_at
      from public.products p
      left join public.brands b on b.store_id = p.store_id and b.id = p.brand_id and b.deleted_at is null
     where p.store_id = p_store_id and p.status = 'active' and p.deleted_at is null
       and (p_category_path is null or exists (
              select 1 from public.product_categories pc
                join public.categories c on c.store_id = pc.store_id and c.id = pc.category_id
               where pc.product_id = p.id and c.deleted_at is null and c.is_visible
                 and (c.path = p_category_path or c.path like p_category_path || '/%')))
       and (p_brand_slug is null or b.slug = p_brand_slug)
       and (p_min_price is null or p.min_price >= p_min_price)
       and (p_max_price is null or p.min_price <= p_max_price)
       and (v_q is null
            or p.search_vector @@ v_tsq
            or extensions.similarity(p.title, v_q) > 0.3
            or exists (select 1 from public.product_variants sv
                        where sv.product_id = p.id and sv.deleted_at is null and sv.status = 'active'
                          and (sv.sku = upper(v_q) or sv.barcode = v_q)))
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
           'image', app.product_cover(p_store_id, x.id)) order by x.rn) filter (where x.rn <= v_limit), '[]'::jsonb),
         count(*) > v_limit,
         (array_agg(jsonb_build_object('k', x.k, 'id', x.id) order by x.rn))[v_limit]
    into v_items, v_more, v_next
    from page x;

  return jsonb_build_object('items', v_items, 'sort', v_sort, 'next_cursor', case when v_more then v_next end);
end
$$;

-- -----------------------------------------------------------------------------
-- Ficha de producto: opciones, variantes con su estado, imágenes y migas por la
-- categoría principal. null si no está publicado.
-- -----------------------------------------------------------------------------
create or replace function storefront.get_product(p_store_id uuid, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'title', p.title, 'description_html', p.description_html,
    'tags', to_jsonb(p.tags), 'seo_title', p.seo_title, 'seo_description', p.seo_description,
    'min_price', p.min_price, 'max_price', p.max_price, 'updated_at', p.updated_at,
    'availability', app.product_state(p.store_id, p.id),
    'brand', (select jsonb_build_object('name', b.name, 'slug', b.slug) from public.brands b
               where b.store_id = p.store_id and b.id = p.brand_id and b.deleted_at is null),
    'options', coalesce((select jsonb_agg(jsonb_build_object('name', o.name, 'values',
                  (select coalesce(jsonb_agg(ov.value order by ov.position, ov.value), '[]'::jsonb)
                     from public.product_option_values ov where ov.option_id = o.id)) order by o.position, o.name)
                from public.product_options o where o.product_id = p.id), '[]'::jsonb),
    'variants', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', v.id, 'signature', v.option_signature, 'sku', v.sku, 'barcode', v.barcode,
                    'price', v.price, 'compare_at_price', v.compare_at_price,
                    'availability', s.state,
                    'image', (select jsonb_build_object('path', m.storage_path, 'width', m.width,
                                                        'height', m.height, 'alt', m.alt_text)
                                from public.media m
                               where m.store_id = v.store_id and m.id = v.image_id and m.status = 'ready'
                                 and m.deleted_at is null)) order by v.position, v.option_signature)
                 from public.product_variants v
                 join app.variant_states(p.store_id, p.id) s on s.variant_id = v.id), '[]'::jsonb),
    'images', coalesce((select jsonb_agg(jsonb_build_object('path', m.storage_path, 'width', m.width,
                                                            'height', m.height, 'alt', m.alt_text)
                                         order by m.position, m.id)
                 from public.media m
                where m.store_id = p.store_id and m.product_id = p.id and m.status = 'ready'
                  and m.deleted_at is null), '[]'::jsonb),
    'breadcrumb', coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'path', a.path) order by a.depth)
                   from public.product_categories pc
                   join public.categories c on c.store_id = pc.store_id and c.id = pc.category_id
                   join public.categories a on a.store_id = c.store_id and a.deleted_at is null and a.is_visible
                    and (c.path = a.path or c.path like a.path || '/%')
                  where pc.product_id = p.id and pc.is_primary and c.deleted_at is null and c.is_visible), '[]'::jsonb)
  )
    from public.products p
   where p.store_id = p_store_id and p.slug = p_slug and p.status = 'active' and p.deleted_at is null
     and app.store_publicly_readable(p_store_id)
$$;

create or replace function storefront.get_category(p_store_id uuid, p_path text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'path', c.path, 'description', c.description,
    'seo_title', c.seo_title, 'seo_description', c.seo_description, 'updated_at', c.updated_at,
    'image', (select jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height, 'alt', m.alt_text)
                from public.media m where m.store_id = c.store_id and m.id = c.image_media_id
                 and m.status = 'ready' and m.deleted_at is null),
    'children', coalesce((select jsonb_agg(jsonb_build_object('name', ch.name, 'path', ch.path)
                                           order by ch.position, ch.name)
                 from public.categories ch
                where ch.store_id = c.store_id and ch.parent_id = c.id and ch.deleted_at is null and ch.is_visible),
               '[]'::jsonb),
    'breadcrumb', coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'path', a.path) order by a.depth)
                   from public.categories a
                  where a.store_id = c.store_id and a.deleted_at is null and a.is_visible
                    and (c.path = a.path or c.path like a.path || '/%')), '[]'::jsonb)
  )
    from public.categories c
   where c.store_id = p_store_id and c.path = p_path and c.deleted_at is null and c.is_visible
     -- Una categoría con un ancestro oculto no se publica.
     and not exists (select 1 from public.categories a
                      where a.store_id = c.store_id and c.path like a.path || '/%'
                        and (not a.is_visible or a.deleted_at is not null))
     and app.store_publicly_readable(p_store_id)
$$;

create or replace function storefront.get_brand(p_store_id uuid, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'seo_title', b.seo_title,
                            'seo_description', b.seo_description, 'updated_at', b.updated_at,
                            'logo', (select jsonb_build_object('path', m.storage_path, 'width', m.width,
                                                               'height', m.height, 'alt', m.alt_text)
                                       from public.media m where m.store_id = b.store_id and m.id = b.logo_media_id
                                        and m.status = 'ready' and m.deleted_at is null))
    from public.brands b
   where b.store_id = p_store_id and b.slug = p_slug and b.deleted_at is null
     and app.store_publicly_readable(p_store_id)
$$;

-- -----------------------------------------------------------------------------
-- Menús con los enlaces resueltos; se omite todo destino inexistente o no publicado.
-- Sin ítems en el menú principal: las categorías de primer nivel (fallback).
-- -----------------------------------------------------------------------------
create or replace function app.menu_item_href(p_store_id uuid, p_link_type text, p_target_id uuid, p_url text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p_link_type
    when 'home' then '/'
    when 'search' then '/buscar'
    when 'url' then p_url
    when 'category' then (select '/categoria/' || c.path from public.categories c
                           where c.store_id = p_store_id and c.id = p_target_id and c.deleted_at is null
                             and c.is_visible)
    when 'brand' then (select '/marca/' || b.slug from public.brands b
                        where b.store_id = p_store_id and b.id = p_target_id and b.deleted_at is null)
    when 'product' then (select '/productos/' || p.slug from public.products p
                          where p.store_id = p_store_id and p.id = p_target_id and p.status = 'active'
                            and p.deleted_at is null)
    when 'page' then (select '/paginas/' || sp.slug from public.store_pages sp
                       where sp.store_id = p_store_id and sp.id = p_target_id and sp.is_published
                         and sp.deleted_at is null)
  end
$$;
revoke all on function app.menu_item_href(uuid, text, uuid, text) from public;

create or replace function storefront.get_menus(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with items as (
    select i.*, m.handle, app.menu_item_href(i.store_id, i.link_type, i.target_id, i.url) as href
      from public.menu_items i
      join public.menus m on m.store_id = i.store_id and m.id = i.menu_id
     where i.store_id = p_store_id
  ),
  tree as (
    select t.handle, jsonb_agg(jsonb_build_object(
             'label', t.label, 'href', t.href,
             'children', coalesce((select jsonb_agg(jsonb_build_object('label', c.label, 'href', c.href)
                                                    order by c.position, c.id)
                                     from items c where c.parent_id = t.id and c.href is not null), '[]'::jsonb))
             order by t.position, t.id) as entries
      from items t
     where t.parent_id is null and t.href is not null
     group by t.handle
  )
  select case when not app.store_publicly_readable(p_store_id) then null else jsonb_build_object(
    'main', coalesce((select entries from tree where handle = 'main'),
                     (select coalesce(jsonb_agg(jsonb_build_object('label', c.name, 'href', '/categoria/' || c.path,
                                                                   'children', '[]'::jsonb)
                                                order by c.position, c.name), '[]'::jsonb)
                        from public.categories c
                       where c.store_id = p_store_id and c.parent_id is null and c.deleted_at is null
                         and c.is_visible)),
    'footer', coalesce((select entries from tree where handle = 'footer'),
                       (select coalesce(jsonb_agg(jsonb_build_object('label', sp.title, 'href', '/paginas/' || sp.slug,
                                                                     'children', '[]'::jsonb)
                                                  order by sp.type, sp.title), '[]'::jsonb)
                          from public.store_pages sp
                         where sp.store_id = p_store_id and sp.is_published and sp.deleted_at is null
                           and sp.type like 'policy_%'))
  ) end
$$;

create or replace function storefront.get_page(p_store_id uuid, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', sp.id, 'slug', sp.slug, 'type', sp.type, 'title', sp.title,
                            'body_html', sp.body_html, 'seo_title', sp.seo_title,
                            'seo_description', sp.seo_description, 'updated_at', sp.updated_at)
    from public.store_pages sp
   where sp.store_id = p_store_id and sp.slug = p_slug and sp.is_published and sp.deleted_at is null
     and app.store_publicly_readable(p_store_id)
$$;

-- Inicio: novedades y categorías de primer nivel (las secciones configurables
-- llegan con el editor de apariencia, F9).
create or replace function storefront.get_home(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not app.store_publicly_readable(p_store_id) then null else jsonb_build_object(
    'featured', storefront.list_products(p_store_id, null, null, null, 'newest', null, null, false, null, 8) -> 'items',
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'path', c.path,
                    'image', (select jsonb_build_object('path', m.storage_path, 'width', m.width,
                                                        'height', m.height, 'alt', m.alt_text)
                                from public.media m where m.store_id = c.store_id and m.id = c.image_media_id
                                 and m.status = 'ready' and m.deleted_at is null)) order by c.position, c.name)
                   from public.categories c
                  where c.store_id = p_store_id and c.parent_id is null and c.deleted_at is null
                    and c.is_visible), '[]'::jsonb)
  ) end
$$;

-- Estado de varias variantes (selector de variantes y, en la Fase 6, carrito).
create or replace function storefront.variant_availability(p_store_id uuid, p_variant_ids uuid[])
returns table (variant_id uuid, availability text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.variant_id, s.state
    from public.product_variants v
    cross join lateral app.variant_states(v.store_id, v.product_id) s
   where v.store_id = p_store_id and v.id = any (p_variant_ids[1:100]) and s.variant_id = v.id
     and app.store_publicly_readable(p_store_id)
     and exists (select 1 from public.products p where p.store_id = v.store_id and p.id = v.product_id
                   and p.status = 'active' and p.deleted_at is null)
$$;

-- Sitemap (§24): solo lo publicado, con lastmod.
create or replace function storefront.sitemap_entries(p_store_id uuid)
returns table (kind text, path text, lastmod timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select * from (
    select 'product'::text, '/productos/' || p.slug, p.updated_at
      from public.products p where p.store_id = p_store_id and p.status = 'active' and p.deleted_at is null
    union all
    select 'category', '/categoria/' || c.path, c.updated_at
      from public.categories c
     where c.store_id = p_store_id and c.deleted_at is null and c.is_visible
       and not exists (select 1 from public.categories a where a.store_id = c.store_id
                         and c.path like a.path || '/%' and (not a.is_visible or a.deleted_at is not null))
    union all
    select 'brand', '/marca/' || b.slug, b.updated_at
      from public.brands b where b.store_id = p_store_id and b.deleted_at is null
    union all
    select 'page', '/paginas/' || sp.slug, sp.updated_at
      from public.store_pages sp where sp.store_id = p_store_id and sp.is_published and sp.deleted_at is null
  ) e
  where app.store_publicly_readable(p_store_id)
  limit 50000
$$;

revoke all on function storefront.list_products(uuid, text, text, text, text, bigint, bigint, boolean, jsonb, integer)
  from public;
revoke all on function storefront.get_product(uuid, text) from public;
revoke all on function storefront.get_category(uuid, text) from public;
revoke all on function storefront.get_brand(uuid, text) from public;
revoke all on function storefront.get_menus(uuid) from public;
revoke all on function storefront.get_page(uuid, text) from public;
revoke all on function storefront.get_home(uuid) from public;
revoke all on function storefront.variant_availability(uuid, uuid[]) from public;
revoke all on function storefront.sitemap_entries(uuid) from public;
grant execute on function storefront.list_products(uuid, text, text, text, text, bigint, bigint, boolean, jsonb, integer)
  to storefront_gateway;
grant execute on function storefront.get_product(uuid, text) to storefront_gateway;
grant execute on function storefront.get_category(uuid, text) to storefront_gateway;
grant execute on function storefront.get_brand(uuid, text) to storefront_gateway;
grant execute on function storefront.get_menus(uuid) to storefront_gateway;
grant execute on function storefront.get_page(uuid, text) to storefront_gateway;
grant execute on function storefront.get_home(uuid) to storefront_gateway;
grant execute on function storefront.variant_availability(uuid, uuid[]) to storefront_gateway;
grant execute on function storefront.sitemap_entries(uuid) to storefront_gateway;
