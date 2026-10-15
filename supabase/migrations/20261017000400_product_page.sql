-- =============================================================================
-- Fase 9 · F9-T03 — Ficha insignia (F9-DESIGN §9). Solo lecturas del storefront:
--   1. storefront.get_product suma `published_at` (insignia «Nuevo», ≤ 30 días).
--   2. storefront.related_products: «Más para tu objetivo», productos publicados
--      que comparten valores de atributos filtrables y luego categoría.
--   3. storefront.shipping_promo: el umbral real de envío gratis de la tienda
--      para su país (nunca un texto fijo).
-- Sin tablas nuevas. Todas SECURITY DEFINER con search_path vacío, solo para
-- storefront_gateway (GATE0 §44 reglas 4 y 5).
-- =============================================================================

-- 1. Ficha: mismo contrato más `published_at`.
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
                  where pc.product_id = p.id and pc.is_primary and c.deleted_at is null
                    and app.category_public(p.store_id, c.id)), '[]'::jsonb)
  )
    from public.products p
   where p.store_id = p_store_id and p.slug = p_slug and p.status = 'active' and p.deleted_at is null
     and app.store_publicly_readable(p_store_id)
$$;

-- 2. «Más para tu objetivo»: candidatos = el mismo universo que el listado
-- (app.listing_products: publicados y visibles), sin el propio ni los agotados.
-- Cuentan los valores de atributos filtrables en común (objetivo, sabor…) y
-- luego compartir una categoría pública; sin nada en común no se recomienda.
-- Desempate: más vendidos, más nuevos, id (orden estable).
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
     where p.store_id = p_store_id and p.slug = p_slug and p.status = 'active' and p.deleted_at is null
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
    select p.id, p.slug, p.title, p.min_price, p.max_price, p.sales_count, p.published_at,
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
     order by s.shared desc, s.same_category desc, s.sales_count desc, s.published_at desc, s.id desc
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
           'image', app.product_cover(p_store_id, x.id))
           order by x.shared desc, x.same_category desc, x.sales_count desc, x.published_at desc, x.id desc),
         '[]'::jsonb)
    from picked x
$$;

-- 3. Envío gratis: el menor umbral `free_over` activo en una zona que cubre el
-- país de la tienda. `conditional` = esa tarifa solo aplica a algunas regiones o
-- pesos: la tienda lo dice («según destino») en vez de prometerlo para todos.
-- Ante el mismo umbral se prefiere la tarifa sin condiciones.
create or replace function storefront.shipping_promo(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('free_over', x.free_over_subtotal, 'conditional', x.conditional)
    from (select r.free_over_subtotal,
                 (z.regions is not null or r.min_weight_g is not null or r.max_weight_g is not null) as conditional
            from public.stores s
            join public.shipping_zones z on z.store_id = s.id and s.country::text = any (z.countries)
            join public.shipping_rates r on r.store_id = z.store_id and r.zone_id = z.id
           where s.id = p_store_id and r.is_active and r.type = 'free_over'
             and app.store_publicly_readable(p_store_id)
           order by r.free_over_subtotal, 2, r.id
           limit 1) x
$$;

revoke all on function storefront.get_product(uuid, text) from public;
revoke all on function storefront.related_products(uuid, text, integer) from public;
revoke all on function storefront.shipping_promo(uuid) from public;
grant execute on function storefront.get_product(uuid, text) to storefront_gateway;
grant execute on function storefront.related_products(uuid, text, integer) to storefront_gateway;
grant execute on function storefront.shipping_promo(uuid) to storefront_gateway;
