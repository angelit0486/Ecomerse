-- =============================================================================
-- Búsqueda de la tienda a escala (Orden 06, T03, hallazgo CAP-01).
--
-- Medido con 10,000 productos en una tienda: cada búsqueda del comprador
-- tardaba ~400 ms y las sugerencias (una por tecla) ~370 ms. El 85 % del
-- tiempo se iba en `app.product_lexicon`: reconstruía el texto de CADA
-- producto (título, marca, categorías, atributos, opciones) en cada consulta.
--
-- Arreglo, sin cambiar qué resultados salen:
--   1. El texto se guarda en `products.search_lexicon` (lo mantiene el mismo
--      trigger que ya mantiene `search_vector`, con los «touch» que ya existen
--      más los que faltaban: opciones y bajas de marca o categoría).
--   2. Índice de trigramas por tienda sobre ese texto.
--   3. `app.listing_products` y `storefront.search_suggestions` arman primero
--      el conjunto de coincidencias con índices (palabras, parecido del
--      título, SKU o código de barras, error de escritura) y luego aplican los
--      mismos filtros de antes.
--
-- Aditiva (regla 17). Reversa: las funciones anteriores siguen en
-- 20261018003300 (listing_products) y 20261018000500 (search_suggestions);
-- la columna y el índice pueden quedarse sin uso.
-- =============================================================================

alter table public.products add column search_lexicon text;

-- El mismo texto que calculaba `app.product_lexicon`, a partir de la fila.
create function app.product_lexicon_of(p_product public.products)
returns text
language sql
stable
set search_path = ''
as $$
  select lower(extensions.unaccent(concat_ws(' ',
           p_product.title,
           (select b.name from public.brands b where b.store_id = p_product.store_id and b.id = p_product.brand_id
                                                 and b.deleted_at is null),
           (select string_agg(c.name, ' ') from public.product_categories pc
              join public.categories c on c.store_id = pc.store_id and c.id = pc.category_id
             where pc.store_id = p_product.store_id and pc.product_id = p_product.id and c.deleted_at is null),
           (select string_agg(av.label, ' ') from public.product_attribute_values pav
              join public.attribute_values av on av.store_id = pav.store_id and av.id = pav.value_id
             where pav.store_id = p_product.store_id and pav.product_id = p_product.id),
           (select string_agg(ov.value, ' ') from public.product_options o
              join public.product_option_values ov on ov.store_id = o.store_id and ov.option_id = o.id
             where o.store_id = p_product.store_id and o.product_id = p_product.id))))
$$;
revoke all on function app.product_lexicon_of(public.products) from public;

