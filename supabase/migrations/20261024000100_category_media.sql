-- =============================================================================
-- Fotos de categorías (misión Panel, Paso A). La columna `image_media_id`
-- (cuadrada: círculos y tarjetas) ya existía y la aceptaba
-- `catalog_upsert_category`; faltaban el banner ancho de la página de la
-- categoría, una forma de asignar o quitar cada imagen sin reenviar toda la
-- categoría y las miniaturas para el menú y la barra de categorías.
--
-- Las imágenes son medios de la MISMA tienda con `owner_type = 'category'` (el
-- pipeline de siempre: Storage, re-codificación sin EXIF, SVG rechazado,
-- purga). FK compuestas `(store_id, …)` (GATE0 §44 regla 2).
-- =============================================================================

alter table public.categories add column cover_media_id uuid;

alter table public.categories
  add constraint categories_cover_fk foreign key (store_id, cover_media_id)
  references public.media (store_id, id) on delete set null (cover_media_id);

-- -----------------------------------------------------------------------------
-- Imagen («image», cuadrada) o banner («cover») de una categoría; null la quita.
-- La imagen anterior se borra (soft) si nadie más la usa: sin huérfanos que
-- cuenten en la cuota (la purga la quita a los 7 días).
-- -----------------------------------------------------------------------------
create or replace function public.catalog_set_category_media(p_store_id uuid, p_category_id uuid, p_kind text,
                                                             p_media_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before uuid;
  v_other  uuid;
begin
  perform app.require_store_permission(p_store_id, 'categories.manage');
  if p_kind is null or p_kind not in ('image', 'cover') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'kind';
  end if;
  select case when p_kind = 'image' then c.image_media_id else c.cover_media_id end,
         case when p_kind = 'image' then c.cover_media_id else c.image_media_id end
    into v_before, v_other
    from public.categories c
   where c.store_id = p_store_id and c.id = p_category_id and c.deleted_at is null
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'category';
  end if;
  if p_media_id is not null and not exists (
       select 1 from public.media m
        where m.store_id = p_store_id and m.id = p_media_id and m.owner_type = 'category'
          and m.deleted_at is null and m.status <> 'rejected') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'media';
  end if;
  if p_kind = 'image' then
    update public.categories set image_media_id = p_media_id where store_id = p_store_id and id = p_category_id;
  else
    update public.categories set cover_media_id = p_media_id where store_id = p_store_id and id = p_category_id;
  end if;
  if v_before is not null and v_before is distinct from p_media_id and v_before is distinct from v_other
     and not exists (select 1 from public.categories c
                      where c.store_id = p_store_id
                        and (c.image_media_id = v_before or c.cover_media_id = v_before)) then
    update public.media set deleted_at = now()
     where store_id = p_store_id and id = v_before and owner_type = 'category' and deleted_at is null;
  end if;
  perform audit.record('category.media_set', 'category', p_category_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object(p_kind, v_before), jsonb_build_object(p_kind, p_media_id));
end
$$;

revoke all on function public.catalog_set_category_media(uuid, uuid, text, uuid) from public;
grant execute on function public.catalog_set_category_media(uuid, uuid, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Borrar un medio también lo quita del banner de la categoría y de la portada
-- de la marca (revisión del Paso 2, B10).
-- -----------------------------------------------------------------------------
create or replace function public.media_delete(p_store_id uuid, p_media_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.media;
begin
  v := app.lock_media(p_store_id, p_media_id);
  update public.product_variants set image_id = null where store_id = p_store_id and image_id = v.id;
  update public.brands set logo_media_id = null where store_id = p_store_id and logo_media_id = v.id;
  update public.brands set cover_media_id = null where store_id = p_store_id and cover_media_id = v.id;
  update public.categories set image_media_id = null where store_id = p_store_id and image_media_id = v.id;
  update public.categories set cover_media_id = null where store_id = p_store_id and cover_media_id = v.id;
  update public.store_themes
     set logo_media_id = case when logo_media_id = v.id then null else logo_media_id end,
         draft_logo_media_id = case when draft_logo_media_id = v.id then null else draft_logo_media_id end
   where store_id = p_store_id and (logo_media_id = v.id or draft_logo_media_id = v.id);
  update public.media set deleted_at = now() where id = v.id;
  perform audit.record('media.deleted', 'media', v.id, null, p_store_id,
                       jsonb_build_object('owner_type', v.owner_type, 'product_id', v.product_id), null);
end
$$;

-- -----------------------------------------------------------------------------
-- Tienda: la página de la categoría trae también su banner.
-- -----------------------------------------------------------------------------
create or replace function storefront.get_category(p_store_id uuid, p_path text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'path', c.path, 'description', c.description,
    'seo_title', c.seo_title, 'seo_description', c.seo_description, 'updated_at', c.updated_at,
    'image', (select jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height, 'alt', m.alt_text)
                from public.media m where m.store_id = c.store_id and m.id = c.image_media_id
                 and m.status = 'ready' and m.deleted_at is null),
    'cover', (select jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height, 'alt', m.alt_text)
                from public.media m where m.store_id = c.store_id and m.id = c.cover_media_id
                 and m.status = 'ready' and m.deleted_at is null),
    'children', coalesce((select jsonb_agg(jsonb_build_object('name', ch.name, 'path', ch.path)
                                           order by ch.position, ch.name)
                 from public.categories ch
                where ch.store_id = c.store_id and ch.parent_id = c.id and ch.deleted_at is null and ch.is_visible),
               '[]'::jsonb),
    'breadcrumb', coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'path', a.path) order by a.depth)
                   from public.categories a
                  where a.store_id = c.store_id and a.deleted_at is null and a.is_visible
                    and (c.path = a.path or c.path like a.path || '/%')), '[]'::jsonb)
  )
    from public.categories c
   where c.store_id = p_store_id and c.path = p_path and c.deleted_at is null and c.is_visible
     and app.category_public(c.store_id, c.id)
     and app.store_publicly_readable(p_store_id)
$$;

-- -----------------------------------------------------------------------------
-- Miniaturas para el menú y la barra de categorías: ruta → imagen cuadrada de
-- las categorías públicas que tienen una lista (máximo 200).
-- -----------------------------------------------------------------------------
create or replace function storefront.category_thumbs(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(x.path, x.image), '{}'::jsonb)
    from (select c.path, jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height,
                                            'alt', m.alt_text) as image
            from public.categories c
            join public.media m on m.store_id = c.store_id and m.id = c.image_media_id
                               and m.status = 'ready' and m.deleted_at is null
           where c.store_id = p_store_id and c.deleted_at is null and c.is_visible
             and app.category_public(c.store_id, c.id)
             and app.store_publicly_readable(p_store_id)
           order by c.depth, c.position, c.name
           limit 200) x
$$;

revoke all on function storefront.category_thumbs(uuid) from public;
grant execute on function storefront.category_thumbs(uuid) to storefront_gateway;
