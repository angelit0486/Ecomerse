-- =============================================================================
-- ADR-034 · Tema v2 (aprobado por el propietario el 2026-10-20). Solo aditivo:
-- todo documento v1 es un v2 válido (el migrador v1 → v2 es la identidad).
--
-- Tema: favicon propio, sombras y densidad, anuncio con vigencia, accesos
-- rápidos del celular y opciones de presentación de ficha y listados (ninguna
-- oculta precios ni textos obligatorios).
-- Bloques: preguntas frecuentes, beneficios, objetivos, opiniones verificadas,
-- video (solo id; el reproductor carga al tocarlo), contacto; productos
-- elegidos a mano y carrusel. Comunes: visibilidad por dispositivo y vigencia.
-- Tope de 12 a 20 bloques.
--
-- Cada regla tiene su espejo en src/lib/theme/schema.ts (paridad en
-- tests/integration/theme-schema-parity.test.ts).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Validadores puros nuevos
-- -----------------------------------------------------------------------------

-- Fecha y hora con zona explícita (años 2000–2099) que existe en el calendario.
-- Igual que isValidInstant (src/lib/theme/constants.ts).
create or replace function app.theme_instant_valid(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
  v_day  date;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'string' then
    return false;
  end if;
  v_text := p_value #>> '{}';
  if v_text !~ '^(20[0-9][0-9])-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$' then
    return false;
  end if;
  -- Solo la parte de la fecha: no depende de la zona de la sesión.
  begin
    v_day := make_date(substr(v_text, 1, 4)::integer, substr(v_text, 6, 2)::integer, substr(v_text, 9, 2)::integer);
  exception when others then
    return false;
  end;
  return v_day is not null;
end
$$;

-- Instante (ya validado) → timestamptz. El texto lleva su zona: no depende de la sesión.
create or replace function app.theme_instant(p_value text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select replace(p_value, 'T', ' ')::timestamptz
$$;

-- Vigencia: claves opcionales starts_at/ends_at; si están las dos, inicio < fin.
create or replace function app.theme_schedule_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (not p ? 'starts_at' or app.theme_instant_valid(p -> 'starts_at'))
     and (not p ? 'ends_at' or app.theme_instant_valid(p -> 'ends_at'))
     and (not (p ? 'starts_at' and p ? 'ends_at')
          or not app.theme_instant_valid(p -> 'starts_at') or not app.theme_instant_valid(p -> 'ends_at')
          or app.theme_instant(p ->> 'starts_at') < app.theme_instant(p ->> 'ends_at'))
$$;

-- ¿Está vigente ahora? (para la tienda; sin vigencia, siempre).
create or replace function app.theme_schedule_active(p jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (not p ? 'starts_at' or app.theme_instant(p ->> 'starts_at') <= now())
     and (not p ? 'ends_at' or app.theme_instant(p ->> 'ends_at') > now())
$$;

create or replace function app.theme_bool_valid(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_value) = 'boolean', false)
$$;

create or replace function app.theme_enum_valid(p_value jsonb, p_allowed text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') = any (p_allowed), false)
$$;

create or replace function app.theme_int_between(p_value jsonb, p_min integer, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_value) = 'number' and (p_value #>> '{}') ~ '^[0-9]+$'
                  and (p_value #>> '{}')::numeric between p_min and p_max, false)
$$;

create or replace function app.theme_benefit_icons()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['truck', 'shield', 'return', 'chat', 'star', 'leaf', 'lab', 'card', 'gift', 'clock']
$$;

-- -----------------------------------------------------------------------------
-- 2. Tema v2
-- -----------------------------------------------------------------------------
create or replace function app.theme_settings_valid(p_settings jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
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
      if not app.theme_keys_ok(v_value, '{}', array['primary', 'accent', 'background', 'foreground', 'muted'])
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
      if not app.theme_keys_ok(v_value, '{}', array['logo_position', 'announcement', 'quick_links'])
         or (v_value ? 'logo_position' and not app.theme_enum_valid(v_value -> 'logo_position', array['left', 'center'])) then
        return false;
      end if;
      if v_value ? 'announcement' then
        v_item := v_value -> 'announcement';
        if not app.theme_keys_ok(v_item, array['text', 'background', 'foreground'], array['link', 'starts_at', 'ends_at'])
           or not app.theme_text_valid(v_item -> 'text', 1, 120)
           or not app.theme_hex_valid(v_item -> 'background')
           or not app.theme_hex_valid(v_item -> 'foreground')
           or (v_item ? 'link' and not app.theme_link_valid(v_item -> 'link'))
           or not app.theme_schedule_valid(v_item) then
          return false;
        end if;
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
$$;

-- -----------------------------------------------------------------------------
-- 3. Bloques v2
-- -----------------------------------------------------------------------------
create or replace function app.home_section_props_valid(p_type text, p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_src jsonb;
begin
  if p_type = 'hero' then
    return app.theme_keys_ok(p, array['heading', 'align'], array['subheading', 'image_media_id', 'cta'])
      and app.theme_text_valid(p -> 'heading', 1, 80)
      and app.theme_enum_valid(p -> 'align', array['left', 'center'])
      and (not p ? 'subheading' or app.theme_text_valid(p -> 'subheading', 1, 200))
      and (not p ? 'image_media_id' or app.theme_uuid_valid(p -> 'image_media_id'))
      and (not p ? 'cta' or app.home_cta_valid(p -> 'cta'));
  elsif p_type = 'featured_products' then
    v_src := p -> 'source';
    return app.theme_keys_ok(p, array['title', 'source', 'limit', 'show_view_all'], array['layout'])
      and app.theme_text_valid(p -> 'title', 1, 60)
      and app.theme_int_between(p -> 'limit', 4, 12)
      and app.theme_bool_valid(p -> 'show_view_all')
      and (not p ? 'layout' or app.theme_enum_valid(p -> 'layout', array['grid', 'carousel']))
      and coalesce(jsonb_typeof(v_src -> 'type') = 'string', false)
      and case v_src ->> 'type'
            when 'newest' then app.theme_keys_ok(v_src, array['type'])
            when 'best_selling' then app.theme_keys_ok(v_src, array['type'])
            when 'category' then app.theme_keys_ok(v_src, array['type', 'id']) and app.theme_uuid_valid(v_src -> 'id')
            when 'brand' then app.theme_keys_ok(v_src, array['type', 'id']) and app.theme_uuid_valid(v_src -> 'id')
            when 'attribute_value' then app.theme_keys_ok(v_src, array['type', 'id']) and app.theme_uuid_valid(v_src -> 'id')
            when 'manual' then app.theme_keys_ok(v_src, array['type', 'product_ids'])
                               and app.theme_uuid_list_valid(v_src -> 'product_ids', 1, 12)
            else false
          end;
  elsif p_type = 'category_grid' then
    return app.theme_keys_ok(p, array['title'], array['category_ids', 'layout'])
      and app.theme_text_valid(p -> 'title', 1, 60)
      and (not p ? 'category_ids' or app.theme_uuid_list_valid(p -> 'category_ids', 1, 12))
      and (not p ? 'layout' or app.theme_enum_valid(p -> 'layout', array['grid', 'carousel']));
  elsif p_type = 'promo_banner' then
    return app.theme_keys_ok(p, array['image_media_id'], array['heading', 'text', 'cta'])
      and app.theme_uuid_valid(p -> 'image_media_id')
      and (not p ? 'heading' or app.theme_text_valid(p -> 'heading', 1, 80))
      and (not p ? 'text' or app.theme_text_valid(p -> 'text', 1, 200))
      and (not p ? 'cta' or app.home_cta_valid(p -> 'cta'));
  elsif p_type = 'image_with_text' then
    return app.theme_keys_ok(p, array['image_media_id', 'heading', 'body', 'image_position'], array['cta'])
      and app.theme_uuid_valid(p -> 'image_media_id')
      and app.theme_text_valid(p -> 'heading', 1, 80)
      and app.theme_text_valid(p -> 'body', 1, 600, true)
      and app.theme_enum_valid(p -> 'image_position', array['left', 'right'])
      and (not p ? 'cta' or app.home_cta_valid(p -> 'cta'));
  elsif p_type = 'brand_logos' then
    return app.theme_keys_ok(p, array['title', 'brand_ids'])
      and app.theme_text_valid(p -> 'title', 1, 60)
      and app.theme_uuid_list_valid(p -> 'brand_ids', 2, 12);
  elsif p_type = 'testimonials' then
    return app.theme_keys_ok(p, array['title', 'items'])
      and app.theme_text_valid(p -> 'title', 1, 60)
      and coalesce(jsonb_typeof(p -> 'items') = 'array' and jsonb_array_length(p -> 'items') between 1 and 6, false)
      and not exists (select 1 from jsonb_array_elements(p -> 'items') i
                       where not (app.theme_keys_ok(i, array['quote', 'author'], array['detail'])
                                  and app.theme_text_valid(i -> 'quote', 1, 300, true)
                                  and app.theme_text_valid(i -> 'author', 1, 60)
                                  and (not i ? 'detail' or app.theme_text_valid(i -> 'detail', 1, 60))));
  elsif p_type = 'rich_text' then
    return app.theme_keys_ok(p, array['html'], array['heading'])
      and coalesce(jsonb_typeof(p -> 'html') = 'string' and char_length(p ->> 'html') >= 1
                   and octet_length(p ->> 'html') <= 20000, false)
      and (not p ? 'heading' or app.theme_text_valid(p -> 'heading', 1, 80));
  elsif p_type = 'faq' then
    return app.theme_keys_ok(p, array['title', 'items'])
      and app.theme_text_valid(p -> 'title', 1, 60)
      and coalesce(jsonb_typeof(p -> 'items') = 'array' and jsonb_array_length(p -> 'items') between 1 and 12, false)
      and not exists (select 1 from jsonb_array_elements(p -> 'items') i
                       where not (app.theme_keys_ok(i, array['question', 'answer'])
                                  and app.theme_text_valid(i -> 'question', 1, 150)
                                  and app.theme_text_valid(i -> 'answer', 1, 1000, true)));
  elsif p_type = 'benefits' then
    return app.theme_keys_ok(p, array['items'], array['title'])
      and (not p ? 'title' or app.theme_text_valid(p -> 'title', 1, 60))
      and coalesce(jsonb_typeof(p -> 'items') = 'array' and jsonb_array_length(p -> 'items') between 1 and 6, false)
      and not exists (select 1 from jsonb_array_elements(p -> 'items') i
                       where not (app.theme_keys_ok(i, array['icon', 'title'], array['text'])
                                  and app.theme_enum_valid(i -> 'icon', app.theme_benefit_icons())
                                  and app.theme_text_valid(i -> 'title', 1, 40)
                                  and (not i ? 'text' or app.theme_text_valid(i -> 'text', 1, 160))));
  elsif p_type = 'goals' then
    return app.theme_keys_ok(p, array['title', 'value_ids'])
      and app.theme_text_valid(p -> 'title', 1, 60)
      and app.theme_uuid_list_valid(p -> 'value_ids', 1, 12);
  elsif p_type = 'reviews' then
    return app.theme_keys_ok(p, array['title', 'limit'])
      and app.theme_text_valid(p -> 'title', 1, 60)
      and app.theme_int_between(p -> 'limit', 3, 12);
  elsif p_type = 'video' then
    return app.theme_keys_ok(p, array['provider', 'video_id', 'title'], array['caption'])
      and app.theme_enum_valid(p -> 'provider', array['youtube', 'vimeo'])
      and coalesce(jsonb_typeof(p -> 'video_id') = 'string'
                   and case p ->> 'provider'
                         when 'youtube' then (p ->> 'video_id') ~ '^[A-Za-z0-9_-]{11}$'
                         when 'vimeo' then (p ->> 'video_id') ~ '^[0-9]{6,12}$'
                         else false
                       end, false)
      and app.theme_text_valid(p -> 'title', 1, 80)
      and (not p ? 'caption' or app.theme_text_valid(p -> 'caption', 1, 200));
  elsif p_type = 'contact_map' then
    return app.theme_keys_ok(p, array['title', 'show_whatsapp'])
      and app.theme_text_valid(p -> 'title', 1, 60)
      and app.theme_bool_valid(p -> 'show_whatsapp');
  end if;
  return false;
end
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
                                                 array['visibility', 'starts_at', 'ends_at'])
                        or not app.theme_uuid_valid(s -> 'id')
                        or jsonb_typeof(s -> 'enabled') <> 'boolean'
                        or jsonb_typeof(s -> 'type') <> 'string'
                        or (s ? 'visibility' and not app.theme_enum_valid(s -> 'visibility', array['all', 'mobile', 'desktop']))
                        or not app.theme_schedule_valid(s)
                        or not app.home_section_props_valid(s ->> 'type', s -> 'props'))
    and (select count(distinct s -> 'id') from jsonb_array_elements(p_sections) s) = jsonb_array_length(p_sections)
    and (select count(*) from jsonb_array_elements(p_sections) s where s ->> 'type' = 'featured_products') <= 4,
    false)
$$;

-- -----------------------------------------------------------------------------
-- 4. Referencias (favicon, productos elegidos, objetivos) y cumplimiento
-- -----------------------------------------------------------------------------
create or replace function app.theme_reference_issues(p_store_id uuid, p_settings jsonb, p_sections jsonb)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
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
             where b.store_id = p_store_id and b.id = any (v_ids) and b.deleted_at is null
               and b.logo_media_id is not null) <> (select count(distinct x) from unnest(v_ids) x) then
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
$$;

-- Todo el texto visible de un bloque, para los términos prohibidos (D-F9-03).
create or replace function app.home_section_text(p_section jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(' ',
    p -> 'heading' #>> '{}', p ->> 'subheading', p ->> 'title', p ->> 'text', p ->> 'body', p ->> 'caption',
    p #>> '{cta,label}',
    (select string_agg(concat_ws(' ', i ->> 'quote', i ->> 'author', i ->> 'detail', i ->> 'question',
                                 i ->> 'answer', i ->> 'title', i ->> 'text'), ' ')
       from jsonb_array_elements(case when jsonb_typeof(p -> 'items') = 'array' then p -> 'items' else '[]' end) i),
    app.compliance_html_text(p ->> 'html'))
  from (select p_section -> 'props' as p) x
$$;

-- -----------------------------------------------------------------------------
-- 5. Tienda: bloques nuevos, visibilidad y vigencia
-- -----------------------------------------------------------------------------

-- Tarjetas de productos elegidos a mano, en el orden elegido, sin agotados
-- (como el resto de la portada). Respeta la vista previa de borradores (ADR-032).
create or replace function app.home_product_cards(p_store_id uuid, p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'slug', p.slug, 'title', p.title, 'brand', b.name,
           'min_price', p.min_price, 'max_price', p.max_price,
           'compare_at_price', (select min(v.compare_at_price) from public.product_variants v
                                 where v.product_id = p.id and v.status = 'active' and v.deleted_at is null
                                   and v.price = p.min_price),
           'availability', app.product_state(p_store_id, p.id),
           'published_at', p.published_at,
           'unpublished', p.status <> 'active',
           'servings', (select case when jsonb_typeof(i.data -> 'servings_per_container') = 'number'
                                 then (i.data ->> 'servings_per_container')::integer end
                          from public.product_regulatory_info i where i.store_id = p_store_id and i.product_id = p.id),
           'image', app.product_cover(p_store_id, p.id))
         order by array_position(p_ids, p.id)), '[]'::jsonb)
    from app.listing_products(p_store_id, null, null, null, null, null) l
    join public.products p on p.store_id = p_store_id and p.id = l.product_id
    left join public.brands b on b.store_id = p.store_id and b.id = p.brand_id and b.deleted_at is null
   where p.id = any (p_ids)
     and app.product_state(p_store_id, p.id) <> 'out_of_stock'
$$;

-- Misma función que 20261017000900 (sin repetir productos) más los bloques v2.
-- Envoltura común: se respetan `enabled` y la vigencia; la visibilidad viaja a la tienda.
create or replace function app.home_resolve(p_store_id uuid, p_sections jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
          'align', v_props -> 'align', 'cta', v_props -> 'cta', 'image', v_image);
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
                       'logo', jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height))
                       order by array_position(array(select lower(x) from jsonb_array_elements_text(v_props -> 'brand_ids') x),
                                               b.id::text)), '[]'::jsonb)
                      from public.brands b
                      join public.media m on m.store_id = b.store_id and m.id = b.logo_media_id
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
        'visibility', coalesce(v_section ->> 'visibility', 'all')));
    end if;
  end loop;
  return v_out;
