-- =============================================================================
-- Portada de imágenes (misión «portada de imágenes», parte B). Extiende el tema
-- v2 (ADR-034, aprobado) como el tema v3 y el v4 (D-POR-02, D-POR-04): un tipo
-- de bloque nuevo, `image_carousel`, con las mismas reglas en SQL y en Zod
-- (paridad en theme-schema-cases.ts). Solo aditivo: todo documento anterior
-- sigue siendo válido y ningún bloque existente cambia.
--
-- - Solo imágenes: sin texto visible; texto alternativo obligatorio (no visible,
--   para lectores de pantalla), que pasa por la revisión de cumplimiento.
-- - Imagen de escritorio (obligatoria) y de celular (opcional), cada una con
--   punto focal; destino opcional (enlace interno o https); fechas opcionales.
-- - La tienda solo lo muestra con el interruptor `hero_image_carousel`
--   encendido para esa tienda (apagado por defecto).
--
-- Reversa: `update public.feature_flags set kill_switch = true where key =
-- 'hero_image_carousel'` oculta el bloque en todas las tiendas; los bloques
-- guardados quedan en el borrador o lo publicado sin afectar a los demás.
-- =============================================================================

insert into public.feature_flags (key, description, default_enabled, owner) values
  ('hero_image_carousel', 'Portada de solo imágenes con avance automático (parte B)', false, 'plataforma')
on conflict (key) do nothing;

-- Punto focal en porcentaje (0–100) para recortar sin perder lo importante.
create function app.home_focal_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p) = 'object'
    and app.theme_keys_ok(p, array['x', 'y'])
    and app.theme_int_between(p -> 'x', 0, 100)
    and app.theme_int_between(p -> 'y', 0, 100), false)
$$;

create function app.home_image_slide_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p) = 'object'
    and app.theme_keys_ok(p, array['image_media_id', 'alt'],
                          array['mobile_image_media_id', 'link', 'focal', 'mobile_focal', 'starts_at', 'ends_at'])
    and app.theme_uuid_valid(p -> 'image_media_id')
    and app.theme_text_valid(p -> 'alt', 1, 150)
    and (not p ? 'mobile_image_media_id' or app.theme_uuid_valid(p -> 'mobile_image_media_id'))
    and (not p ? 'link' or app.theme_link_valid(p -> 'link'))
    and (not p ? 'focal' or app.home_focal_valid(p -> 'focal'))
    and (not p ? 'mobile_focal' or app.home_focal_valid(p -> 'mobile_focal'))
    and app.theme_schedule_valid(p), false)
$$;

create function app.home_image_carousel_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p) = 'object'
    and app.theme_keys_ok(p, array['slides'],
                          array['interval_seconds', 'transition', 'show_arrows', 'aspect_desktop', 'aspect_mobile'])
    and jsonb_typeof(p -> 'slides') = 'array'
    and jsonb_array_length(p -> 'slides') between 1 and 10
    and not exists (select 1 from jsonb_array_elements(p -> 'slides') x where not app.home_image_slide_valid(x))
    and (not p ? 'interval_seconds' or app.theme_int_between(p -> 'interval_seconds', 3, 10))
    and (not p ? 'transition' or app.theme_enum_valid(p -> 'transition', array['slide', 'fade']))
    and (not p ? 'show_arrows' or app.theme_bool_valid(p -> 'show_arrows'))
    and (not p ? 'aspect_desktop' or app.theme_enum_valid(p -> 'aspect_desktop', array['21:9', '16:9', '3:1']))
    and (not p ? 'aspect_mobile' or app.theme_enum_valid(p -> 'aspect_mobile', array['4:5', '1:1', '3:4'])), false)
$$;

-- Los tipos anteriores siguen en app.home_section_props_valid sin cambios.
create function app.home_section_props_valid_v5(p_type text, p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when p_type = 'image_carousel' then app.home_image_carousel_valid(p)
              else app.home_section_props_valid(p_type, p) end
$$;

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
                        or not app.home_section_props_valid_v5(s ->> 'type', s -> 'props'))
    and (select count(distinct s -> 'id') from jsonb_array_elements(p_sections) s) = jsonb_array_length(p_sections)
    and (select count(*) from jsonb_array_elements(p_sections) s where s ->> 'type' = 'featured_products') <= 4,
    false)
$$;

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
      -- Portada de imágenes (hero_image_carousel): cada diapositiva con banners listos de la tienda.
      when 'image_carousel' then
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
      -- Portada de imágenes: solo diapositivas vigentes y con imagen de escritorio lista.
      when 'image_carousel' then
        v_items := (select coalesce(jsonb_agg(jsonb_build_object(
                       'image', app.home_media_json(p_store_id, x ->> 'image_media_id'),
                       'mobile_image', case when x ? 'mobile_image_media_id'
                                            then app.home_media_json(p_store_id, x ->> 'mobile_image_media_id') end,
                       'alt', x -> 'alt', 'link', x -> 'link', 'focal', x -> 'focal',
                       'mobile_focal', x -> 'mobile_focal') order by o), '[]'::jsonb)
                      from jsonb_array_elements(case when jsonb_typeof(v_props -> 'slides') = 'array'
                                                     then v_props -> 'slides' else '[]' end) with ordinality t(x, o)
                     where app.theme_schedule_active(x)
                       and app.home_media_json(p_store_id, x ->> 'image_media_id') is not null);
        if jsonb_array_length(v_items) > 0 then
          v_block := jsonb_build_object('slides', v_items,
            'interval_seconds', coalesce((v_props ->> 'interval_seconds')::integer, 4),
            'transition', coalesce(v_props ->> 'transition', 'slide'),
            'show_arrows', coalesce((v_props ->> 'show_arrows')::boolean, false),
            'aspect_desktop', coalesce(v_props ->> 'aspect_desktop', '21:9'),
            'aspect_mobile', coalesce(v_props ->> 'aspect_mobile', '4:5'));
        end if;
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

create or replace function app.home_section_text(p_section jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select concat_ws(' ',
    p -> 'heading' #>> '{}', p ->> 'subheading', p ->> 'title', p ->> 'text', p ->> 'body', p ->> 'caption',
    p #>> '{cta,label}',
    (select string_agg(concat_ws(' ', i ->> 'quote', i ->> 'author', i ->> 'detail', i ->> 'question',
                                 i ->> 'answer', i ->> 'title', i ->> 'text'), ' ')
       from jsonb_array_elements(case when jsonb_typeof(p -> 'items') = 'array' then p -> 'items' else '[]' end) i),
    app.compliance_html_text(p ->> 'html'),
    -- Tema v3: los textos de las portadas extra del hero.
    -- Portada de imágenes: el texto alternativo también pasa por la revisión.
    (select string_agg(concat_ws(' ', x ->> 'heading', x ->> 'subheading', x #>> '{cta,label}', x ->> 'alt'), ' ')
       from jsonb_array_elements(case when jsonb_typeof(p -> 'slides') = 'array' then p -> 'slides' else '[]' end) x))
  from (select p_section -> 'props' as p) x
$function$;

revoke all on function app.home_focal_valid(jsonb) from public;
revoke all on function app.home_image_slide_valid(jsonb) from public;
revoke all on function app.home_image_carousel_valid(jsonb) from public;
revoke all on function app.home_section_props_valid_v5(text, jsonb) from public;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261103000200'::text
$$;
