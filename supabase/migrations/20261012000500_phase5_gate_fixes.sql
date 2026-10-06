-- =============================================================================
-- Gate F5 · correcciones de la revisión adversarial (docs/phases/PHASE-05-REPORT.md §5)
-- * app.category_public: una categoría es pública si ella y TODOS sus ancestros
--   (por parent_id, no por prefijo de path: un ancestro borrado puede compartir
--   path con uno vivo) están visibles y sin borrar. Se usa en listado, ficha,
--   categoría, menús y sitemap.
-- * Precio ascendente/descendente: productos sin precio al final.
-- * get_store_public: sin dominio primario activo, el subdominio de plataforma activo.
-- * content_upsert_page: una página publicada no queda vacía; entradas inválidas
--   → validation_failed (nunca 22P02). menu_set_items: idem.
-- =============================================================================

create or replace function app.category_public(p_store_id uuid, p_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select c.id, c.parent_id, c.is_visible, c.deleted_at, 1 as depth
      from public.categories c
     where c.store_id = p_store_id and c.id = p_category_id
    union all
    select c.id, c.parent_id, c.is_visible, c.deleted_at, up.depth + 1
      from public.categories c
      join up on c.store_id = p_store_id and c.id = up.parent_id
     where up.depth < 16
  )
  select exists (select 1 from up)
     and not exists (select 1 from up where not up.is_visible or up.deleted_at is not null)
$$;
revoke all on function app.category_public(uuid, uuid) from public;


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
                  where pc.product_id = p.id and pc.is_primary and c.deleted_at is null
                    and app.category_public(p.store_id, c.id)), '[]'::jsonb)
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
     and app.category_public(c.store_id, c.id)
     and app.store_publicly_readable(p_store_id)
$$;

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
                           where c.store_id = p_store_id and c.id = p_target_id
                             and app.category_public(p_store_id, c.id))
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
     where c.store_id = p_store_id and c.deleted_at is null and app.category_public(p_store_id, c.id)
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

create or replace function storefront.get_store_public(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'name', s.name, 'handle', s.handle, 'status', s.status,
    'locale', s.locale, 'currency', s.currency, 'country', s.country,
    'primary_hostname', coalesce(
                          (select d.hostname from public.store_domains d
                            where d.store_id = s.id and d.is_primary and d.status = 'active'),
                          (select d.hostname from public.store_domains d
                            where d.store_id = s.id and d.type = 'platform_subdomain' and d.status = 'active'
                            order by d.created_at limit 1)),
    'theme', jsonb_build_object('key', t.theme_key, 'version', t.theme_version,
                                'settings', coalesce(t.settings, '{}'::jsonb)),
    'logo', (select jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height)
               from public.media m
              where m.store_id = s.id and m.id = t.logo_media_id
                and m.status = 'ready' and m.deleted_at is null)
  )
  from public.stores s
  left join public.store_themes t on t.store_id = s.id
  where s.id = p_store_id and s.status <> 'closed'
$$;

