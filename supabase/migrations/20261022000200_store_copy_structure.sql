-- =============================================================================
-- Pulido · Copiar la estructura de otra tienda de la MISMA organización
-- (D-PUL-02): categorías, páginas de contenido, políticas y menús. Sirve para
-- abrir una segunda tienda del mismo giro sin rehacerla a mano.
--
-- Reglas:
-- - Nunca borra ni pisa: lo que ya existe en el destino (por slug o por ruta) se
--   respeta; una segunda copia no agrega nada.
-- - Nada apunta a la tienda de origen (GATE0 §44.2): sin imágenes; de los
--   bloques de una página solo pasan los que no referencian productos, fotos,
--   categorías ni marcas; el menú reasigna categorías por ruta y páginas por
--   slug, y omite productos, marcas y colecciones.
-- - Páginas y políticas llegan en borrador. Una política solo se copia si en el
--   destino sigue con la plantilla y si en el origen está publicada y completa
--   (misma regla que el lanzamiento).
-- - Permisos por parte en el destino: categories.manage, content.manage (páginas
--   y políticas) y appearance.manage (menús); en el origen, store.read.
-- =============================================================================

create or replace function public.store_copy_structure(
  p_store_id        uuid,
  p_source_store_id uuid,
  p_parts           text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parts      text[] := coalesce(p_parts, '{}');
  v_org        uuid;
  v_map        jsonb := '{}';
  v_item_map   jsonb := '{}';
  v_parent     uuid;
  v_new        uuid;
  v_target     uuid;
  v_menu_dst   uuid;
  v_categories integer := 0;
  v_pages      integer := 0;
  v_policies   integer := 0;
  v_items      integer := 0;
  v_skipped    integer := 0;
  r            record;
  m            record;
begin
  if p_store_id is null or p_source_store_id is null or p_store_id = p_source_store_id then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'source';
  end if;
  if cardinality(v_parts) = 0
     or not (v_parts <@ array['categories', 'pages', 'policies', 'menus']) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'parts';
  end if;

  select t.organization_id into v_org
    from public.stores t join public.stores s on s.organization_id = t.organization_id
   where t.id = p_store_id and s.id = p_source_store_id;
  if v_org is null then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  perform app.require_store_permission(p_source_store_id, 'store.read');
  if 'categories' = any (v_parts) then
    perform app.require_store_permission(p_store_id, 'categories.manage');
  end if;
  if 'pages' = any (v_parts) or 'policies' = any (v_parts) then
    perform app.require_store_permission(p_store_id, 'content.manage');
  end if;
  if 'menus' = any (v_parts) then
    perform app.require_store_permission(p_store_id, 'appearance.manage');
  end if;

  -- Categorías por niveles: el padre ya está en el mapa cuando llega el hijo.
  if 'categories' = any (v_parts) then
    for r in
      select c.id, c.parent_id, c.name, c.slug, c.position, c.is_visible, c.description, c.seo_title,
             c.seo_description
        from public.categories c
       where c.store_id = p_source_store_id and c.deleted_at is null
       order by c.depth, c.position, c.name
    loop
      v_parent := case when r.parent_id is null then null else (v_map ->> r.parent_id::text)::uuid end;
      if r.parent_id is not null and v_parent is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      v_new := null;
      select c.id into v_new from public.categories c
       where c.store_id = p_store_id and c.deleted_at is null
         and c.parent_id is not distinct from v_parent and c.slug = r.slug;
      if v_new is null then
        insert into public.categories (store_id, parent_id, name, slug, position, is_visible, description,
                                       seo_title, seo_description)
        values (p_store_id, v_parent, r.name, r.slug, r.position, r.is_visible, r.description, r.seo_title,
                r.seo_description)
        returning id into v_new;
        v_categories := v_categories + 1;
      end if;
      v_map := v_map || jsonb_build_object(r.id::text, v_new::text);
    end loop;
  end if;

  -- Páginas de contenido, en borrador y solo con bloques sin referencias.
  if 'pages' = any (v_parts) then
    for r in
      select p.slug, p.title, p.body_html, p.seo_title, p.seo_description,
             coalesce(p.draft_sections, p.sections) as sections
        from public.store_pages p
       where p.store_id = p_source_store_id and p.type = 'content' and p.deleted_at is null
         and not exists (select 1 from public.store_pages d
                          where d.store_id = p_store_id and d.slug = p.slug and d.deleted_at is null)
       order by p.title
    loop
      insert into public.store_pages (store_id, type, slug, title, body_html, seo_title, seo_description,
                                      draft_sections)
      values (p_store_id, 'content', r.slug, r.title, r.body_html, r.seo_title, r.seo_description,
              (select nullif(coalesce(jsonb_agg(s order by o), '[]'::jsonb), '[]'::jsonb)
                 from jsonb_array_elements(r.sections) with ordinality as e(s, o)
                where s ->> 'type' in ('rich_text', 'faq', 'benefits', 'contact_map', 'video')));
      v_pages := v_pages + 1;
    end loop;
  end if;

  -- Políticas: el texto completo y publicado del origen sustituye la plantilla.
  if 'policies' = any (v_parts) then
    for r in
      select src.type, src.title, src.body_html
        from public.store_pages src
       where src.store_id = p_source_store_id and src.type like 'policy\_%' and src.deleted_at is null
         and src.is_published and btrim(src.body_html) <> ''
         and position('Plantilla en borrador' in src.body_html) = 0
         and src.body_html !~ '<p>\s*\[[^]<]*\]\s*</p>'
    loop
      update public.store_pages d
         set title = r.title, body_html = r.body_html
       where d.store_id = p_store_id and d.type = r.type and d.deleted_at is null and not d.is_published
         and (btrim(d.body_html) = '' or position('Plantilla en borrador' in d.body_html) > 0);
      if found then
        v_policies := v_policies + 1;
      end if;
    end loop;
  end if;

  -- Menús: solo si el del destino está vacío; dos niveles (raíces y luego hijos).
  if 'menus' = any (v_parts) then
    for m in
      select src.id as src_id, src.handle
        from public.menus src where src.store_id = p_source_store_id
    loop
      select d.id into v_menu_dst from public.menus d where d.store_id = p_store_id and d.handle = m.handle;
      if v_menu_dst is null
         or exists (select 1 from public.menu_items mi where mi.menu_id = v_menu_dst) then
        continue;
      end if;
      v_item_map := '{}';
      for r in
        select mi.id, mi.parent_id, mi.label, mi.link_type, mi.target_id, mi.url, mi.position
          from public.menu_items mi
         where mi.menu_id = m.src_id
         order by (mi.parent_id is not null), mi.position
      loop
        v_parent := case when r.parent_id is null then null else (v_item_map ->> r.parent_id::text)::uuid end;
        if r.parent_id is not null and v_parent is null then
          v_skipped := v_skipped + 1;
          continue;
        end if;
        v_target := null;
        if r.link_type = 'category' then
          select dc.id into v_target
            from public.categories sc
            join public.categories dc on dc.store_id = p_store_id and dc.path = sc.path and dc.deleted_at is null
           where sc.store_id = p_source_store_id and sc.id = r.target_id;
        elsif r.link_type = 'page' then
          select dp.id into v_target
            from public.store_pages sp
            join public.store_pages dp on dp.store_id = p_store_id and dp.slug = sp.slug and dp.deleted_at is null
           where sp.store_id = p_source_store_id and sp.id = r.target_id;
        end if;
        if r.link_type in ('product', 'brand', 'collection')
           or (r.link_type in ('category', 'page') and v_target is null) then
          v_skipped := v_skipped + 1;
          continue;
        end if;
        insert into public.menu_items (store_id, menu_id, parent_id, label, link_type, target_id, url, position)
        values (p_store_id, v_menu_dst, v_parent, r.label, r.link_type, v_target, r.url, r.position)
        returning id into v_new;
        v_item_map := v_item_map || jsonb_build_object(r.id::text, v_new::text);
        v_items := v_items + 1;
      end loop;
    end loop;
  end if;

  perform audit.record('store.structure_copied', 'store', p_store_id, v_org, p_store_id, null,
                       jsonb_build_object('source_store_id', p_source_store_id, 'parts', to_jsonb(v_parts),
                                          'categories', v_categories, 'pages', v_pages,
                                          'policies', v_policies, 'menu_items', v_items));

  return jsonb_build_object('categories', v_categories, 'pages', v_pages, 'policies', v_policies,
                            'menu_items', v_items, 'skipped', v_skipped);
end
$$;

revoke all on function public.store_copy_structure(uuid, uuid, text[]) from public;
grant execute on function public.store_copy_structure(uuid, uuid, text[]) to authenticated;
