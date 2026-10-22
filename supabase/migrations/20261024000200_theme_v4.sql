-- =============================================================================
-- Tema v4 (misión Panel, Pasos B, C y D; extiende ADR-034 y el tema v3):
--
-- 1. COLORES aparte del DISEÑO:
--    - `colors.sale`: color de las ofertas (si falta, el de siempre);
--    - `element_colors`: fondo y texto propios del hero, encabezado, barra de
--      categorías (más activo y borde), tarjetas, botones y pie;
--    - `colors` por bloque de la portada (fondo y texto).
--    Todo par de texto y fondo exige 4.5:1: al guardar el bloque y, en el
--    tema, al guardar y al publicar (`app.theme_contrast_issues`).
-- 2. DISEÑO: `spacing` por bloque (compact, normal, spacious).
-- 3. Barra de categorías del encabezado (`header.nav_bar`): enlaces propios
--    (hasta 12, con su dispositivo), estilo texto/píldoras/con foto, fija o
--    no, alineación, tamaño y si se ve también en la computadora.
-- 4. «Nuestras marcas» también lleva las marcas sin logo (iniciales).
-- Solo aditivo: todo tema v3 es un v4 válido.
-- =============================================================================

create or replace function app.theme_nav_bar_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p) = 'object'
    and app.theme_keys_ok(p, '{}', array['items', 'style', 'sticky', 'align', 'size', 'visibility'])
    and (not p ? 'style' or app.theme_enum_valid(p -> 'style', array['text', 'pills', 'photos']))
    and (not p ? 'sticky' or jsonb_typeof(p -> 'sticky') = 'boolean')
    and (not p ? 'align' or app.theme_enum_valid(p -> 'align', array['start', 'center']))
    and (not p ? 'size' or app.theme_enum_valid(p -> 'size', array['sm', 'md']))
    and (not p ? 'visibility' or app.theme_enum_valid(p -> 'visibility', array['mobile', 'all']))
    and (not p ? 'items'
         or (jsonb_typeof(p -> 'items') = 'array' and jsonb_array_length(p -> 'items') <= 12
             and not exists (select 1 from jsonb_array_elements(p -> 'items') i
                              where not (app.theme_keys_ok(i, array['label', 'link'], array['visibility'])
                                         and app.theme_text_valid(i -> 'label', 1, 30)
                                         and app.theme_link_valid(i -> 'link')
                                         and (not i ? 'visibility'
                                              or app.theme_enum_valid(i -> 'visibility',
                                                                      array['all', 'mobile', 'desktop'])))))),
    false)
$$;
revoke all on function app.theme_nav_bar_valid(jsonb) from public;

-- Fondo y texto de un bloque: colores válidos y legibles (≥ 4.5:1).
create or replace function app.home_section_colors_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(app.theme_keys_ok(p, array['background', 'foreground'])
    and app.theme_hex_valid(p -> 'background') and app.theme_hex_valid(p -> 'foreground')
    and app.contrast_ratio(p ->> 'foreground', p ->> 'background') >= 4.5, false)
$$;
revoke all on function app.home_section_colors_valid(jsonb) from public;

create or replace function app.home_sections_valid(p_sections jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_sections) = 'array'
    and jsonb_array_length(p_sections) <= 20
    and not exists (select 1 from jsonb_array_elements(p_sections) s
                     where not app.theme_keys_ok(s, array['id', 'type', 'enabled', 'props'],
                                                 array['visibility', 'starts_at', 'ends_at', 'colors', 'spacing'])
                        or not app.theme_uuid_valid(s -> 'id')
                        or jsonb_typeof(s -> 'enabled') <> 'boolean'
                        or jsonb_typeof(s -> 'type') <> 'string'
                        or (s ? 'visibility' and not app.theme_enum_valid(s -> 'visibility', array['all', 'mobile', 'desktop']))
                        or (s ? 'spacing' and not app.theme_enum_valid(s -> 'spacing', array['compact', 'normal', 'spacious']))
                        or (s ? 'colors' and not app.home_section_colors_valid(s -> 'colors'))
                        or not app.theme_schedule_valid(s)
                        or not app.home_section_props_valid(s ->> 'type', s -> 'props'))
    and (select count(distinct s -> 'id') from jsonb_array_elements(p_sections) s) = jsonb_array_length(p_sections)
    and (select count(*) from jsonb_array_elements(p_sections) s where s ->> 'type' = 'featured_products') <= 4,
    false)
