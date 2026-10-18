-- =============================================================================
-- ADR-032 · Vista previa privada de los productos en borrador (aprobado por el
-- propietario el 2026-10-18 junto con el plan para la tienda premium).
--
-- * Solo en la vista previa de UNA tienda: el servidor, tras verificar la firma
--   del proxy, abre una transacción del gateway con `pruva.preview_store` = esa
--   tienda (set_config LOCAL: se descarta al terminar y nunca queda en una
--   conexión del pool). Sin esa marca, todo sigue igual que antes.
-- * Entonces el catálogo de la tienda (listados, filtros, buscador, portada,
--   ficha, ficha sanitaria, atributos, relacionados, marcas y menú) incluye sus
--   borradores, marcados `unpublished`. Archivados y borrados, nunca.
-- * Un borrador nunca se compra: el carrito, el pedido, «Agregar» desde la
--   tarjeta (card_variants), las opiniones y el sitemap siguen pidiendo
--   productos activos y no leen la marca.
-- * Los borradores no tienen fecha de publicación: en «Más recientes» se ordenan
--   por su fecha de creación (los activos siempre tienen fecha, por constraint).
-- =============================================================================

-- Estados que la tienda muestra. La marca la pone el servidor (único con el rol
-- storefront_gateway, §44.4) y solo vale para la tienda indicada.
create or replace function app.visible_product_statuses(p_store_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  select case when current_setting('pruva.preview_store', true) = p_store_id::text
              then array['active', 'draft'] else array['active'] end
$$;
revoke all on function app.visible_product_statuses(uuid) from public;

-- -----------------------------------------------------------------------------
-- Base de los listados, filtros, buscador y portada.
-- -----------------------------------------------------------------------------
create or replace function app.listing_products(p_store_id uuid, p_category_path text, p_brand_slug text,
                                                p_query text, p_min_price bigint, p_max_price bigint)
returns table (product_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q        text := nullif(btrim(coalesce(p_query, '')), '');
  v_tsq      tsquery;
  v_statuses text[] := app.visible_product_statuses(p_store_id);
begin
  if v_q is not null then
    v_tsq := websearch_to_tsquery('spanish', extensions.unaccent(left(v_q, 200)));
  end if;
  return query
    select p.id
      from public.products p
      left join public.brands b on b.store_id = p.store_id and b.id = p.brand_id and b.deleted_at is null
     where p.store_id = p_store_id and p.status = any (v_statuses) and p.deleted_at is null
       and (p_category_path is null or exists (
              select 1 from public.product_categories pc
                join public.categories c on c.store_id = pc.store_id and c.id = pc.category_id
               where pc.product_id = p.id and c.deleted_at is null and app.category_public(p_store_id, c.id)
                 and (c.path = p_category_path or c.path like p_category_path || '/%')))
       and (p_brand_slug is null or b.slug = p_brand_slug)
       and (p_min_price is null or p.min_price >= p_min_price)
       and (p_max_price is null or p.min_price <= p_max_price)
       and (v_q is null
            or p.search_vector @@ v_tsq
            or extensions.similarity(p.title, v_q) > 0.3
            or exists (select 1 from public.product_variants sv
                        where sv.product_id = p.id and sv.deleted_at is null and sv.status = 'active'
                          and (sv.sku = upper(v_q) or sv.barcode = v_q))
            -- Errores de escritura razonables en título, marca, categorías, atributos
            -- y opciones (sabor, tamaño): cada palabra debe parecerse a alguna.
            or app.search_fuzzy_match(app.product_lexicon(p_store_id, p.id), v_q));
end
$$;

-- -----------------------------------------------------------------------------
-- Listado: borradores marcados y ordenados por creación en «Más recientes».
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

-- -----------------------------------------------------------------------------
-- Relacionados de la ficha (también de un borrador en la vista previa).
-- -----------------------------------------------------------------------------
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
  picked as (
    select s.*, app.product_state(p_store_id, s.id) as state
      from scored s
     where (s.shared > 0 or s.same_category)
       and app.product_state(p_store_id, s.id) <> 'out_of_stock'
     order by s.shared desc, s.same_category desc, s.sales_count desc, s.published_at desc nulls last, s.id desc
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

-- -----------------------------------------------------------------------------
-- Ficha.
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
    'published_at', p.published_at,
    'unpublished', p.status <> 'active',
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
                    -- ADR-030: vigencia de la oferta en curso (solo si el precio es el de la oferta).
                    'sale_ends_at', (select s.ends_at from public.variant_price_schedules s
                                      where s.variant_id = v.id and s.status = 'active'
                                        and s.sale_price = v.price and v.compare_at_price is not null),
                    'net_content', v.net_content, 'servings_per_container', v.servings_per_container,
                    'availability', s.state,
                    'ships_in_days', case when s.state <> 'out_of_stock'
                                          then (select case when lt ->> 'min' is not null and lt ->> 'max' is not null
                                                            then lt end
                                                  from app.variant_supplier_lead_time(v.store_id, v.id) lt) end,
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
                  where pc.product_id = p.id and pc.is_primary and c.deleted_at is null
                    and app.category_public(p.store_id, c.id)), '[]'::jsonb)
  )
    from public.products p
   where p.store_id = p_store_id and p.slug = p_slug and p.deleted_at is null
     and p.status = any ((select app.visible_product_statuses(p_store_id))::text[])
     and app.store_publicly_readable(p_store_id)
