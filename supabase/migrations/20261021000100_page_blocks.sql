-- =============================================================================
-- ADR-034 §3 · Páginas armadas con bloques (los mismos de la portada, mismas
-- validaciones), con borrador y publicación, e imagen social por página.
--
-- - `sections` es lo publicado y `draft_sections` el borrador. Las políticas
--   siguen con su HTML seguro (no llevan bloques).
-- - La tienda solo muestra lo publicado. En la vista previa de ESA tienda
--   (`pruva.preview_store`, ADR-032) muestra el borrador y las páginas sin
--   publicar.
-- - Publicar revalida referencias y términos prohibidos, igual que la portada.
-- =============================================================================

alter table public.store_pages
  add column sections jsonb not null default '[]'::jsonb check (app.home_sections_valid(sections)),
  add column draft_sections jsonb check (draft_sections is null or app.home_sections_valid(draft_sections)),
  add column seo_image_media_id uuid,
  add constraint store_pages_seo_image_fk foreign key (store_id, seo_image_media_id)
    references public.media (store_id, id) on delete set null (seo_image_media_id),
  add constraint store_pages_blocks_only_content
    check (type = 'content' or (sections = '[]'::jsonb and draft_sections is null));

-- Contenido visible: texto (sin etiquetas) o al menos un bloque publicado.
create or replace function app.page_has_content(p_body_html text, p_sections jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select char_length(btrim(regexp_replace(coalesce(p_body_html, ''), '<[^>]*>', '', 'g'))) > 0
      or jsonb_array_length(coalesce(p_sections, '[]'::jsonb)) > 0
$$;

-- -----------------------------------------------------------------------------
-- Alta y edición (20261012000500 + imagen social y la regla con bloques).
-- -----------------------------------------------------------------------------
create or replace function public.content_upsert_page(p_store_id uuid, p_page jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_old   public.store_pages;
  v_title text := btrim(coalesce(p_page ->> 'title', ''));
  v_slug  text;
  v_image uuid;
begin
  perform app.require_store_permission(p_store_id, 'content.manage');
  if jsonb_typeof(p_page) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'page';
  end if;
  begin
    v_id := nullif(p_page ->> 'id', '')::uuid;
    v_image := nullif(p_page ->> 'seo_image_media_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'page';
  end;
  if char_length(v_title) not between 1 and 120 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'title';
  end if;
  if octet_length(coalesce(p_page ->> 'body_html', '')) > 102400 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'body_html';
  end if;
  if v_image is not null and not app.theme_media_ok(p_store_id, v_image, array['banner', 'store_branding']) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'seo_image_media_id';
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
  -- Una página publicada no se queda sin contenido (ni texto ni bloques).
  if v_old.is_published and not app.page_has_content(p_page ->> 'body_html', v_old.sections) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'body_html';
  end if;
  -- Sin redirecciones 301, la dirección de una página publicada no cambia.
  if v_old.is_published and v_slug <> v_old.slug then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'slug_published';
  end if;

  begin
    if v_id is null then
      insert into public.store_pages (store_id, type, slug, title, body_html, seo_title, seo_description,
                                      seo_image_media_id)
      values (p_store_id, 'content', v_slug, v_title, coalesce(p_page ->> 'body_html', ''),
              nullif(btrim(p_page ->> 'seo_title'), ''), nullif(btrim(p_page ->> 'seo_description'), ''),
              v_image)
      returning id into v_id;
    else
      update public.store_pages
         set title = v_title, slug = v_slug, body_html = coalesce(p_page ->> 'body_html', ''),
             seo_title = nullif(btrim(p_page ->> 'seo_title'), ''),
             seo_description = nullif(btrim(p_page ->> 'seo_description'), ''),
             -- Sin la clave se conserva (los formularios viejos no la mandan).
             seo_image_media_id = case when p_page ? 'seo_image_media_id' then v_image
                                       else seo_image_media_id end
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

-- Publicar o retirar (20261012000400 con la regla «texto o bloques»).
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
  if coalesce(p_published, false) and not app.page_has_content(v.body_html, v.sections) then
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

-- -----------------------------------------------------------------------------
-- Bloques de una página: guardar en el borrador, publicar y descartar.
-- -----------------------------------------------------------------------------
create or replace function app.page_for_blocks(p_store_id uuid, p_page_id uuid)
returns public.store_pages
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
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'policy_blocks';
  end if;
  return v;
end
$$;

create or replace function public.content_save_page_blocks(p_store_id uuid, p_page_id uuid, p_sections jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v        public.store_pages := app.page_for_blocks(p_store_id, p_page_id);
  v_issues text[];
begin
  if not app.home_sections_valid(p_sections) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'sections';
  end if;
  if exists (select 1 from jsonb_array_elements(p_sections) s
              where s ->> 'type' = 'rich_text'
                and (s #>> '{props,html}') ~* '<\s*(script|style|iframe|object|embed)|\son[a-z]+\s*=|javascript:') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'html';
  end if;
  v_issues := app.theme_reference_issues(p_store_id, null, p_sections);
  if cardinality(v_issues) > 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'references',
      hint = array_to_string(v_issues, ',');
  end if;
  update public.store_pages set draft_sections = p_sections where id = v.id;
  perform audit.record('page.blocks_draft_saved', 'store_page', v.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('sections', coalesce(v.draft_sections, v.sections)),
                       jsonb_build_object('sections', p_sections));
end
$$;

create or replace function public.content_publish_page_blocks(p_store_id uuid, p_page_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v        public.store_pages := app.page_for_blocks(p_store_id, p_page_id);
  v_issues text[];
begin
  if v.draft_sections is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'no_draft';
  end if;
  v_issues := app.theme_reference_issues(p_store_id, null, v.draft_sections);
  if cardinality(v_issues) > 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'references',
      hint = array_to_string(v_issues, ',');
  end if;
  v_issues := app.home_compliance_issues(p_store_id, v.draft_sections);
  if cardinality(v_issues) > 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'compliance',
      hint = array_to_string(v_issues, ',');
  end if;
  -- Una página publicada no se queda vacía al publicar sus bloques.
  if v.is_published and not app.page_has_content(v.body_html, v.draft_sections) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'body_html';
  end if;
  update public.store_pages set sections = v.draft_sections, draft_sections = null where id = v.id;
  perform audit.record('page.blocks_published', 'store_page', v.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('sections', v.sections), jsonb_build_object('sections', v.draft_sections));
end
$$;

create or replace function public.content_discard_page_blocks(p_store_id uuid, p_page_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.store_pages := app.page_for_blocks(p_store_id, p_page_id);
begin
  update public.store_pages set draft_sections = null where id = v.id;
end
$$;

-- -----------------------------------------------------------------------------
-- Tienda: la página con sus bloques resueltos e imagen social. En la vista
-- previa de esta tienda, el borrador y las páginas sin publicar (ADR-032).
-- -----------------------------------------------------------------------------
create or replace function storefront.get_page(p_store_id uuid, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', sp.id, 'slug', sp.slug, 'type', sp.type, 'title', sp.title,
                            'body_html', sp.body_html, 'seo_title', sp.seo_title,
                            'seo_description', sp.seo_description, 'updated_at', sp.updated_at,
                            'unpublished', not sp.is_published,
                            'sections', app.home_resolve(p_store_id,
                                          case when x.preview then coalesce(sp.draft_sections, sp.sections)
                                               else sp.sections end),
                            'seo_image', (select jsonb_build_object('path', m.storage_path, 'width', m.width,
                                                                    'height', m.height, 'alt', m.alt_text)
                                            from public.media m
                                           where m.store_id = sp.store_id and m.id = sp.seo_image_media_id
                                             and m.status = 'ready' and m.deleted_at is null))
    from public.store_pages sp
    cross join (select current_setting('pruva.preview_store', true) = p_store_id::text as preview) x
   where sp.store_id = p_store_id and sp.slug = p_slug and sp.deleted_at is null
     and (sp.is_published or x.preview)
     and app.store_publicly_readable(p_store_id)
$$;

revoke all on function app.page_has_content(text, jsonb) from public;
revoke all on function app.page_for_blocks(uuid, uuid) from public;
revoke all on function public.content_upsert_page(uuid, jsonb) from public;
revoke all on function public.content_set_page_published(uuid, uuid, boolean) from public;
revoke all on function public.content_save_page_blocks(uuid, uuid, jsonb) from public;
revoke all on function public.content_publish_page_blocks(uuid, uuid) from public;
revoke all on function public.content_discard_page_blocks(uuid, uuid) from public;
grant execute on function public.content_upsert_page(uuid, jsonb) to authenticated;
grant execute on function public.content_set_page_published(uuid, uuid, boolean) to authenticated;
grant execute on function public.content_save_page_blocks(uuid, uuid, jsonb) to authenticated;
grant execute on function public.content_publish_page_blocks(uuid, uuid) to authenticated;
grant execute on function public.content_discard_page_blocks(uuid, uuid) to authenticated;
revoke all on function storefront.get_page(uuid, text) from public;
grant execute on function storefront.get_page(uuid, text) to storefront_gateway;