$$;

-- Contraste del tema: lo de antes, más el color de oferta y cada elemento.
create or replace function app.theme_contrast_issues(p_settings jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  c jsonb := app.theme_default_colors() || coalesce(p_settings -> 'colors', '{}'::jsonb);
  v_bg text := c ->> 'background';
  v_bar jsonb := p_settings #> '{header,announcement}';
  v_primary_min numeric := case when p_settings #>> '{shape,button_style}' = 'outline' then 4.5 else 3 end;
  v_issues text[] := '{}';
  v_el record;
begin
  if app.contrast_ratio(c ->> 'foreground', v_bg) < 4.5 then v_issues := v_issues || 'foreground'::text; end if;
  if app.contrast_ratio(c ->> 'muted', v_bg) < 4.5 then v_issues := v_issues || 'muted'::text; end if;
  if app.contrast_ratio(c ->> 'primary', v_bg) < v_primary_min then v_issues := v_issues || 'primary'::text; end if;
  if app.contrast_ratio(c ->> 'accent', v_bg) < 3 then v_issues := v_issues || 'accent'::text; end if;
  if v_bar is not null and app.contrast_ratio(v_bar ->> 'foreground', v_bar ->> 'background') < 4.5 then
    v_issues := v_issues || 'announcement'::text;
  end if;
  if c ? 'sale' and app.contrast_ratio(c ->> 'sale', v_bg) < 4.5 then
    v_issues := v_issues || 'sale'::text;
  end if;
  for v_el in
    select e.key, e.value from jsonb_each(coalesce(p_settings -> 'element_colors', '{}'::jsonb)) e
     order by array_position(array['hero', 'header', 'nav_bar', 'cards', 'buttons', 'footer'], e.key)
  loop
    if app.contrast_ratio(v_el.value ->> 'foreground', v_el.value ->> 'background') < 4.5 then
      v_issues := v_issues || ('element_colors.' || v_el.key);
    end if;
    if v_el.value ? 'active'
       and app.contrast_ratio(v_el.value ->> 'active', v_el.value ->> 'background') < 4.5 then
      v_issues := v_issues || ('element_colors.' || v_el.key || '.active');
    end if;
  end loop;
  return v_issues;
end
$$;

create or replace function app.home_resolve(p_store_id uuid, p_sections jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_out     jsonb := '[]'::jsonb;
  v_section jsonb;
  v_props   jsonb;
  v_src     jsonb;
  v_image   jsonb;
  v_items   jsonb;
  v_source  jsonb;
  v_block   jsonb;
  v_ids     uuid[];
  v_cat     record;
  v_brand   record;
  v_value   record;
  -- Productos ya mostrados en secciones anteriores (revisión de conversión, M9).
  v_seen    uuid[] := '{}';
  v_limit   integer;
  v_fetch   integer;
begin
  for v_section in
    select e from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) e
     where (e ->> 'enabled')::boolean and app.theme_schedule_active(e)
  loop
    v_props := v_section -> 'props';
    v_block := null;
    case v_section ->> 'type'
      when 'hero' then
        v_image := case when v_props ? 'image_media_id'
                        then app.home_media_json(p_store_id, v_props ->> 'image_media_id') end;
        v_block := jsonb_build_object('heading', v_props -> 'heading', 'subheading', v_props -> 'subheading',
          'align', v_props -> 'align', 'cta', v_props -> 'cta', 'image', v_image,
          -- Tema v3: imagen del celular, presentación y portadas extra.
          'mobile_image', case when v_props ? 'mobile_image_media_id'
                               then app.home_media_json(p_store_id, v_props ->> 'mobile_image_media_id') end,
          'layout', coalesce(v_props ->> 'layout', 'split'),
          'autoplay', coalesce((v_props ->> 'autoplay')::boolean, false),
          'slides', coalesce((select jsonb_agg(jsonb_build_object(
                      'heading', x -> 'heading', 'subheading', x -> 'subheading', 'cta', x -> 'cta',
                      'image', case when x ? 'image_media_id'
                                    then app.home_media_json(p_store_id, x ->> 'image_media_id') end,
                      'mobile_image', case when x ? 'mobile_image_media_id'
                                           then app.home_media_json(p_store_id, x ->> 'mobile_image_media_id') end)
                      order by o)
                     from jsonb_array_elements(case when jsonb_typeof(v_props -> 'slides') = 'array'
                                                    then v_props -> 'slides' else '[]' end)
                          with ordinality t(x, o)), '[]'::jsonb));
      when 'featured_products' then
        v_src := v_props -> 'source';
        v_source := null;
        v_items := null;
        -- Se piden de más los ya mostrados para completar la sección sin repetir
        -- (máximo 48 productos por portada, F9-DESIGN §13 M3).
        v_limit := (v_props ->> 'limit')::numeric::integer;
        v_fetch := least(v_limit + cardinality(v_seen), 48);
        if v_src ->> 'type' = 'newest' then
          v_items := storefront.list_products(p_store_id, null, null, null, 'newest', null, null, true, null,
                                              v_fetch) -> 'items';
          v_source := jsonb_build_object('type', 'newest');
        elsif v_src ->> 'type' = 'best_selling' then
          v_items := storefront.list_products(p_store_id, null, null, null, 'best_selling', null, null, true, null,
                                              v_fetch) -> 'items';
          v_source := jsonb_build_object('type', 'best_selling');
        elsif v_src ->> 'type' = 'manual' then
          select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(v_src -> 'product_ids') x;
          v_items := app.home_product_cards(p_store_id, v_ids);
          v_source := jsonb_build_object('type', 'manual');
        elsif v_src ->> 'type' = 'category' then
          select c.path into v_cat from public.categories c
           where c.store_id = p_store_id and c.id = (v_src ->> 'id')::uuid and c.is_visible and c.deleted_at is null
             and app.category_public(p_store_id, c.id);
          if found then
            v_items := storefront.list_products(p_store_id, v_cat.path, null, null, 'newest', null, null, true, null,
                                                v_fetch) -> 'items';
            v_source := jsonb_build_object('type', 'category', 'path', v_cat.path);
          end if;
        elsif v_src ->> 'type' = 'brand' then
          select b.slug into v_brand from public.brands b
           where b.store_id = p_store_id and b.id = (v_src ->> 'id')::uuid and b.deleted_at is null;
          if found then
            v_items := storefront.list_products(p_store_id, null, v_brand.slug, null, 'newest', null, null, true, null,
                                                v_fetch) -> 'items';
            v_source := jsonb_build_object('type', 'brand', 'slug', v_brand.slug);
          end if;
        elsif v_src ->> 'type' = 'attribute_value' then
          select a.key as attribute_key, av.key as value_key into v_value
            from public.attribute_values av
            join public.attributes a on a.store_id = av.store_id and a.id = av.attribute_id
           where av.store_id = p_store_id and av.id = (v_src ->> 'id')::uuid and a.is_filterable;
          if found then
            v_items := storefront.list_products(p_store_id, null, null, null, 'newest', null, null, true, null,
                                                v_fetch,
                                                jsonb_build_object(v_value.attribute_key,
                                                                   jsonb_build_array(v_value.value_key))) -> 'items';
            v_source := jsonb_build_object('type', 'attribute_value', 'attribute', v_value.attribute_key,
                                           'value', v_value.value_key);
          end if;
        end if;
        -- Los elegidos a mano se muestran aunque ya hayan salido (los eligió la
        -- tienda); los automáticos omiten lo ya mostrado.
        if v_src ->> 'type' <> 'manual' then
          v_items := (select coalesce(jsonb_agg(i.e order by i.n), '[]'::jsonb)
                        from (select e, n from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) with ordinality x(e, n)
                               where not ((e ->> 'id')::uuid = any (v_seen))
                               order by n limit v_limit) i);
        end if;
        v_seen := v_seen || array(select (e ->> 'id')::uuid from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) e);
        if v_source is not null and jsonb_array_length(coalesce(v_items, '[]'::jsonb)) > 0 then
          v_block := jsonb_build_object('title', v_props -> 'title', 'show_view_all', v_props -> 'show_view_all',
            'source', v_source, 'items', v_items, 'layout', coalesce(v_props ->> 'layout', 'grid'));
        end if;
      when 'category_grid' then
        v_items := (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'path', c.path,
                       'image', (select jsonb_build_object('path', m.storage_path, 'width', m.width,
                                                           'height', m.height, 'alt', m.alt_text)
                                   from public.media m where m.store_id = c.store_id and m.id = c.image_media_id
                                    and m.status = 'ready' and m.deleted_at is null))
                       order by case when v_props ? 'category_ids'
                                     then array_position(array(select lower(x) from jsonb_array_elements_text(v_props -> 'category_ids') x),
                                                         c.id::text) end,
                                c.position, c.name), '[]'::jsonb)
                      from public.categories c
                     where c.store_id = p_store_id and c.deleted_at is null and c.is_visible
                       and app.category_public(p_store_id, c.id)
                       and case when v_props ? 'category_ids'
                                then c.id::text in (select lower(x) from jsonb_array_elements_text(v_props -> 'category_ids') x)
                                else c.parent_id is null end);
        if jsonb_array_length(v_items) > 0 then
          v_block := jsonb_build_object('title', v_props -> 'title', 'categories', v_items,
                                        'layout', coalesce(v_props ->> 'layout', 'grid'));
        end if;
      when 'promo_banner', 'image_with_text' then
        v_image := app.home_media_json(p_store_id, v_props ->> 'image_media_id');
        if v_image is not null then
          v_block := (v_props - 'image_media_id') || jsonb_build_object('image', v_image);
        end if;
      when 'brand_logos' then
        v_items := (select coalesce(jsonb_agg(jsonb_build_object('name', b.name, 'slug', b.slug,
                       'logo', case when m.id is not null
                                    then jsonb_build_object('path', m.storage_path, 'width', m.width,
                                                            'height', m.height) end)
                       order by array_position(array(select lower(x) from jsonb_array_elements_text(v_props -> 'brand_ids') x),
                                               b.id::text)), '[]'::jsonb)
                      from public.brands b
                      -- Tema v4: también las marcas sin logo (la tienda muestra sus iniciales).
                      left join public.media m on m.store_id = b.store_id and m.id = b.logo_media_id
                                              and m.status = 'ready' and m.deleted_at is null
                     where b.store_id = p_store_id and b.deleted_at is null
                       and b.id::text in (select lower(x) from jsonb_array_elements_text(v_props -> 'brand_ids') x));
        if jsonb_array_length(v_items) >= 2 then
          v_block := jsonb_build_object('title', v_props -> 'title', 'brands', v_items);
        end if;
      when 'goals' then
        v_items := (select coalesce(jsonb_agg(jsonb_build_object('label', av.label, 'attribute', a.key, 'value', av.key)
                       order by array_position(array(select lower(x) from jsonb_array_elements_text(v_props -> 'value_ids') x),
                                               av.id::text)), '[]'::jsonb)
                      from public.attribute_values av
                      join public.attributes a on a.store_id = av.store_id and a.id = av.attribute_id
                     where av.store_id = p_store_id and a.is_filterable
                       and av.id::text in (select lower(x) from jsonb_array_elements_text(v_props -> 'value_ids') x));
        if jsonb_array_length(v_items) > 0 then
          v_block := jsonb_build_object('title', v_props -> 'title', 'goals', v_items);
        end if;
      when 'reviews' then
        -- Solo opiniones verificadas y publicadas de productos activos (ADR-029).
        v_items := (select coalesce(jsonb_agg(jsonb_build_object('rating', x.rating, 'title', x.title, 'body', x.body,
                                                                 'author_name', x.author_name, 'created_at', x.created_at,
                                                                 'product', jsonb_build_object('title', x.product_title,
                                                                                               'slug', x.product_slug))
                                              order by x.created_at desc), '[]'::jsonb)
                      from (select r.rating, r.title, r.body, r.author_name, r.created_at,
                                   p.title as product_title, p.slug as product_slug
                              from public.product_reviews r
                              join public.products p on p.store_id = r.store_id and p.id = r.product_id
                             where r.store_id = p_store_id and r.status = 'published'
                               and p.status = 'active' and p.deleted_at is null
                             order by r.created_at desc
                             limit (v_props ->> 'limit')::numeric::integer) x);
        if jsonb_array_length(v_items) > 0 then
          v_block := jsonb_build_object('title', v_props -> 'title', 'reviews', v_items);
        end if;
      when 'testimonials', 'rich_text', 'faq', 'benefits', 'video', 'contact_map' then
        v_block := v_props;
      else
        null;
    end case;
    if v_block is not null then
      v_out := v_out || jsonb_build_array(v_block || jsonb_build_object(
        'id', v_section -> 'id', 'type', v_section -> 'type',
        'visibility', coalesce(v_section ->> 'visibility', 'all'),
        -- Tema v4: colores propios y espaciado del bloque (ya validados).
        'spacing', coalesce(v_section ->> 'spacing', 'normal'))
        || case when v_section ? 'colors' then jsonb_build_object('colors', v_section -> 'colors')
                else '{}'::jsonb end);
    end if;
  end loop;
  return v_out;