$$;

-- -----------------------------------------------------------------------------
-- Ficha sanitaria.
-- -----------------------------------------------------------------------------
create or replace function storefront.get_product_regulatory(p_store_id uuid, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'category', i.category_key,
           'category_name', rc.name,
           'data', i.data,
           'legends', app.compliance_legends(p.store_id, i.category_key, 'product_page'))
    from public.products p
    join public.product_regulatory_info i
      on i.store_id = p.store_id and i.product_id = p.id and i.category_key is not null
    join public.regulated_categories rc on rc.key = i.category_key
   where p.store_id = p_store_id and p.slug = p_slug and p.deleted_at is null
     and p.status = any ((select app.visible_product_statuses(p_store_id))::text[])
     and app.store_publicly_readable(p_store_id)
$$;

-- -----------------------------------------------------------------------------
-- Atributos de la ficha.
-- -----------------------------------------------------------------------------
create or replace function storefront.get_product_attributes(p_store_id uuid, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.attr order by x.position, x.name), '[]'::jsonb)
    from (select a.position, a.name,
                 jsonb_build_object('key', a.key, 'name', a.name, 'filterable', a.is_filterable,
                   'values', jsonb_agg(jsonb_build_object('key', av.key, 'label', av.label)
                                       order by av.position, av.label)) as attr
            from public.products p
            join public.product_attribute_values pav on pav.store_id = p.store_id and pav.product_id = p.id
            join public.attribute_values av on av.store_id = pav.store_id and av.id = pav.value_id
            join public.attributes a on a.store_id = av.store_id and a.id = av.attribute_id
           where p.store_id = p_store_id and p.slug = p_slug and p.deleted_at is null
             and p.status = any ((select app.visible_product_statuses(p_store_id))::text[])
             and app.store_publicly_readable(p_store_id)
           group by a.id, a.position, a.name, a.key, a.is_filterable) x
$$;

-- -----------------------------------------------------------------------------
-- Menú: cuántas marcas y ofertas hay.
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
               where p.store_id = p_store_id and p.deleted_at is null
                 and p.status = any ((select app.visible_product_statuses(p_store_id))::text[])),
    'offers', (select count(*)::integer from public.products p
                where p.store_id = p_store_id and p.deleted_at is null
                  and p.status = any ((select app.visible_product_statuses(p_store_id))::text[])
                  and app.product_on_sale(p_store_id, p.id)))
   where app.store_publicly_readable(p_store_id)
$$;

-- -----------------------------------------------------------------------------
-- Directorio de marcas.
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
                   where p.store_id = b.store_id and p.brand_id = b.id and p.deleted_at is null
                     and p.status = any ((select app.visible_product_statuses(p_store_id))::text[])) x on x.n > 0
   where b.store_id = p_store_id and b.deleted_at is null and app.store_publicly_readable(p_store_id)
$$;

revoke all on function storefront.list_products(uuid, text, text, text, text, bigint, bigint, boolean, jsonb, integer,
                                                jsonb, text[], boolean) from public;
grant execute on function storefront.list_products(uuid, text, text, text, text, bigint, bigint, boolean, jsonb,
                                                   integer, jsonb, text[], boolean) to storefront_gateway;
revoke all on function app.listing_products(uuid, text, text, text, bigint, bigint) from public;
revoke all on function storefront.related_products(uuid, text, integer) from public;
grant execute on function storefront.related_products(uuid, text, integer) to storefront_gateway;
revoke all on function storefront.get_product(uuid, text) from public;
grant execute on function storefront.get_product(uuid, text) to storefront_gateway;
revoke all on function storefront.get_product_regulatory(uuid, text) from public;
grant execute on function storefront.get_product_regulatory(uuid, text) to storefront_gateway;
revoke all on function storefront.get_product_attributes(uuid, text) from public;
grant execute on function storefront.get_product_attributes(uuid, text) to storefront_gateway;
revoke all on function storefront.discovery_summary(uuid) from public;
grant execute on function storefront.discovery_summary(uuid) to storefront_gateway;
revoke all on function storefront.list_brands(uuid) from public;
grant execute on function storefront.list_brands(uuid) to storefront_gateway;