end
$$;

-- -----------------------------------------------------------------------------
-- 5b. Datos públicos de la tienda: + favicon (misma función que 20261017001000).
-- -----------------------------------------------------------------------------
create or replace function app.store_public_json(p_store_id uuid, p_draft boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'name', s.name, 'handle', s.handle, 'status', s.status,
    'locale', s.locale, 'currency', s.currency, 'country', s.country,
    -- Apertura de la tienda: el catálogo con el que abre no lleva «Nuevo».
    'launched_at', s.launched_at,
    -- Zona horaria de la tienda: fechas estimadas de entrega en su calendario.
    'timezone', s.timezone,
    'primary_hostname', coalesce(
                          (select d.hostname from public.store_domains d
                            where d.store_id = s.id and d.is_primary and d.status = 'active'),
                          (select d.hostname from public.store_domains d
                            where d.store_id = s.id and d.type = 'platform_subdomain' and d.status = 'active'
                            order by d.created_at limit 1)),
    -- Contacto comercial de la tienda (§20.2: email, teléfono; WhatsApp, dirección
    -- y horario van en el tema).
    'contact', jsonb_strip_nulls(jsonb_build_object('email', s.contact_email, 'phone', s.contact_phone)),
    'theme', jsonb_build_object(
      'key', t.theme_key, 'version', t.theme_version,
      'settings', coalesce(case when p_draft then coalesce(t.draft_settings, t.settings) else t.settings end,
                           '{}'::jsonb),
      'published_at', t.published_at,
      'revision', case when p_draft then t.draft_revision end),
    'logo', (select jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height)
               from public.media m
              where m.store_id = s.id
                and m.id = case when p_draft and t.draft_settings is not null then t.draft_logo_media_id
                                else t.logo_media_id end
                and m.status = 'ready' and m.deleted_at is null),
    'seo_image', (select jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height,
                                            'alt', m.alt_text)
                    from public.media m
                   where m.store_id = s.id
                     and m.id = (case when p_draft then coalesce(t.draft_settings, t.settings) else t.settings end
                                 #>> '{seo,image_media_id}')::uuid
                     and m.status = 'ready' and m.deleted_at is null),
    -- Favicon propio (ADR-034): imagen de marca cuadrada de ESTA tienda.
    'favicon', (select jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height)
                  from public.media m
                 where m.store_id = s.id
                   and m.id = (case when p_draft then coalesce(t.draft_settings, t.settings) else t.settings end
                               ->> 'favicon_media_id')::uuid
                   and m.status = 'ready' and m.deleted_at is null and m.owner_type = 'store_branding')
  )
  from public.stores s
  left join public.store_themes t on t.store_id = s.id
  where s.id = p_store_id and s.status <> 'closed'
$$;

-- -----------------------------------------------------------------------------
-- 6. Versión del tema: el migrador v1 → v2 es la identidad.
-- -----------------------------------------------------------------------------
alter table public.store_themes alter column theme_version set default 2;
update public.store_themes set theme_version = 2 where theme_version < 2;

-- -----------------------------------------------------------------------------
-- 7. Permisos (§44.5)
-- -----------------------------------------------------------------------------
revoke all on function app.theme_instant_valid(jsonb) from public;
revoke all on function app.theme_instant(text) from public;
revoke all on function app.theme_schedule_valid(jsonb) from public;
revoke all on function app.theme_schedule_active(jsonb) from public;
revoke all on function app.theme_bool_valid(jsonb) from public;
revoke all on function app.theme_enum_valid(jsonb, text[]) from public;
revoke all on function app.theme_int_between(jsonb, integer, integer) from public;
revoke all on function app.theme_benefit_icons() from public;
revoke all on function app.home_product_cards(uuid, uuid[]) from public;