end
$function$;

create or replace function app.theme_settings_valid(p_settings jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_key   text;
  v_value jsonb;
  v_item  jsonb;
begin
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    return false;
  end if;
  for v_key, v_value in select * from jsonb_each(p_settings) loop
    if v_key = 'colors' then
      if not app.theme_keys_ok(v_value, '{}', array['primary', 'accent', 'background', 'foreground', 'muted', 'sale'])
         or exists (select 1 from jsonb_each(v_value) c where not app.theme_hex_valid(c.value)) then
        return false;
      end if;
    elsif v_key = 'favicon_media_id' then
      if not app.theme_uuid_valid(v_value) then
        return false;
      end if;
    elsif v_key = 'typography' then
      if not app.theme_keys_ok(v_value, '{}', array['heading', 'body'])
         or exists (select 1 from jsonb_each(v_value) t
                     where jsonb_typeof(t.value) <> 'string' or not ((t.value #>> '{}') = any (app.theme_font_keys()))) then
        return false;
      end if;
    elsif v_key = 'shape' then
      if not app.theme_keys_ok(v_value, '{}', array['radius', 'button_style', 'shadow', 'density'])
         or (v_value ? 'radius' and not app.theme_enum_valid(v_value -> 'radius', array['none', 'sm', 'md', 'full']))
         or (v_value ? 'button_style' and not app.theme_enum_valid(v_value -> 'button_style', array['solid', 'outline']))
         or (v_value ? 'shadow' and not app.theme_enum_valid(v_value -> 'shadow', array['none', 'soft', 'strong']))
         or (v_value ? 'density'
             and not app.theme_enum_valid(v_value -> 'density', array['compact', 'comfortable', 'spacious'])) then
        return false;
      end if;
    elsif v_key = 'header' then
      if not app.theme_keys_ok(v_value, '{}', array['logo_position', 'announcement', 'quick_links', 'nav_bar'])
         or (v_value ? 'logo_position' and not app.theme_enum_valid(v_value -> 'logo_position', array['left', 'center'])) then
        return false;
      end if;
      if v_value ? 'announcement' then
        v_item := v_value -> 'announcement';
        if not app.theme_keys_ok(v_item, array['text', 'background', 'foreground'],
                                 array['link', 'starts_at', 'ends_at', 'hidden'])
           or (v_item ? 'hidden' and jsonb_typeof(v_item -> 'hidden') <> 'boolean')
           or not app.theme_text_valid(v_item -> 'text', 1, 120)
           or not app.theme_hex_valid(v_item -> 'background')
           or not app.theme_hex_valid(v_item -> 'foreground')
           or (v_item ? 'link' and not app.theme_link_valid(v_item -> 'link'))
           or not app.theme_schedule_valid(v_item) then
          return false;
        end if;
      end if;
      -- Tema v4: barra de categorías del encabezado.
      if v_value ? 'nav_bar' and not app.theme_nav_bar_valid(v_value -> 'nav_bar') then
        return false;
      end if;
      if v_value ? 'quick_links' then
        if jsonb_typeof(v_value -> 'quick_links') <> 'array' or jsonb_array_length(v_value -> 'quick_links') > 4
           or exists (select 1 from jsonb_array_elements(v_value -> 'quick_links') q
                       where not (app.theme_keys_ok(q, array['label', 'link'])
                                  and app.theme_text_valid(q -> 'label', 1, 20)
                                  and app.theme_link_valid(q -> 'link'))) then
          return false;
        end if;
      end if;
    elsif v_key = 'element_colors' then
      -- Tema v4: colores propios por elemento (el contraste se revisa aparte).
      if not app.theme_keys_ok(v_value, '{}', array['hero', 'header', 'nav_bar', 'cards', 'buttons', 'footer'])
         or exists (select 1 from jsonb_each(v_value) e
                     where not app.theme_keys_ok(e.value, array['background', 'foreground'],
                                                 case when e.key = 'nav_bar' then array['active', 'border']
                                                      else '{}'::text[] end)
                        or exists (select 1 from jsonb_each(e.value) c where not app.theme_hex_valid(c.value))) then
        return false;
      end if;
    elsif v_key = 'footer' then
      if not app.theme_keys_ok(v_value, '{}', array['legal_text', 'payment_methods'])
         or (v_value ? 'legal_text' and not app.theme_text_valid(v_value -> 'legal_text', 1, 500, true))
         or (v_value ? 'payment_methods'
             and not app.theme_enum_list_valid(v_value -> 'payment_methods', app.theme_payment_methods(), 0, 8)) then
        return false;
      end if;
    elsif v_key = 'social' then
      if jsonb_typeof(v_value) <> 'array' or jsonb_array_length(v_value) > 8
         or exists (select 1 from jsonb_array_elements(v_value) s
                     where not app.theme_keys_ok(s, array['network', 'url'])
                        or jsonb_typeof(s -> 'network') <> 'string'
                        or not ((s ->> 'network') = any (app.theme_social_networks()))
                        or not app.theme_social_url_valid(s ->> 'network', s -> 'url'))
         or (select count(distinct s ->> 'network') from jsonb_array_elements(v_value) s) <> jsonb_array_length(v_value) then
        return false;
      end if;
    elsif v_key = 'seo' then
      if not app.theme_keys_ok(v_value, '{}', array['title', 'description', 'image_media_id'])
         or (v_value ? 'title' and not app.theme_text_valid(v_value -> 'title', 1, 70))
         or (v_value ? 'description' and not app.theme_text_valid(v_value -> 'description', 1, 160))
         or (v_value ? 'image_media_id' and not app.theme_uuid_valid(v_value -> 'image_media_id')) then
        return false;
      end if;
    elsif v_key = 'contact' then
      if not app.theme_keys_ok(v_value, '{}', array['whatsapp', 'address', 'hours'])
         or (v_value ? 'whatsapp' and not coalesce(jsonb_typeof(v_value -> 'whatsapp') = 'string'
                                                   and (v_value ->> 'whatsapp') ~ '^\+[1-9][0-9]{7,14}$', false))
         or (v_value ? 'address' and not app.theme_text_valid(v_value -> 'address', 1, 300, true))
         or (v_value ? 'hours' and not app.theme_text_valid(v_value -> 'hours', 1, 200, true)) then
        return false;
      end if;
    elsif v_key = 'product_page' then
      if not app.theme_keys_ok(v_value, '{}', array['gallery', 'show_price_per_serving', 'show_related', 'sticky_buy_bar'])
         or (v_value ? 'gallery' and not app.theme_enum_valid(v_value -> 'gallery', array['thumbnails', 'dots']))
         or (v_value ? 'show_price_per_serving' and not app.theme_bool_valid(v_value -> 'show_price_per_serving'))
         or (v_value ? 'show_related' and not app.theme_bool_valid(v_value -> 'show_related'))
         or (v_value ? 'sticky_buy_bar' and not app.theme_bool_valid(v_value -> 'sticky_buy_bar')) then
        return false;
      end if;
    elsif v_key = 'listing' then
      if not app.theme_keys_ok(v_value, '{}', array['columns_mobile', 'show_brand'])
         or (v_value ? 'columns_mobile' and not app.theme_int_between(v_value -> 'columns_mobile', 1, 2))
         or (v_value ? 'show_brand' and not app.theme_bool_valid(v_value -> 'show_brand')) then
        return false;
      end if;
    else
      return false;
    end if;
  end loop;
  return true;
end
$function$;

create or replace function app.theme_reference_issues(p_store_id uuid, p_settings jsonb, p_sections jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_issues  text[] := '{}';
  v_section jsonb;
  v_props   jsonb;
  v_id      uuid;
  v_ids     uuid[];
  v_src     jsonb;
begin
  if p_settings #>> '{seo,image_media_id}' is not null
     and not app.theme_media_ok(p_store_id, (p_settings #>> '{seo,image_media_id}')::uuid,
                                array['store_branding', 'banner']) then
    v_issues := v_issues || 'seo.image_media_id'::text;
  end if;
  -- Favicon: imagen de marca lista y cuadrada (se recorta a 32/180/192/512).
  if p_settings ->> 'favicon_media_id' is not null
     and not exists (select 1 from public.media m
                      where m.store_id = p_store_id and m.id = (p_settings ->> 'favicon_media_id')::uuid
                        and m.status = 'ready' and m.deleted_at is null and m.owner_type = 'store_branding'
                        and m.width is not null and m.width = m.height and m.width >= 48) then
    v_issues := v_issues || 'favicon_media_id'::text;
  end if;

  for v_section in select e from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) e loop
    v_props := v_section -> 'props';
    case v_section ->> 'type'
      when 'hero', 'promo_banner', 'image_with_text' then
        if v_props ? 'image_media_id'
           and not app.theme_media_ok(p_store_id, (v_props ->> 'image_media_id')::uuid, array['banner']) then
          v_issues := v_issues || ((v_section ->> 'id') || ':image_media_id');
        end if;
        -- Tema v3: imagen del celular y las de cada portada extra del hero.
        if v_props ? 'mobile_image_media_id'
           and not app.theme_media_ok(p_store_id, (v_props ->> 'mobile_image_media_id')::uuid, array['banner']) then
          v_issues := v_issues || ((v_section ->> 'id') || ':mobile_image_media_id');
        end if;
        if jsonb_typeof(v_props -> 'slides') = 'array' and exists (
             select 1 from jsonb_array_elements(v_props -> 'slides') x,
                           lateral (values (x ->> 'image_media_id'), (x ->> 'mobile_image_media_id')) m(id)
              where m.id is not null and not app.theme_media_ok(p_store_id, m.id::uuid, array['banner'])) then
          v_issues := v_issues || ((v_section ->> 'id') || ':slides');
        end if;
      when 'featured_products' then
        v_src := v_props -> 'source';
        if v_src ->> 'type' = 'manual' then
          select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(v_src -> 'product_ids') x;
          if (select count(*) from public.products p
               where p.store_id = p_store_id and p.id = any (v_ids) and p.deleted_at is null
                 and p.status <> 'archived') <> (select count(distinct x) from unnest(v_ids) x) then
            v_issues := v_issues || ((v_section ->> 'id') || ':source');
          end if;
        else
          v_id := (v_src ->> 'id')::uuid;
          if (v_src ->> 'type' = 'category' and not exists (
                select 1 from public.categories c
                 where c.store_id = p_store_id and c.id = v_id and c.is_visible and c.deleted_at is null
                   and app.category_public(p_store_id, c.id)))
             or (v_src ->> 'type' = 'brand' and not exists (
                select 1 from public.brands b where b.store_id = p_store_id and b.id = v_id and b.deleted_at is null))
             or (v_src ->> 'type' = 'attribute_value' and not exists (
                select 1 from public.attribute_values av
                  join public.attributes a on a.store_id = av.store_id and a.id = av.attribute_id
                 where av.store_id = p_store_id and av.id = v_id and a.is_filterable)) then
            v_issues := v_issues || ((v_section ->> 'id') || ':source');
          end if;
        end if;
      when 'category_grid' then
        if v_props ? 'category_ids' then
          select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(v_props -> 'category_ids') x;
          if (select count(*) from public.categories c
               where c.store_id = p_store_id and c.id = any (v_ids) and c.is_visible and c.deleted_at is null
                 and app.category_public(p_store_id, c.id))
             <> (select count(distinct x) from unnest(v_ids) x) then
            v_issues := v_issues || ((v_section ->> 'id') || ':category_ids');
          end if;
        end if;
      when 'brand_logos' then
        select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(v_props -> 'brand_ids') x;
        if (select count(*) from public.brands b
             -- Tema v4: también marcas sin logo (la tienda muestra sus iniciales).
             where b.store_id = p_store_id and b.id = any (v_ids) and b.deleted_at is null)
           <> (select count(distinct x) from unnest(v_ids) x) then
          v_issues := v_issues || ((v_section ->> 'id') || ':brand_ids');
        end if;
      when 'goals' then
        select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(v_props -> 'value_ids') x;
        if (select count(*) from public.attribute_values av
              join public.attributes a on a.store_id = av.store_id and a.id = av.attribute_id
             where av.store_id = p_store_id and av.id = any (v_ids) and a.is_filterable)
           <> (select count(distinct x) from unnest(v_ids) x) then
          v_issues := v_issues || ((v_section ->> 'id') || ':value_ids');
        end if;
      else
        null;
    end case;
  end loop;
  return v_issues;
end
$function$;

revoke all on function app.theme_contrast_issues(jsonb) from public;
