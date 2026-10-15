-- =============================================================================
-- Gate F9 — correcciones de la revisión adversarial de base de datos
-- (docs/phases/PHASE-09-REPORT.md). Forward-only: redefine funciones de
-- 20261017000100 y 20261017000300 con cambios mínimos.
--   G9-1 (media) Una categoría bajo un padre oculto pasaba como referencia y
--        salía en la portada: se exige app.category_public (validación al
--        guardar y publicar, category_grid y fuente «categoría»).
--   G9-2 (media) Con un borrador de portada vacío, la vista previa mostraba lo
--        publicado en vez de la plantilla que quedaría: app.home_template.
--   G9-3 (baja) `limit: 4.0` pasaba la validación y rompía la portada: se exige
--        un entero literal y se lee de forma robusta.
--   G9-4 (baja) Publicar o descartar con revisión NULL se saltaba el control de
--        concurrencia.
--   G9-5 (baja) Ids en mayúsculas pasaban la validación y la portada los
--        descartaba sin avisar; repetidos con distinta caja contaban doble.
-- =============================================================================

create or replace function app.theme_uuid_list_valid(p_value jsonb, p_min integer, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_value) = 'array'
    and jsonb_array_length(p_value) between p_min and p_max
    and not exists (select 1 from jsonb_array_elements(p_value) e where not app.theme_uuid_valid(e))
    and (select count(distinct lower(e #>> '{}')) from jsonb_array_elements(p_value) e) = jsonb_array_length(p_value),
    false)
$$;

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
      and coalesce(jsonb_typeof(p -> 'limit') = 'number' and (p ->> 'limit') ~ '^[0-9]+$'
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
      else
        null;
    end case;
  end loop;
  return v_issues;
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
  if v.store_id is null or p_expected_revision is null or v.draft_revision <> p_expected_revision then
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
  if v.store_id is null or p_expected_revision is null or v.draft_revision <> p_expected_revision then
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

create or replace function app.home_media_json(p_store_id uuid, p_media_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height, 'alt', m.alt_text)
    from public.media m
   where m.store_id = p_store_id and m.id::text = lower(p_media_id)
     and m.status = 'ready' and m.deleted_at is null and m.owner_type = 'banner'
$$;

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
  v_cat     record;
  v_brand   record;
  v_value   record;
begin
  for v_section in
    select e from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) e where (e ->> 'enabled')::boolean
  loop
    v_props := v_section -> 'props';
    case v_section ->> 'type'
      when 'hero' then
        v_image := case when v_props ? 'image_media_id'
                        then app.home_media_json(p_store_id, v_props ->> 'image_media_id') end;
        v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_section -> 'id', 'type', 'hero',
          'heading', v_props -> 'heading', 'subheading', v_props -> 'subheading', 'align', v_props -> 'align',
          'cta', v_props -> 'cta', 'image', v_image));
      when 'featured_products' then
        v_src := v_props -> 'source';
        v_source := null;
        if v_src ->> 'type' = 'newest' then
          v_items := storefront.list_products(p_store_id, null, null, null, 'newest', null, null, true, null,
                                              (v_props ->> 'limit')::numeric::integer) -> 'items';
          v_source := jsonb_build_object('type', 'newest');
        elsif v_src ->> 'type' = 'best_selling' then
          v_items := storefront.list_products(p_store_id, null, null, null, 'best_selling', null, null, true, null,
                                              (v_props ->> 'limit')::numeric::integer) -> 'items';
          v_source := jsonb_build_object('type', 'best_selling');
        elsif v_src ->> 'type' = 'category' then
          select c.path into v_cat from public.categories c
           where c.store_id = p_store_id and c.id = (v_src ->> 'id')::uuid and c.is_visible and c.deleted_at is null
             and app.category_public(p_store_id, c.id);
          if found then
            v_items := storefront.list_products(p_store_id, v_cat.path, null, null, 'newest', null, null, true, null,
                                                (v_props ->> 'limit')::numeric::integer) -> 'items';
            v_source := jsonb_build_object('type', 'category', 'path', v_cat.path);
          end if;
        elsif v_src ->> 'type' = 'brand' then
          select b.slug into v_brand from public.brands b
           where b.store_id = p_store_id and b.id = (v_src ->> 'id')::uuid and b.deleted_at is null;
          if found then
            v_items := storefront.list_products(p_store_id, null, v_brand.slug, null, 'newest', null, null, true, null,
                                                (v_props ->> 'limit')::numeric::integer) -> 'items';
            v_source := jsonb_build_object('type', 'brand', 'slug', v_brand.slug);
          end if;
        elsif v_src ->> 'type' = 'attribute_value' then
          select a.key as attribute_key, av.key as value_key into v_value
            from public.attribute_values av
            join public.attributes a on a.store_id = av.store_id and a.id = av.attribute_id
           where av.store_id = p_store_id and av.id = (v_src ->> 'id')::uuid and a.is_filterable;
          if found then
            v_items := storefront.list_products(p_store_id, null, null, null, 'newest', null, null, true, null,
                                                (v_props ->> 'limit')::numeric::integer,
                                                jsonb_build_object(v_value.attribute_key,
                                                                   jsonb_build_array(v_value.value_key))) -> 'items';
            v_source := jsonb_build_object('type', 'attribute_value', 'attribute', v_value.attribute_key,
                                           'value', v_value.value_key);
          end if;
        end if;
        if v_source is not null and jsonb_array_length(coalesce(v_items, '[]'::jsonb)) > 0 then
          v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_section -> 'id', 'type', 'featured_products',
            'title', v_props -> 'title', 'show_view_all', v_props -> 'show_view_all', 'source', v_source,
            'items', v_items));
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
          v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_section -> 'id', 'type', 'category_grid',
            'title', v_props -> 'title', 'categories', v_items));
        end if;
      when 'promo_banner', 'image_with_text' then
        v_image := app.home_media_json(p_store_id, v_props ->> 'image_media_id');
        if v_image is not null then
          v_out := v_out || jsonb_build_array((v_props - 'image_media_id')
                                              || jsonb_build_object('id', v_section -> 'id',
                                                                    'type', v_section -> 'type', 'image', v_image));
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
          v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_section -> 'id', 'type', 'brand_logos',
            'title', v_props -> 'title', 'brands', v_items));
        end if;
      when 'testimonials', 'rich_text' then
        v_out := v_out || jsonb_build_array(v_props || jsonb_build_object('id', v_section -> 'id',
                                                                          'type', v_section -> 'type'));
      else
        null;
    end case;
  end loop;
  return v_out;