-- Una sola definición del texto: la función de siempre delega en la nueva.
create or replace function app.product_lexicon(p_store_id uuid, p_product_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select app.product_lexicon_of(p)
    from public.products p
   where p.store_id = p_store_id and p.id = p_product_id
$$;

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

-- ---------------------------------------------- «Touch» que faltaban
-- Opciones del producto (Talla, Sabor) y sus valores.
create trigger product_options_touch after insert or update or delete on public.product_options
  for each row execute function app.touch_product();

create function app.touch_product_of_option()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.products p set updated_at = now()
    from public.product_options o
   where o.id = case when tg_op = 'DELETE' then old.option_id else new.option_id end
     and p.id = o.product_id;
  return null;
end
$$;
revoke all on function app.touch_product_of_option() from public;
create trigger product_option_values_touch after insert or update or delete on public.product_option_values
  for each row execute function app.touch_product_of_option();

-- Una marca o categoría dada de baja deja de contar en el texto.
create or replace function app.touch_products_of()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.name is distinct from old.name or new.deleted_at is distinct from old.deleted_at then
    if tg_table_name = 'brands' then
      update public.products p set updated_at = now() where p.store_id = new.store_id and p.brand_id = new.id;
    else
      update public.products p set updated_at = now()
        from public.product_categories pc
       where pc.product_id = p.id and pc.category_id = new.id;
    end if;
  end if;
  return null;
end
$$;
drop trigger brands_touch_products on public.brands;
create trigger brands_touch_products after update of name, deleted_at on public.brands
  for each row execute function app.touch_products_of();
drop trigger categories_touch_products on public.categories;
create trigger categories_touch_products after update of name, deleted_at on public.categories
  for each row execute function app.touch_products_of();

-- ---------------------------------------------- Productos que ya existen
-- Sin mover «última modificación» (el orden «recientes» del panel no cambia).
alter table public.products disable trigger products_set_updated_at;
update public.products p set search_lexicon = app.product_lexicon_of(p);
alter table public.products enable trigger products_set_updated_at;

create index products_lexicon_trgm_idx on public.products
  using gin (store_id, search_lexicon extensions.gin_trgm_ops);

-- ---------------------------------------------- Palabra guía del error de escritura
-- La palabra más larga de la búsqueda (≥ 3 letras): si ella no se parece al
-- texto, `app.search_fuzzy_match` tampoco puede dar verdadero.
create function app.search_fuzzy_anchor(p_query text)
returns text
language sql
immutable
set search_path = ''
as $$
  select w
    from regexp_split_to_table(lower(extensions.unaccent(left(coalesce(p_query, ''), 200))), '[^[:alnum:]]+') w
   where char_length(w) >= 3
   order by char_length(w) desc, w
   limit 1
$$;
revoke all on function app.search_fuzzy_anchor(text) from public;

-- Productos de la tienda que coinciden con la búsqueda (cualquier estado; los
-- filtros de visibilidad los pone quien llama). Cada rama usa su índice.
-- El umbral 0.5 de `%>` es el mismo de `app.search_fuzzy_match`.
create function app.search_matches(p_store_id uuid, p_query text)
returns table (product_id uuid)
language plpgsql
stable
security definer
set search_path = ''
set pg_trgm.word_similarity_threshold = 0.5
set pg_trgm.similarity_threshold = 0.3
as $$
declare
  v_q      text := nullif(btrim(coalesce(p_query, '')), '');
  v_tsq    tsquery;
  v_anchor text;
begin
  if v_q is null then
    return;
  end if;
  v_tsq := websearch_to_tsquery('spanish', extensions.unaccent(left(v_q, 200)));
  v_anchor := app.search_fuzzy_anchor(v_q);
  return query
    select p.id from public.products p
     where p.store_id = p_store_id and p.search_vector @@ v_tsq
    union
    select p.id from public.products p
     where p.store_id = p_store_id and p.title operator(extensions.%) v_q
       and extensions.similarity(p.title, v_q) > 0.3
    union
    select sv.product_id from public.product_variants sv
     where sv.store_id = p_store_id and sv.deleted_at is null and sv.status = 'active'
       and (sv.sku = upper(v_q) or sv.barcode = v_q)
    union
    -- Errores de escritura razonables en título, marca, categorías, atributos
    -- y opciones (sabor, tamaño): cada palabra debe parecerse a alguna.
    select p.id from public.products p
     where v_anchor is not null and p.store_id = p_store_id
       and p.search_lexicon operator(extensions.%>) v_anchor
       and app.search_fuzzy_match(p.search_lexicon, v_q);
end
$$;
revoke all on function app.search_matches(uuid, text) from public;

create or replace function app.listing_products(
  p_store_id uuid, p_category_path text, p_brand_slug text, p_query text, p_min_price bigint, p_max_price bigint)
returns table (product_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q        text := nullif(btrim(coalesce(p_query, '')), '');
  v_statuses text[] := app.visible_product_statuses(p_store_id);
begin
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
       and (v_q is null or p.id in (select m.product_id from app.search_matches(p_store_id, v_q) m));
end
$$;

create or replace function storefront.search_suggestions(p_store_id uuid, p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set pg_trgm.word_similarity_threshold = 0.5
as $$
declare
  v_q      text := lower(extensions.unaccent(btrim(regexp_replace(left(coalesce(p_query, ''), 60), '\s+', ' ', 'g'))));
  v_like   text;
  v_tsq    tsquery;
  v_anchor text;
begin
  if char_length(v_q) < 2 or not app.store_publicly_readable(p_store_id) then
    return jsonb_build_object('products', '[]'::jsonb, 'categories', '[]'::jsonb,
                              'brands', '[]'::jsonb, 'values', '[]'::jsonb);
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_anchor := app.search_fuzzy_anchor(v_q);
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
                from (
                       -- El texto guardado empieza con el título: el índice acota y el título decide.
                       select c.id from public.products c
                        where c.store_id = p_store_id and c.search_lexicon like v_like
                          and lower(extensions.unaccent(c.title)) like v_like
                       union
                       select c.id from public.products c
                        where v_tsq is not null and c.store_id = p_store_id and c.search_vector @@ v_tsq
                       union
                       select c.id from public.products c
                        where v_anchor is not null and c.store_id = p_store_id
                          and c.search_lexicon operator(extensions.%>) v_anchor
                          and app.search_fuzzy_match(c.search_lexicon, v_q)
                     ) m
                join public.products p on p.store_id = p_store_id and p.id = m.id
                left join public.brands b on b.store_id = p.store_id and b.id = p.brand_id and b.deleted_at is null
               where p.deleted_at is null
                 and p.status = any ((select app.visible_product_statuses(p_store_id))::text[])
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

-- Versión del esquema (D-POR-06).
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261111000100'::text
$$;
