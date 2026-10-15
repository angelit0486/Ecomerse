-- =============================================================================
-- Fase 9 · F9-T02 — Secciones de la portada en la tienda pública y en la vista
-- previa (GATE0 §20.2, F9-DESIGN §3, §13 M1, M3, M4).
--
-- `app.home_resolve` convierte las secciones (publicadas o del borrador) en lo
-- que se muestra: solo las habilitadas, con sus imágenes, categorías, marcas y
-- productos resueltos. Una sección cuya referencia ya no existe o no es visible
-- se omite: nunca se muestra rota. Sin secciones publicadas, la plantilla del
-- tema (§20.2): productos recientes y categorías raíz.
-- =============================================================================

create or replace function app.home_media_json(p_store_id uuid, p_media_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height, 'alt', m.alt_text)
    from public.media m
   where m.store_id = p_store_id and m.id::text = p_media_id
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
          v_items := storefront.list_products(p_store_id, null, null, null, 'newest', null, null, false, null,
                                              (v_props ->> 'limit')::integer) -> 'items';
          v_source := jsonb_build_object('type', 'newest');
        elsif v_src ->> 'type' = 'best_selling' then
          v_items := storefront.list_products(p_store_id, null, null, null, 'best_selling', null, null, false, null,
                                              (v_props ->> 'limit')::integer) -> 'items';
          v_source := jsonb_build_object('type', 'best_selling');
        elsif v_src ->> 'type' = 'category' then
          select c.path into v_cat from public.categories c
           where c.store_id = p_store_id and c.id = (v_src ->> 'id')::uuid and c.is_visible and c.deleted_at is null;
          if found then
            v_items := storefront.list_products(p_store_id, v_cat.path, null, null, 'newest', null, null, false, null,
                                                (v_props ->> 'limit')::integer) -> 'items';
            v_source := jsonb_build_object('type', 'category', 'path', v_cat.path);
          end if;
        elsif v_src ->> 'type' = 'brand' then
          select b.slug into v_brand from public.brands b
           where b.store_id = p_store_id and b.id = (v_src ->> 'id')::uuid and b.deleted_at is null;
          if found then
            v_items := storefront.list_products(p_store_id, null, v_brand.slug, null, 'newest', null, null, false, null,
                                                (v_props ->> 'limit')::integer) -> 'items';
            v_source := jsonb_build_object('type', 'brand', 'slug', v_brand.slug);
          end if;
        elsif v_src ->> 'type' = 'attribute_value' then
          select a.key as attribute_key, av.key as value_key into v_value
            from public.attribute_values av
            join public.attributes a on a.store_id = av.store_id and a.id = av.attribute_id
           where av.store_id = p_store_id and av.id = (v_src ->> 'id')::uuid and a.is_filterable;
          if found then
            v_items := storefront.list_products(p_store_id, null, null, null, 'newest', null, null, false, null,
                                                (v_props ->> 'limit')::integer,
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
                                     then array_position(array(select jsonb_array_elements_text(v_props -> 'category_ids')),
                                                         c.id::text) end,
                                c.position, c.name), '[]'::jsonb)
                      from public.categories c
                     where c.store_id = p_store_id and c.deleted_at is null and c.is_visible
                       and case when v_props ? 'category_ids'
                                then c.id::text in (select jsonb_array_elements_text(v_props -> 'category_ids'))
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
                       order by array_position(array(select jsonb_array_elements_text(v_props -> 'brand_ids')),
                                               b.id::text)), '[]'::jsonb)
                      from public.brands b
                      join public.media m on m.store_id = b.store_id and m.id = b.logo_media_id
                                         and m.status = 'ready' and m.deleted_at is null
                     where b.store_id = p_store_id and b.deleted_at is null
                       and b.id::text in (select jsonb_array_elements_text(v_props -> 'brand_ids')));
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

-- Portada pública: secciones publicadas o, sin ellas, la plantilla del tema.
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
         else jsonb_build_object(
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
    end end
    from (select (select st.home_sections from public.store_themes st where st.store_id = p_store_id) as home_sections) t
$$;

-- Vista previa del borrador (D-F9-02): misma forma, con las secciones del borrador.
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
    else storefront.get_home(p_store_id)
  end
  from (select (select coalesce(st.draft_home_sections, st.home_sections) from public.store_themes st
                 where st.store_id = p_store_id) as sections) t
$$;

-- -----------------------------------------------------------------------------
-- Revisión de cumplimiento de la portada publicada (§13 M1): tras un cambio de
-- reglas o al declarar una categoría, una sección con un término prohibido se
-- oculta (enabled = false) con auditoría. Devuelve las tiendas cambiadas.
-- -----------------------------------------------------------------------------
create or replace function system.compliance_recheck_home(p_profile_id uuid, p_store_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store   record;
  v_issues  text[];
  v_hidden  text[];
  v_changed uuid[] := '{}';
begin
  if (p_profile_id is null) = (p_store_id is null) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'scope';
  end if;
  for v_store in
    select t.store_id, t.home_sections, s.organization_id
      from public.store_themes t
      join public.stores s on s.id = t.store_id
     where jsonb_array_length(t.home_sections) > 0
       and (p_store_id is null or t.store_id = p_store_id)
       and (p_profile_id is null or exists (
             select 1 from public.compliance_profiles cp
               join public.store_regulated_categories d on d.category_key = cp.category_key
              where cp.id = p_profile_id and d.store_id = t.store_id and cp.country = s.country::text))
       for update of t
  loop
    v_issues := app.home_compliance_issues(v_store.store_id, v_store.home_sections);
    if cardinality(v_issues) > 0 then
      select array_agg(distinct split_part(i, '@', 2)) into v_hidden from unnest(v_issues) i;
      update public.store_themes t
         set home_sections = (select jsonb_agg(case when (e ->> 'id') = any (v_hidden)
                                                    then jsonb_set(e, '{enabled}', 'false'::jsonb) else e end
                                               order by o)
                                from jsonb_array_elements(t.home_sections) with ordinality x(e, o))
       where t.store_id = v_store.store_id;
      perform audit.record('theme.home_sections_hidden', 'store_theme', v_store.store_id,
                           v_store.organization_id, v_store.store_id,
                           jsonb_build_object('home_sections', v_store.home_sections), null, 'compliance',
                           jsonb_build_object('codes', to_jsonb(v_issues)));
      v_changed := v_changed || v_store.store_id;
    end if;
  end loop;
  return v_changed;
end
$$;

revoke all on function app.home_media_json(uuid, text) from public;
revoke all on function app.home_resolve(uuid, jsonb) from public;
revoke all on function storefront.get_home_preview(uuid) from public;
revoke all on function system.compliance_recheck_home(uuid, uuid) from public;
grant execute on function storefront.get_home_preview(uuid) to storefront_gateway;
grant execute on function system.compliance_recheck_home(uuid, uuid) to system_worker;