end
$$;

-- Plantilla del tema (sin secciones): la usan la tienda y la vista previa.
create or replace function app.home_template(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'sections', null,
           'featured', storefront.list_products(p_store_id, null, null, null, 'newest', null, null, false, null, 8)
                       -> 'items',
           'categories', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'path', c.path,
                           'image', (select jsonb_build_object('path', m.storage_path, 'width', m.width,
                                                               'height', m.height, 'alt', m.alt_text)
                                       from public.media m where m.store_id = c.store_id and m.id = c.image_media_id
                                        and m.status = 'ready' and m.deleted_at is null)) order by c.position, c.name)
                          from public.categories c
                         where c.store_id = p_store_id and c.parent_id is null and c.deleted_at is null
                           and c.is_visible), '[]'::jsonb))
$$;

create or replace function storefront.get_home(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not app.store_publicly_readable(p_store_id) then null else
    case when jsonb_array_length(coalesce(t.home_sections, '[]'::jsonb)) > 0
         then jsonb_build_object('sections', app.home_resolve(p_store_id, t.home_sections))
         else app.home_template(p_store_id)
    end end
    from (select (select st.home_sections from public.store_themes st where st.store_id = p_store_id) as home_sections) t
$$;

-- Vista previa: con borrador, exactamente lo que se publicaría (un borrador
-- vacío es la plantilla, no lo publicado); sin borrador, lo publicado.
create or replace function storefront.get_home_preview(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when jsonb_array_length(coalesce(t.sections, '[]'::jsonb)) > 0
      then jsonb_build_object('sections', app.home_resolve(p_store_id, t.sections))
    else app.home_template(p_store_id)
  end
  from (select (select coalesce(st.draft_home_sections, st.home_sections) from public.store_themes st
                 where st.store_id = p_store_id) as sections) t
$$;

-- -----------------------------------------------------------------------------
-- Revisión de diseño y conversión (Gate F9): porciones en las tarjetas
-- (precio por porción), precio y días del envío estándar en la ficha, y la
-- portada sin agotados en sus secciones de productos (arriba, p_available).
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
  p_brands        text[] default null
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
           p.slug, p.title, b.name as brand, p.min_price, p.max_price, p.published_at,
           (select min(v.compare_at_price) from public.product_variants v
             where v.product_id = p.id and v.status = 'active' and v.deleted_at is null
               and v.price = p.min_price) as compare_at
      from app.listing_products(p_store_id, p_category_path, p_brand_slug, v_q, p_min_price, p_max_price) l
      join public.products p on p.store_id = p_store_id and p.id = l.product_id
      left join public.brands b on b.store_id = p.store_id and b.id = p.brand_id and b.deleted_at is null
     where (v_groups = 0 or app.product_attribute_groups(p_store_id, p.id, v_values) = v_groups)
       and (v_brands is null or b.slug = any (v_brands))
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
           'servings', (select case when jsonb_typeof(i.data -> 'servings_per_container') = 'number'
                                 then (i.data ->> 'servings_per_container')::integer end
                       from public.product_regulatory_info i where i.store_id = p_store_id and i.product_id = x.id),
           'image', app.product_cover(p_store_id, x.id)) order by x.rn) filter (where x.rn <= v_limit), '[]'::jsonb),
         count(*) > v_limit,
         (array_agg(jsonb_build_object('k', x.k, 'id', x.id) order by x.rn))[v_limit]
    into v_items, v_more, v_next
    from page x;

  return jsonb_build_object('items', v_items, 'sort', v_sort, 'next_cursor', case when v_more then v_next end);
end
$$;

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
           'servings', (select case when jsonb_typeof(i.data -> 'servings_per_container') = 'number'
                                 then (i.data ->> 'servings_per_container')::integer end
                       from public.product_regulatory_info i where i.store_id = p_store_id and i.product_id = x.id),
           'image', app.product_cover(p_store_id, x.id))
           order by x.shared desc, x.same_category desc, x.sales_count desc, x.published_at desc, x.id desc),
         '[]'::jsonb)
    from picked x
$$;

create or replace function storefront.shipping_promo(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('free_over', x.free_over_subtotal, 'conditional', x.conditional,
                            'price', x.price, 'est_days_min', x.est_days_min, 'est_days_max', x.est_days_max)
    from (select r.free_over_subtotal, r.price, r.est_days_min, r.est_days_max,
                 (z.regions is not null or r.min_weight_g is not null or r.max_weight_g is not null) as conditional
            from public.stores s
            join public.shipping_zones z on z.store_id = s.id and s.country::text = any (z.countries)
            join public.shipping_rates r on r.store_id = z.store_id and r.zone_id = z.id
           where s.id = p_store_id and r.is_active and r.type = 'free_over'
             and app.store_publicly_readable(p_store_id)
           order by r.free_over_subtotal, 5, r.id
           limit 1) x
$$;

revoke all on function app.home_template(uuid) from public;