create or replace function public.content_upsert_page(p_store_id uuid, p_page jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_old   public.store_pages;
  v_title text := btrim(coalesce(p_page ->> 'title', ''));
  v_slug  text;
begin
  perform app.require_store_permission(p_store_id, 'content.manage');
  if jsonb_typeof(p_page) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'page';
  end if;
  begin
    v_id := nullif(p_page ->> 'id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'page';
  end;
  if char_length(v_title) not between 1 and 120 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'title';
  end if;
  if octet_length(coalesce(p_page ->> 'body_html', '')) > 102400 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'body_html';
  end if;
  if v_id is not null then
    select * into v_old from public.store_pages sp
     where sp.id = v_id and sp.store_id = p_store_id and sp.deleted_at is null for update;
    if v_old.id is null then
      raise exception using errcode = 'P0001', message = 'not_found', detail = 'page';
    end if;
  end if;
  v_slug := coalesce(nullif(btrim(p_page ->> 'slug'), ''), v_old.slug, app.slugify(v_title));
  if not app.slug_valid(v_slug) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'slug';
  end if;
  -- Una página publicada no se vacía (la misma regla que al publicar).
  if v_old.is_published
     and char_length(btrim(regexp_replace(coalesce(p_page ->> 'body_html', ''), '<[^>]*>', '', 'g'))) = 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'body_html';
  end if;
  -- MVP (§24): sin redirecciones 301, la dirección de una página publicada no cambia.
  if v_old.is_published and v_slug <> v_old.slug then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'slug_published';
  end if;

  begin
    if v_id is null then
      insert into public.store_pages (store_id, type, slug, title, body_html, seo_title, seo_description)
      values (p_store_id, 'content', v_slug, v_title, coalesce(p_page ->> 'body_html', ''),
              nullif(btrim(p_page ->> 'seo_title'), ''), nullif(btrim(p_page ->> 'seo_description'), ''))
      returning id into v_id;
    else
      update public.store_pages
         set title = v_title, slug = v_slug, body_html = coalesce(p_page ->> 'body_html', ''),
             seo_title = nullif(btrim(p_page ->> 'seo_title'), ''),
             seo_description = nullif(btrim(p_page ->> 'seo_description'), '')
       where id = v_id;
    end if;
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'slug';
    when check_violation then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'page';
  end;
  perform audit.record(case when v_old.id is null then 'page.created' else 'page.updated' end, 'store_page', v_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       case when v_old.id is null then null
                            else jsonb_build_object('title', v_old.title, 'slug', v_old.slug) end,
                       jsonb_build_object('title', v_title, 'slug', v_slug));
  return jsonb_build_object('id', v_id, 'slug', v_slug);
end
$$;

create or replace function public.menu_set_items(p_store_id uuid, p_handle text, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_menu   uuid;
  v_item   jsonb;
  v_child  jsonb;
  v_parent uuid;
  v_pos    integer := 0;
  v_cpos   integer;
  v_total  integer := 0;
begin
  perform app.require_store_permission(p_store_id, 'appearance.manage');
  select m.id into v_menu from public.menus m where m.store_id = p_store_id and m.handle = p_handle for update;
  if v_menu is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'menu';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'items';
  end if;

  -- Forma del payload antes de tocar nada: objetos, children arreglo, ids uuid.
  if exists (select 1 from jsonb_array_elements(p_items) it
              where jsonb_typeof(it) <> 'object'
                 or jsonb_typeof(coalesce(it -> 'children', '[]'::jsonb)) <> 'array'
                 or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(it -> 'children') = 'array'
                                                                    then it -> 'children' else '[]'::jsonb end) ch
                             where jsonb_typeof(ch) <> 'object'
                                or jsonb_typeof(coalesce(ch -> 'children', '[]'::jsonb)) <> 'array')) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'items';
  end if;
  if exists (select 1
               from jsonb_array_elements(p_items) it
               cross join lateral (select it union all select ch from jsonb_array_elements(coalesce(it -> 'children', '[]'::jsonb)) ch) e(x)
              where nullif(e.x ->> 'target_id', '') is not null
                and e.x ->> 'target_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'target_id';
  end if;

  delete from public.menu_items i where i.menu_id = v_menu;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_total := v_total + 1 + coalesce(jsonb_array_length(v_item -> 'children'), 0);
    if v_total > 50 then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'items';
    end if;
    if not app.menu_target_valid(p_store_id, v_item ->> 'link_type', nullif(v_item ->> 'target_id', '')::uuid) then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'target_id';
    end if;
    begin
      insert into public.menu_items (store_id, menu_id, label, link_type, target_id, url, position)
      values (p_store_id, v_menu, btrim(v_item ->> 'label'), v_item ->> 'link_type',
              nullif(v_item ->> 'target_id', '')::uuid, nullif(btrim(v_item ->> 'url'), ''), v_pos)
      returning id into v_parent;
      v_cpos := 0;
      for v_child in select * from jsonb_array_elements(coalesce(v_item -> 'children', '[]'::jsonb)) loop
        if v_child ? 'children' and jsonb_array_length(v_child -> 'children') > 0 then
          raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'items';
        end if;
        if not app.menu_target_valid(p_store_id, v_child ->> 'link_type', nullif(v_child ->> 'target_id', '')::uuid) then
          raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'target_id';
        end if;
        insert into public.menu_items (store_id, menu_id, parent_id, label, link_type, target_id, url, position)
        values (p_store_id, v_menu, v_parent, btrim(v_child ->> 'label'), v_child ->> 'link_type',
                nullif(v_child ->> 'target_id', '')::uuid, nullif(btrim(v_child ->> 'url'), ''), v_cpos);
        v_cpos := v_cpos + 1;
      end loop;
    exception
      when check_violation or not_null_violation or invalid_text_representation then
        raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'items';
    end;
    v_pos := v_pos + 1;
  end loop;
  perform audit.record('menu.saved', 'menu', v_menu,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('handle', p_handle, 'items', v_total));
end
$$;
