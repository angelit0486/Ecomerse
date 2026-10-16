-- =============================================================================
-- Revisión de conversión (M9) — la portada no repite productos entre secciones
--
-- Cada sección de productos omite los que ya mostró una sección anterior y se
-- completa con los siguientes (se piden de más, con el tope de 48 por portada).
-- Misma función que 20261017000600 con esa regla; firma y permisos sin cambios.
-- =============================================================================

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
  -- Productos ya mostrados en secciones anteriores (revisión de conversión, M9).
  v_seen    uuid[] := '{}';
  v_limit   integer;
  v_fetch   integer;
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
        v_items := (select coalesce(jsonb_agg(i.e order by i.n), '[]'::jsonb)
                      from (select e, n from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) with ordinality x(e, n)
                             where not ((e ->> 'id')::uuid = any (v_seen))
                             order by n limit v_limit) i);
        v_seen := v_seen || array(select (e ->> 'id')::uuid from jsonb_array_elements(v_items) e);
        if v_source is not null and jsonb_array_length(v_items) > 0 then
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
