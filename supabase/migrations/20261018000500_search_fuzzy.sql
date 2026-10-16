-- =============================================================================
-- Búsqueda tolerante (super prompt §9): errores de escritura razonables en el
-- título, la marca, las categorías, los atributos y las opciones (sabor,
-- tamaño). Sin servicio externo: trigramas de pg_trgm sobre lo que ya existe.
--
-- * app.product_lexicon: texto comparable (minúsculas, sin acentos) del
--   producto publicado.
-- * app.search_fuzzy_match: cada palabra de 3+ letras de la búsqueda se parece
--   (word_similarity ≥ 0.5) a alguna del texto. Una palabra que no está, como
--   «cafeína» en un producto que no la menciona, no coincide: las
--   características solo salen de lo que la tienda escribió.
-- * app.listing_products y storefront.search_suggestions: igual que antes más
--   esa coincidencia (y la marca en las sugerencias).
-- =============================================================================

create or replace function app.product_lexicon(p_store_id uuid, p_product_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(extensions.unaccent(concat_ws(' ',
           p.title,
           (select b.name from public.brands b where b.store_id = p.store_id and b.id = p.brand_id
                                                 and b.deleted_at is null),
           (select string_agg(c.name, ' ') from public.product_categories pc
              join public.categories c on c.store_id = pc.store_id and c.id = pc.category_id
             where pc.store_id = p.store_id and pc.product_id = p.id and c.deleted_at is null),
           (select string_agg(av.label, ' ') from public.product_attribute_values pav
              join public.attribute_values av on av.store_id = pav.store_id and av.id = pav.value_id
             where pav.store_id = p.store_id and pav.product_id = p.id),
           (select string_agg(ov.value, ' ') from public.product_options o
              join public.product_option_values ov on ov.store_id = o.store_id and ov.option_id = o.id
             where o.store_id = p.store_id and o.product_id = p.id))))
    from public.products p
   where p.store_id = p_store_id and p.id = p_product_id
$$;
revoke all on function app.product_lexicon(uuid, uuid) from public;

create or replace function app.search_fuzzy_match(p_text text, p_query text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(bool_and(extensions.word_similarity(w, coalesce(p_text, '')) >= 0.5), false)
    from regexp_split_to_table(lower(extensions.unaccent(left(coalesce(p_query, ''), 200))), '[^[:alnum:]]+') w
   where char_length(w) >= 3
$$;
revoke all on function app.search_fuzzy_match(text, text) from public;

create or replace function app.listing_products(p_store_id uuid, p_category_path text, p_brand_slug text,
                                                p_query text, p_min_price bigint, p_max_price bigint)
returns table (product_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q   text := nullif(btrim(coalesce(p_query, '')), '');
  v_tsq tsquery;
begin
  if v_q is not null then
    v_tsq := websearch_to_tsquery('spanish', extensions.unaccent(left(v_q, 200)));
  end if;
  return query
    select p.id
      from public.products p
      left join public.brands b on b.store_id = p.store_id and b.id = p.brand_id and b.deleted_at is null
     where p.store_id = p_store_id and p.status = 'active' and p.deleted_at is null
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
revoke all on function app.listing_products(uuid, text, text, text, bigint, bigint) from public;

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
                  or app.search_fuzzy_match(app.product_lexicon(p_store_id, p.id), v_q)
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
                 and (lower(extensions.unaccent(b.name)) like v_like
                      or app.search_fuzzy_match(lower(extensions.unaccent(b.name)), v_q))
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
