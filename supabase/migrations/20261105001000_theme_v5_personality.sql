-- =============================================================================
-- Tema v5 (ADR-063, fase B-1, aprobado por el propietario el 2026-11-05):
-- «Personalidad» del diseño, para que cada tienda tenga su propia esencia.
--
-- 1. `personality` en el tema, todo opcional y con valores fijos (sin CSS ni
--    JavaScript de la tienda, regla 13). Si falta, la tienda se ve como hoy:
--    - tarjeta de producto: estilo (outlined, flat, raised), proporción de la
--      foto (1:1, 4:5, 3:4), ajuste (contain, cover), efecto al pasar el cursor
--      (zoom, lift, none) y alineación del texto (start, center);
--    - títulos: mayúsculas, espaciado de letras, peso y escala;
--    - movimiento: none o subtle (la tienda respeta «reducir movimiento»).
-- 2. La personalidad viaja con el diseño portátil (`appearance_import_design`).
-- 3. Interruptor `theme_personality` (apagado; la tienda lo enciende en
--    Ajustes → Funciones): muestra la pestaña «Personalidad» en Apariencia.
--
-- Solo aditivo: todo tema v4 es un v5 válido.
-- Reversa: `update public.feature_flags set kill_switch = true where key =
-- 'theme_personality'` oculta la pestaña; un tema con `personality` sigue siendo
-- válido y la tienda lo dibuja con valores de una lista blanca.
-- =============================================================================

create or replace function app.theme_personality_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p) = 'object'
    and app.theme_keys_ok(p, '{}', array['card_style', 'image_ratio', 'image_fit', 'card_hover', 'card_align',
                                        'heading_case', 'heading_tracking', 'heading_weight', 'type_scale',
                                        'motion'])
    and (not p ? 'card_style' or app.theme_enum_valid(p -> 'card_style', array['outlined', 'flat', 'raised']))
    and (not p ? 'image_ratio' or app.theme_enum_valid(p -> 'image_ratio', array['1:1', '4:5', '3:4']))
    and (not p ? 'image_fit' or app.theme_enum_valid(p -> 'image_fit', array['contain', 'cover']))
    and (not p ? 'card_hover' or app.theme_enum_valid(p -> 'card_hover', array['zoom', 'lift', 'none']))
    and (not p ? 'card_align' or app.theme_enum_valid(p -> 'card_align', array['start', 'center']))
    and (not p ? 'heading_case' or app.theme_enum_valid(p -> 'heading_case', array['normal', 'uppercase']))
    and (not p ? 'heading_tracking'
         or app.theme_enum_valid(p -> 'heading_tracking', array['tight', 'normal', 'wide']))
    and (not p ? 'heading_weight'
         or app.theme_enum_valid(p -> 'heading_weight', array['regular', 'semibold', 'bold']))
    and (not p ? 'type_scale' or app.theme_enum_valid(p -> 'type_scale', array['compact', 'normal', 'large']))
    and (not p ? 'motion' or app.theme_enum_valid(p -> 'motion', array['none', 'subtle'])),
    false)
$$;
revoke all on function app.theme_personality_valid(jsonb) from public;

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
    elsif v_key = 'personality' then
      -- Tema v5 (ADR-063, fase B-1): personalidad del diseño, solo valores fijos.
      if not app.theme_personality_valid(v_value) then
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

-- El diseño portátil también lleva la personalidad.
create or replace function public.appearance_import_design(p_store_id uuid, p_settings jsonb, p_sections jsonb,
                                                          p_expected_revision integer, p_source text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys    text[] := array['colors', 'typography', 'shape', 'header', 'product_page', 'listing',
                                  'personality'];
  v_current jsonb;
  v_header  jsonb;
  v_patch   jsonb;
  v_rev     integer;
begin
  perform app.theme_require_editor(p_store_id);
  if jsonb_typeof(p_settings) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_settings) k where not (k = any (v_keys)))
     or (p_settings ? 'header' and (jsonb_typeof(p_settings -> 'header') <> 'object'
         or exists (select 1 from jsonb_object_keys(p_settings -> 'header') k where k <> 'logo_position')))
     or p_source is null or p_source !~ '^(file|store:[0-9a-f-]{36})$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'design';
  end if;
  select coalesce(t.draft_settings, t.settings, '{}'::jsonb) into v_current
    from public.store_themes t where t.store_id = p_store_id;
  -- El anuncio y los accesos rápidos son de la tienda: se conservan.
  v_header := (coalesce(v_current -> 'header', '{}'::jsonb) - 'logo_position')
              || coalesce(p_settings -> 'header', '{}'::jsonb);
  select jsonb_object_agg(k, case when k = 'header'
                                  then case when v_header = '{}'::jsonb then 'null'::jsonb else v_header end
                                  else coalesce(p_settings -> k, 'null'::jsonb) end)
    into v_patch from unnest(v_keys) k;
  v_rev := public.appearance_save_theme_draft(p_store_id, v_patch, p_expected_revision);
  v_rev := public.appearance_save_home_draft(p_store_id, p_sections, v_rev);
  perform audit.record('theme.design_imported', 'store_theme', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('source', p_source));
  return v_rev;
end
$$;

insert into public.feature_flags (key, description, default_enabled, owner, store_toggle) values
  ('theme_personality',
   'Apariencia: pestaña «Personalidad» (tarjetas de producto, títulos, escala y movimiento)', false,
   'plataforma', true)
on conflict (key) do nothing;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261105001000'::text
$$;
