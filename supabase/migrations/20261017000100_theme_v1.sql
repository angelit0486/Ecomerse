-- =============================================================================
-- Fase 9 · F9-T01/F9-T02 — Theme schema v1 completo (GATE0 §20.2, §43) y su
-- borrador. Diseño: docs/plan/F9-DESIGN.md (§2, §3, §4 y §13).
--
-- Implementa el esquema v1 que el contrato ya define (no lo cambia): encabezado,
-- pie, redes, SEO, contacto y las 8 secciones de la portada. Cada regla tiene su
-- espejo en src/lib/theme/schema.ts y la prueba de paridad las compara.
--
-- - Borrador atómico (§13 C1): la primera edición siembra tema, portada y logo;
--   publicar y descartar los mueven juntos.
-- - Parche por claves (§13 C2): guardar el tema no borra lo que no se manda.
-- - Revisión del borrador (§13 H1): ediciones simultáneas → conflict.
-- - Sin tablas nuevas (GATE0 PHASE 9): una columna y CHECK rehechos (§13 H3).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Validadores puros (immutable, sin leer tablas: los usan los CHECK)
-- -----------------------------------------------------------------------------

-- Texto ya recortado (mismo conjunto de espacios que String.prototype.trim), sin
-- controles (un salto de línea solo si es multilínea) y con largo en puntos de código.
create or replace function app.theme_text_valid(p_value jsonb, p_min integer, p_max integer,
                                                p_multiline boolean default false)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_value) = 'string'
    and (p_value #>> '{}') !~ '^[ \t\n\v\f\r   -     　﻿]'
    and (p_value #>> '{}') !~ '[ \t\n\v\f\r   -     　﻿]$'
    and (p_value #>> '{}') !~ case when p_multiline then '[\x01-\x09\x0b-\x1f\x7f]' else '[\x01-\x1f\x7f]' end
    and char_length(p_value #>> '{}') between p_min and p_max, false)
$$;

create or replace function app.theme_hex_valid(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '^#[0-9a-f]{6}$', false)
$$;

-- Igual que z.uuid() de Zod 4 (RFC 9562: versión 1–8 y variante, más nil y max).
create or replace function app.theme_uuid_valid(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~
    '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
    false)
$$;

-- Enlace (F9-DESIGN §2.4, §13 H2): ruta interna o https sin usuario, puerto,
-- mayúsculas ni IDN. Misma gramática que src/lib/theme/links.ts.
create or replace function app.theme_link_valid(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_value) = 'string'
    and char_length(p_value #>> '{}') <= 500
    and ((p_value #>> '{}') ~ '^/(?![/]|%5[cC]|%2[fF])[A-Za-z0-9._~!$&''()*+,;=:@%/?#-]*$'
         or (p_value #>> '{}') ~
            '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(/[A-Za-z0-9._~!$&''()*+,;=:@%/?#-]*)?$'),
    false)
$$;

create or replace function app.theme_social_url_valid(p_network text, p_url jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_url) = 'string'
    and char_length(p_url #>> '{}') <= 500
    and (p_url #>> '{}') ~ ('^https://([a-z0-9-]+\.)*('
      || case p_network
           when 'facebook' then 'facebook\.com|fb\.com'
           when 'instagram' then 'instagram\.com'
           when 'tiktok' then 'tiktok\.com'
           when 'youtube' then 'youtube\.com|youtu\.be'
           when 'x' then 'x\.com|twitter\.com'
           when 'whatsapp' then 'wa\.me|whatsapp\.com'
           when 'pinterest' then 'pinterest\.com|pin\.it'
           when 'linkedin' then 'linkedin\.com'
         end
      || ')(/[A-Za-z0-9._~!$&''()*+,;=:@%/?#-]*)?$'), false)
$$;

-- Objeto con exactamente estas claves obligatorias y, como mucho, estas opcionales.
create or replace function app.theme_keys_ok(p_value jsonb, p_required text[], p_optional text[] default '{}')
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_value) = 'object'
    and p_value ?& p_required
    and not exists (select 1 from jsonb_object_keys(p_value) k where not (k = any (p_required || p_optional))),
    false)
$$;

-- Listas cerradas (solo crecen; quitar un valor exige un migrador de settings, §13 H3).
create or replace function app.theme_font_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['inter', 'dm-sans', 'manrope', 'work-sans', 'lora', 'oswald', 'barlow-condensed',
               'montserrat', 'playfair-display', 'space-grotesk']
$$;

create or replace function app.theme_payment_methods()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['visa', 'mastercard', 'amex', 'oxxo', 'spei', 'paypal', 'mercado_pago', 'cash_on_delivery']
$$;

create or replace function app.theme_social_networks()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['facebook', 'instagram', 'tiktok', 'youtube', 'x', 'whatsapp', 'pinterest', 'linkedin']
$$;

-- Lista de strings de una lista cerrada, sin repetir.
create or replace function app.theme_enum_list_valid(p_value jsonb, p_allowed text[], p_min integer, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_value) = 'array'
    and jsonb_array_length(p_value) between p_min and p_max
    and not exists (select 1 from jsonb_array_elements(p_value) e
                     where jsonb_typeof(e) <> 'string' or not ((e #>> '{}') = any (p_allowed)))
    and (select count(distinct e) from jsonb_array_elements(p_value) e) = jsonb_array_length(p_value),
    false)
$$;

create or replace function app.theme_uuid_list_valid(p_value jsonb, p_min integer, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_value) = 'array'
    and jsonb_array_length(p_value) between p_min and p_max
    and not exists (select 1 from jsonb_array_elements(p_value) e where not app.theme_uuid_valid(e))
    and (select count(distinct e) from jsonb_array_elements(p_value) e) = jsonb_array_length(p_value),
    false)
$$;

-- -----------------------------------------------------------------------------
-- 2. Tema v1 (§2.1)
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
    elsif v_key = 'typography' then
      if not app.theme_keys_ok(v_value, '{}', array['heading', 'body'])
         or exists (select 1 from jsonb_each(v_value) t
                     where jsonb_typeof(t.value) <> 'string' or not ((t.value #>> '{}') = any (app.theme_font_keys()))) then
        return false;
      end if;
    elsif v_key = 'shape' then
      if not app.theme_keys_ok(v_value, '{}', array['radius', 'button_style'])
         or (v_value ? 'radius' and not coalesce((v_value ->> 'radius') = any (array['none', 'sm', 'md', 'full'])
                                                 and jsonb_typeof(v_value -> 'radius') = 'string', false))
         or (v_value ? 'button_style' and not coalesce((v_value ->> 'button_style') = any (array['solid', 'outline'])
                                                       and jsonb_typeof(v_value -> 'button_style') = 'string', false)) then
        return false;
      end if;
    elsif v_key = 'header' then
      if not app.theme_keys_ok(v_value, '{}', array['logo_position', 'announcement'])
         or (v_value ? 'logo_position' and not coalesce(jsonb_typeof(v_value -> 'logo_position') = 'string'
                                                        and (v_value ->> 'logo_position') = any (array['left', 'center']), false)) then
        return false;
      end if;
      if v_value ? 'announcement' then
        v_item := v_value -> 'announcement';
        if not app.theme_keys_ok(v_item, array['text', 'background', 'foreground'], array['link'])
           or not app.theme_text_valid(v_item -> 'text', 1, 120)
           or not app.theme_hex_valid(v_item -> 'background')
           or not app.theme_hex_valid(v_item -> 'foreground')
           or (v_item ? 'link' and not app.theme_link_valid(v_item -> 'link')) then
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
    else
      return false;
    end if;
  end loop;
  return true;
end
$$;

-- -----------------------------------------------------------------------------
-- 3. Portada v1 (§3)
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
      and coalesce(jsonb_typeof(p -> 'align') = 'string' and (p ->> 'align') = any (array['left', 'center']), false)
      and (not p ? 'subheading' or app.theme_text_valid(p -> 'subheading', 1, 200))
      and (not p ? 'image_media_id' or app.theme_uuid_valid(p -> 'image_media_id'))
      and (not p ? 'cta' or app.home_cta_valid(p -> 'cta'));
  elsif p_type = 'featured_products' then
    v_src := p -> 'source';
    return app.theme_keys_ok(p, array['title', 'source', 'limit', 'show_view_all'])
      and app.theme_text_valid(p -> 'title', 1, 60)
      and coalesce(jsonb_typeof(p -> 'limit') = 'number' and (p ->> 'limit')::numeric = trunc((p ->> 'limit')::numeric)
                   and (p ->> 'limit')::numeric between 4 and 12, false)
      and coalesce(jsonb_typeof(p -> 'show_view_all') = 'boolean', false)
      and coalesce(jsonb_typeof(v_src -> 'type') = 'string', false)
      and case v_src ->> 'type'
            when 'newest' then app.theme_keys_ok(v_src, array['type'])
            when 'best_selling' then app.theme_keys_ok(v_src, array['type'])
            when 'category' then app.theme_keys_ok(v_src, array['type', 'id']) and app.theme_uuid_valid(v_src -> 'id')
            when 'brand' then app.theme_keys_ok(v_src, array['type', 'id']) and app.theme_uuid_valid(v_src -> 'id')
            when 'attribute_value' then app.theme_keys_ok(v_src, array['type', 'id']) and app.theme_uuid_valid(v_src -> 'id')
            else false
          end;
  elsif p_type = 'category_grid' then
    return app.theme_keys_ok(p, array['title'], array['category_ids'])
      and app.theme_text_valid(p -> 'title', 1, 60)
      and (not p ? 'category_ids' or app.theme_uuid_list_valid(p -> 'category_ids', 1, 12));
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
      and coalesce(jsonb_typeof(p -> 'image_position') = 'string'
                   and (p ->> 'image_position') = any (array['left', 'right']), false)
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
  end if;
  return false;
end
$$;

create or replace function app.home_cta_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select app.theme_keys_ok(p, array['label', 'link'])
     and app.theme_text_valid(p -> 'label', 1, 30)
     and app.theme_link_valid(p -> 'link')
$$;

create or replace function app.home_sections_valid(p_sections jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_sections) = 'array'
    and jsonb_array_length(p_sections) <= 12
    and not exists (select 1 from jsonb_array_elements(p_sections) s
                     where not app.theme_keys_ok(s, array['id', 'type', 'enabled', 'props'])
                        or not app.theme_uuid_valid(s -> 'id')
                        or jsonb_typeof(s -> 'enabled') <> 'boolean'
                        or jsonb_typeof(s -> 'type') <> 'string'
                        or not app.home_section_props_valid(s ->> 'type', s -> 'props'))
    and (select count(distinct s -> 'id') from jsonb_array_elements(p_sections) s) = jsonb_array_length(p_sections)
    and (select count(*) from jsonb_array_elements(p_sections) s where s ->> 'type' = 'featured_products') <= 4,
    false)
$$;

-- -----------------------------------------------------------------------------
-- 4. Columna de revisión y CHECK rehechos (§13 H1, H3): recrear el CHECK valida
--    todas las filas existentes, también los borradores.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.store_themes t
              where not app.theme_settings_valid(t.settings)
                 or (t.draft_settings is not null and not app.theme_settings_valid(t.draft_settings))) then
    raise exception 'store_themes tiene configuraciones fuera del esquema v1 (p. ej. una tipografía fuera de la lista curada); migra esos valores antes de aplicar esta migración';
  end if;
end
$$;

-- Borradores a medias de versiones anteriores → borrador atómico.
update public.store_themes
   set draft_home_sections = coalesce(draft_home_sections, home_sections),
       draft_settings = coalesce(draft_settings, settings),
       draft_logo_media_id = case when draft_settings is null then logo_media_id else draft_logo_media_id end
 where draft_settings is not null or draft_home_sections is not null;

alter table public.store_themes
  add column draft_revision integer not null default 0 check (draft_revision >= 0),
  drop constraint store_themes_settings_check,
  drop constraint store_themes_draft_settings_check,
  drop constraint store_themes_home_sections_check,
  drop constraint store_themes_draft_home_sections_check,
  add constraint store_themes_settings_check check (app.theme_settings_valid(settings)),
  add constraint store_themes_draft_settings_check
    check (draft_settings is null or app.theme_settings_valid(draft_settings)),
  add constraint store_themes_home_sections_check check (app.home_sections_valid(home_sections)),
  add constraint store_themes_draft_home_sections_check
    check (draft_home_sections is null or app.home_sections_valid(draft_home_sections)),
  add constraint store_themes_draft_atomic check ((draft_settings is null) = (draft_home_sections is null));

-- -----------------------------------------------------------------------------
-- 5. Contraste (§2.1, §13 M5): barra de anuncio y botón outline exigen 4.5:1.
--    Mismas claves y orden que themeContrastIssues (src/lib/theme/palette.ts).
-- -----------------------------------------------------------------------------
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
begin
  if app.contrast_ratio(c ->> 'foreground', v_bg) < 4.5 then v_issues := v_issues || 'foreground'::text; end if;
  if app.contrast_ratio(c ->> 'muted', v_bg) < 4.5 then v_issues := v_issues || 'muted'::text; end if;
  if app.contrast_ratio(c ->> 'primary', v_bg) < v_primary_min then v_issues := v_issues || 'primary'::text; end if;
  if app.contrast_ratio(c ->> 'accent', v_bg) < 3 then v_issues := v_issues || 'accent'::text; end if;
  if v_bar is not null and app.contrast_ratio(v_bar ->> 'foreground', v_bar ->> 'background') < 4.5 then
    v_issues := v_issues || 'announcement'::text;
  end if;
  return v_issues;
end
$$;

-- -----------------------------------------------------------------------------
-- 6. Referencias a filas de la tienda (§3): se validan al guardar y otra vez al
--    publicar (pueden borrarse entre medio). Devuelve los problemas, vacío = bien.
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
        v_id := (v_src ->> 'id')::uuid;
        if (v_src ->> 'type' = 'category' and not exists (
              select 1 from public.categories c
               where c.store_id = p_store_id and c.id = v_id and c.is_visible and c.deleted_at is null))
           or (v_src ->> 'type' = 'brand' and not exists (
              select 1 from public.brands b where b.store_id = p_store_id and b.id = v_id and b.deleted_at is null))
           or (v_src ->> 'type' = 'attribute_value' and not exists (
              select 1 from public.attribute_values av
                join public.attributes a on a.store_id = av.store_id and a.id = av.attribute_id
               where av.store_id = p_store_id and av.id = v_id and a.is_filterable)) then
          v_issues := v_issues || ((v_section ->> 'id') || ':source');
        end if;
      when 'category_grid' then
        if v_props ? 'category_ids' then
          select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(v_props -> 'category_ids') x;
          if (select count(*) from public.categories c
               where c.store_id = p_store_id and c.id = any (v_ids) and c.is_visible and c.deleted_at is null)
             <> cardinality(v_ids) then
            v_issues := v_issues || ((v_section ->> 'id') || ':category_ids');
          end if;
        end if;
      when 'brand_logos' then
        select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(v_props -> 'brand_ids') x;
        if (select count(*) from public.brands b
             where b.store_id = p_store_id and b.id = any (v_ids) and b.deleted_at is null
               and b.logo_media_id is not null) <> cardinality(v_ids) then
          v_issues := v_issues || ((v_section ->> 'id') || ':brand_ids');
        end if;
      else
        null;
    end case;
  end loop;
  return v_issues;
end
$$;

create or replace function app.theme_media_ok(p_store_id uuid, p_media_id uuid, p_owner_types text[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.media m
                  where m.store_id = p_store_id and m.id = p_media_id and m.status = 'ready'
                    and m.deleted_at is null and m.owner_type = any (p_owner_types))
$$;

-- -----------------------------------------------------------------------------
-- 7. Cumplimiento en la portada (§3, D-F9-03): términos prohibidos de las
--    categorías que declaró la tienda, en todo el texto visible de las secciones.
--    Devuelve 'compliance_forbidden_term:<regla>@<sección>'.
-- -----------------------------------------------------------------------------
create or replace function app.home_section_text(p_section jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(' ',
    p -> 'heading' #>> '{}', p ->> 'subheading', p ->> 'title', p ->> 'text', p ->> 'body',
    p #>> '{cta,label}',
    (select string_agg(concat_ws(' ', i ->> 'quote', i ->> 'author', i ->> 'detail'), ' ')
       from jsonb_array_elements(case when jsonb_typeof(p -> 'items') = 'array' then p -> 'items' else '[]' end) i),
    app.compliance_html_text(p ->> 'html'))
  from (select p_section -> 'props' as p) x
$$;

create or replace function app.home_compliance_issues(p_store_id uuid, p_sections jsonb)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct 'compliance_forbidden_term:' || r.key || '@' || (s ->> 'id')
                            order by 'compliance_forbidden_term:' || r.key || '@' || (s ->> 'id')), '{}')
    from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) s
    join public.store_regulated_categories d on d.store_id = p_store_id
    join public.stores st on st.id = p_store_id
    join public.compliance_profiles cp
      on cp.country = st.country::text and cp.category_key = d.category_key and cp.status = 'active'
    join public.compliance_rules r
      on r.profile_id = cp.id and r.status = 'active' and r.kind = 'forbidden_term'
   where app.compliance_text(app.home_section_text(s)) ~ app.compliance_term_regex(r.body)
$$;

-- -----------------------------------------------------------------------------
-- 8. Borrador: siembra atómica, revisión y RPCs (§4, §13 C1, C2, H1)
-- -----------------------------------------------------------------------------

-- Bloquea la fila, comprueba la revisión esperada y siembra el borrador si no lo
-- había. Devuelve la fila bloqueada.
create or replace function app.theme_lock_draft(p_store_id uuid, p_expected_revision integer)
returns public.store_themes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.store_themes;
begin
  insert into public.store_themes (store_id) values (p_store_id) on conflict (store_id) do nothing;
  select * into v from public.store_themes t where t.store_id = p_store_id for update;
  if p_expected_revision is null or v.draft_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'draft_revision',
      hint = v.draft_revision::text;
  end if;
  if v.draft_settings is null then
    update public.store_themes t
       set draft_settings = t.settings, draft_home_sections = t.home_sections,
           draft_logo_media_id = t.logo_media_id
     where t.store_id = p_store_id
    returning * into v;
  end if;
  return v;
end
$$;

create or replace function app.theme_require_editor(p_store_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_aal2_user();
begin
  if not app.has_store_permission(p_store_id, 'appearance.manage') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  return v_uid;
end
$$;

drop function public.appearance_save_theme_draft(uuid, jsonb);
drop function public.appearance_set_logo_draft(uuid, uuid);
drop function public.appearance_publish_theme(uuid);

-- Parche por claves de primer nivel: lo que no se manda no cambia; null quita la clave.
create or replace function public.appearance_save_theme_draft(p_store_id uuid, p_patch jsonb,
                                                              p_expected_revision integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_theme  public.store_themes;
  v_after  jsonb;
  v_issues text[];
begin
  perform app.theme_require_editor(p_store_id);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'settings';
  end if;
  v_theme := app.theme_lock_draft(p_store_id, p_expected_revision);
  v_after := (v_theme.draft_settings || p_patch)
             - coalesce((select array_agg(k) from jsonb_each(p_patch) e(k, v) where v = 'null'::jsonb), '{}');
  if not app.theme_settings_valid(v_after) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'settings';
  end if;
  v_issues := app.theme_contrast_issues(v_after);
  if cardinality(v_issues) > 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'contrast',
      hint = array_to_string(v_issues, ',');
  end if;
  v_issues := app.theme_reference_issues(p_store_id, v_after, null);
  if cardinality(v_issues) > 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'references',
      hint = array_to_string(v_issues, ',');
  end if;

  update public.store_themes
     set draft_settings = v_after, draft_revision = draft_revision + 1
   where store_id = p_store_id;

  perform audit.record('theme.draft_saved', 'store_theme', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('settings', v_theme.draft_settings),
                       jsonb_build_object('settings', v_after));
  return v_theme.draft_revision + 1;
end
$$;

-- Logo del borrador (null lo quita). Solo un medio de branding listo de ESA tienda.
create or replace function public.appearance_set_logo_draft(p_store_id uuid, p_media_id uuid,
                                                            p_expected_revision integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_theme public.store_themes;
begin
  perform app.require_store_permission(p_store_id, 'appearance.manage');
  if p_media_id is not null and not app.theme_media_ok(p_store_id, p_media_id, array['store_branding']) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'logo';
  end if;
  v_theme := app.theme_lock_draft(p_store_id, p_expected_revision);
  update public.store_themes
     set draft_logo_media_id = p_media_id, draft_revision = draft_revision + 1
   where store_id = p_store_id;
  perform audit.record('theme.logo_draft_set', 'store_theme', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('logo_media_id', v_theme.draft_logo_media_id),
                       jsonb_build_object('logo_media_id', p_media_id));
  return v_theme.draft_revision + 1;
end
$$;

-- Portada del borrador (lista completa). El HTML de `rich_text` llega ya saneado
-- por la app (SafeHtml); aquí solo se rechaza lo que un saneado nunca deja pasar.
create or replace function public.appearance_save_home_draft(p_store_id uuid, p_sections jsonb,
                                                             p_expected_revision integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_theme  public.store_themes;
  v_issues text[];
begin
  perform app.theme_require_editor(p_store_id);
  if not app.home_sections_valid(p_sections) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'sections';
  end if;
  if exists (select 1 from jsonb_array_elements(p_sections) s
              where s ->> 'type' = 'rich_text'
                and (s #>> '{props,html}') ~* '<\s*(script|style|iframe|object|embed)|\son[a-z]+\s*=|javascript:') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'html';
  end if;
  v_theme := app.theme_lock_draft(p_store_id, p_expected_revision);
  v_issues := app.theme_reference_issues(p_store_id, null, p_sections);
  if cardinality(v_issues) > 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'references',
      hint = array_to_string(v_issues, ',');
  end if;

  update public.store_themes
     set draft_home_sections = p_sections, draft_revision = draft_revision + 1
   where store_id = p_store_id;

  perform audit.record('theme.home_draft_saved', 'store_theme', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('home_sections', v_theme.draft_home_sections),
                       jsonb_build_object('home_sections', p_sections));
  return v_theme.draft_revision + 1;
end
$$;

create or replace function public.appearance_discard_draft(p_store_id uuid, p_expected_revision integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.store_themes;
begin
  perform app.theme_require_editor(p_store_id);
  select * into v from public.store_themes t where t.store_id = p_store_id for update;
  if v.store_id is null or v.draft_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'draft_revision',
      hint = coalesce(v.draft_revision, 0)::text;
  end if;
  if v.draft_settings is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'no_draft';
  end if;
  update public.store_themes
     set draft_settings = null, draft_home_sections = null, draft_logo_media_id = null,
         draft_revision = draft_revision + 1
   where store_id = p_store_id;
  perform audit.record('theme.draft_discarded', 'store_theme', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('settings', v.draft_settings, 'home_sections', v.draft_home_sections,
                                          'logo_media_id', v.draft_logo_media_id),
                       null);
  return v.draft_revision + 1;
end
$$;

-- Publica el borrador completo (tema, portada y logo). Revalida todo con lo que
-- va a quedar publicado. Devuelve {published_at, revision}.
create or replace function public.appearance_publish_theme(p_store_id uuid, p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.theme_require_editor(p_store_id);
  v        public.store_themes;
  v_issues text[];
  v_now    timestamptz := now();
begin
  select * into v from public.store_themes t where t.store_id = p_store_id for update;
  if v.store_id is null or v.draft_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'draft_revision',
      hint = coalesce(v.draft_revision, 0)::text;
  end if;
  if v.draft_settings is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'no_draft';
  end if;
  v_issues := app.theme_contrast_issues(v.draft_settings);
  if cardinality(v_issues) > 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'contrast',
      hint = array_to_string(v_issues, ',');
  end if;
  v_issues := app.theme_reference_issues(p_store_id, v.draft_settings, v.draft_home_sections);
  if v.draft_logo_media_id is not null
     and not app.theme_media_ok(p_store_id, v.draft_logo_media_id, array['store_branding']) then
    v_issues := v_issues || 'logo'::text;
  end if;
  if cardinality(v_issues) > 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'references',
      hint = array_to_string(v_issues, ',');
  end if;
  v_issues := app.home_compliance_issues(p_store_id, v.draft_home_sections);
  if cardinality(v_issues) > 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'compliance',
      hint = array_to_string(v_issues, ',');
  end if;

  update public.store_themes
     set settings = draft_settings, home_sections = draft_home_sections, logo_media_id = draft_logo_media_id,
         draft_settings = null, draft_home_sections = null, draft_logo_media_id = null,
         draft_revision = draft_revision + 1, published_at = v_now, published_by = v_uid
   where store_id = p_store_id;

  perform audit.record('theme.published', 'store_theme', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('settings', v.settings, 'home_sections', v.home_sections,
                                          'logo_media_id', v.logo_media_id),
                       jsonb_build_object('settings', v.draft_settings, 'home_sections', v.draft_home_sections,
                                          'logo_media_id', v.draft_logo_media_id));
  return jsonb_build_object('published_at', v_now, 'revision', v.draft_revision + 1);
end
$$;

-- -----------------------------------------------------------------------------
-- 9. Permisos (§44.5)
-- -----------------------------------------------------------------------------
revoke all on function app.theme_text_valid(jsonb, integer, integer, boolean) from public;
revoke all on function app.theme_hex_valid(jsonb) from public;
revoke all on function app.theme_uuid_valid(jsonb) from public;
revoke all on function app.theme_link_valid(jsonb) from public;
revoke all on function app.theme_social_url_valid(text, jsonb) from public;
revoke all on function app.theme_keys_ok(jsonb, text[], text[]) from public;
revoke all on function app.theme_font_keys() from public;
revoke all on function app.theme_payment_methods() from public;
revoke all on function app.theme_social_networks() from public;
revoke all on function app.theme_enum_list_valid(jsonb, text[], integer, integer) from public;
revoke all on function app.theme_uuid_list_valid(jsonb, integer, integer) from public;
revoke all on function app.theme_settings_valid(jsonb) from public;
revoke all on function app.home_section_props_valid(text, jsonb) from public;
revoke all on function app.home_cta_valid(jsonb) from public;
revoke all on function app.home_sections_valid(jsonb) from public;
revoke all on function app.theme_contrast_issues(jsonb) from public;
revoke all on function app.theme_reference_issues(uuid, jsonb, jsonb) from public;
revoke all on function app.theme_media_ok(uuid, uuid, text[]) from public;
revoke all on function app.home_section_text(jsonb) from public;
revoke all on function app.home_compliance_issues(uuid, jsonb) from public;
revoke all on function app.theme_lock_draft(uuid, integer) from public;
revoke all on function app.theme_require_editor(uuid) from public;

revoke all on function public.appearance_save_theme_draft(uuid, jsonb, integer) from public;
revoke all on function public.appearance_set_logo_draft(uuid, uuid, integer) from public;
revoke all on function public.appearance_save_home_draft(uuid, jsonb, integer) from public;
revoke all on function public.appearance_discard_draft(uuid, integer) from public;
revoke all on function public.appearance_publish_theme(uuid, integer) from public;
grant execute on function public.appearance_save_theme_draft(uuid, jsonb, integer) to authenticated;
grant execute on function public.appearance_set_logo_draft(uuid, uuid, integer) to authenticated;
grant execute on function public.appearance_save_home_draft(uuid, jsonb, integer) to authenticated;
grant execute on function public.appearance_discard_draft(uuid, integer) to authenticated;
grant execute on function public.appearance_publish_theme(uuid, integer) to authenticated;
