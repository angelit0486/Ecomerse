-- =============================================================================
-- Fase 5 · Editor de páginas y menús (F5-T06)
-- Permisos (GATE0 matriz §8): páginas content.manage; menús appearance.manage.
-- El HTML llega sanitizado por el servidor (SafeHtml lo vuelve a sanitizar al
-- renderizar). Los destinos de los menús se verifican en la MISMA tienda.
-- =============================================================================

create or replace function public.content_upsert_page(p_store_id uuid, p_page jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid := nullif(p_page ->> 'id', '')::uuid;
  v_old   public.store_pages;
  v_title text := btrim(coalesce(p_page ->> 'title', ''));
  v_slug  text;
begin
  perform app.require_store_permission(p_store_id, 'content.manage');
  if jsonb_typeof(p_page) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'page';
  end if;
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

create or replace function public.content_set_page_published(p_store_id uuid, p_page_id uuid, p_published boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.store_pages;
begin
  perform app.require_store_permission(p_store_id, 'content.manage');
  select * into v from public.store_pages sp
   where sp.id = p_page_id and sp.store_id = p_store_id and sp.deleted_at is null for update;
  if v.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'page';
  end if;
  if coalesce(p_published, false) and char_length(btrim(regexp_replace(v.body_html, '<[^>]*>', '', 'g'))) = 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'body_html';
  end if;
  update public.store_pages
     set is_published = coalesce(p_published, false),
         published_at = case when coalesce(p_published, false) then coalesce(published_at, now()) else published_at end
   where id = v.id;
  perform audit.record(case when p_published then 'page.published' else 'page.unpublished' end, 'store_page', v.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, null);
end
$$;

-- Solo páginas de contenido; las políticas se despublican, no se borran.
create or replace function public.content_delete_page(p_store_id uuid, p_page_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.store_pages;
begin
  perform app.require_store_permission(p_store_id, 'content.manage');
  select * into v from public.store_pages sp
   where sp.id = p_page_id and sp.store_id = p_store_id and sp.deleted_at is null for update;
  if v.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'page';
  end if;
  if v.type <> 'content' then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'policy_page';
  end if;
  update public.store_pages set is_published = false, deleted_at = now() where id = v.id;
  perform audit.record('page.deleted', 'store_page', v.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('title', v.title, 'slug', v.slug), null);
end
$$;

-- -----------------------------------------------------------------------------
-- Menú completo (reemplaza los ítems). p_items: [{label, link_type, target_id?,
-- url?, children?: [...]}], máximo 2 niveles y 50 ítems.
-- -----------------------------------------------------------------------------
create or replace function app.menu_target_valid(p_store_id uuid, p_link_type text, p_target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_link_type
    when 'category' then exists (select 1 from public.categories c
                                  where c.store_id = p_store_id and c.id = p_target_id and c.deleted_at is null)
    when 'brand' then exists (select 1 from public.brands b
                               where b.store_id = p_store_id and b.id = p_target_id and b.deleted_at is null)
    when 'product' then exists (select 1 from public.products p
                                 where p.store_id = p_store_id and p.id = p_target_id and p.deleted_at is null)
    when 'page' then exists (select 1 from public.store_pages sp
                              where sp.store_id = p_store_id and sp.id = p_target_id and sp.deleted_at is null)
    else p_target_id is null
  end
$$;
revoke all on function app.menu_target_valid(uuid, text, uuid) from public;

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

revoke all on function public.content_upsert_page(uuid, jsonb) from public;
revoke all on function public.content_set_page_published(uuid, uuid, boolean) from public;
revoke all on function public.content_delete_page(uuid, uuid) from public;
revoke all on function public.menu_set_items(uuid, text, jsonb) from public;
grant execute on function public.content_upsert_page(uuid, jsonb) to authenticated;
grant execute on function public.content_set_page_published(uuid, uuid, boolean) to authenticated;
grant execute on function public.content_delete_page(uuid, uuid) to authenticated;
grant execute on function public.menu_set_items(uuid, text, jsonb) to authenticated;
