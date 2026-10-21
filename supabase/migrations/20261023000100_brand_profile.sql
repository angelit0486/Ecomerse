-- =============================================================================
-- Marcas con logo, portada, descripción y sitio web (misión Portada/Marcas,
-- Paso 2). La columna `logo_media_id` existía, pero ninguna función la
-- llenaba: el panel no tenía cómo subir el logo de una marca.
--
-- Las imágenes son medios de la MISMA tienda con `owner_type = 'brand'` (el
-- pipeline de siempre: Storage, re-codificación sin EXIF, SVG rechazado,
-- purga). FK compuestas `(store_id, …)` con `on delete set null (columna)`,
-- como el logo (GATE0 §44 regla 2).
-- =============================================================================

alter table public.brands
  add column cover_media_id uuid,
  add column description text
    check (description is null
           or (char_length(description) between 1 and 1000
               and description !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]')),
  add column website_url text
    check (website_url is null
           or (website_url ~ '^https://' and app.theme_link_valid(to_jsonb(website_url))));

alter table public.brands
  add constraint brands_cover_fk foreign key (store_id, cover_media_id)
  references public.media (store_id, id) on delete set null (cover_media_id);

-- -----------------------------------------------------------------------------
-- Guardar una marca: nombre y slug como antes; descripción y sitio solo si
-- vienen en el JSON (las llamadas viejas no los borran).
-- -----------------------------------------------------------------------------
create or replace function public.catalog_upsert_brand(p_store_id uuid, p_brand jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id          uuid := nullif(p_brand ->> 'id', '')::uuid;
  v_slug        text := coalesce(nullif(btrim(p_brand ->> 'slug'), ''), app.slugify(p_brand ->> 'name'));
  v_description text := nullif(btrim(regexp_replace(coalesce(p_brand ->> 'description', ''), '\r\n?', E'\n', 'g')), '');
  v_website     text := nullif(btrim(coalesce(p_brand ->> 'website_url', '')), '');
begin
  perform app.require_store_permission(p_store_id, 'brands.manage');
  if coalesce(char_length(btrim(p_brand ->> 'name')), 0) not between 1 and 120 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'name';
  end if;
  if not app.slug_valid(v_slug) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'slug';
  end if;
  if p_brand ? 'description' and v_description is not null
     and (char_length(v_description) > 1000 or v_description ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'description';
  end if;
  if p_brand ? 'website_url' and v_website is not null
     and not (v_website ~ '^https://' and app.theme_link_valid(to_jsonb(v_website))) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'website_url';
  end if;
  if v_id is not null and not exists (select 1 from public.brands b where b.store_id = p_store_id and b.id = v_id
                                        and b.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'brand';
  end if;
  begin
    if v_id is null then
      insert into public.brands (store_id, name, slug, description, website_url)
      values (p_store_id, btrim(p_brand ->> 'name'), v_slug, v_description, v_website)
      returning id into v_id;
    else
      update public.brands
         set name = btrim(p_brand ->> 'name'), slug = v_slug,
             description = case when p_brand ? 'description' then v_description else description end,
             website_url = case when p_brand ? 'website_url' then v_website else website_url end
       where store_id = p_store_id and id = v_id;
    end if;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'slug';
  end;
  perform audit.record('brand.saved', 'brand', v_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('name', btrim(p_brand ->> 'name')));
  return v_id;
end
$$;

-- -----------------------------------------------------------------------------
-- Logo o portada de una marca: un medio de la misma tienda subido para marcas
-- (no rechazado); null lo quita. Un medio de otra tienda ni se ve (FK compuesta).
-- -----------------------------------------------------------------------------
create or replace function public.catalog_set_brand_media(p_store_id uuid, p_brand_id uuid, p_kind text,
                                                          p_media_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before uuid;
begin
  perform app.require_store_permission(p_store_id, 'brands.manage');
  if p_kind is null or p_kind not in ('logo', 'cover') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'kind';
  end if;
  select case when p_kind = 'logo' then b.logo_media_id else b.cover_media_id end into v_before
    from public.brands b
   where b.store_id = p_store_id and b.id = p_brand_id and b.deleted_at is null
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'brand';
  end if;
  if p_media_id is not null and not exists (
       select 1 from public.media m
        where m.store_id = p_store_id and m.id = p_media_id and m.owner_type = 'brand'
          and m.deleted_at is null and m.status <> 'rejected') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'media';
  end if;
  if p_kind = 'logo' then
    update public.brands set logo_media_id = p_media_id where store_id = p_store_id and id = p_brand_id;
  else
    update public.brands set cover_media_id = p_media_id where store_id = p_store_id and id = p_brand_id;
  end if;
  perform audit.record('brand.media_set', 'brand', p_brand_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object(p_kind, v_before), jsonb_build_object(p_kind, p_media_id));
end
$$;

revoke all on function public.catalog_set_brand_media(uuid, uuid, text, uuid) from public;
grant execute on function public.catalog_set_brand_media(uuid, uuid, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Tienda: el directorio trae el logo (como antes) y la página de la marca su
-- portada, descripción y sitio. Solo medios listos y no borrados.
-- -----------------------------------------------------------------------------
create or replace function storefront.get_brand(p_store_id uuid, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'seo_title', b.seo_title,
                            'seo_description', b.seo_description, 'updated_at', b.updated_at,
                            'description', b.description, 'website_url', b.website_url,
                            'logo', (select jsonb_build_object('path', m.storage_path, 'width', m.width,
                                                               'height', m.height, 'alt', m.alt_text)
                                       from public.media m where m.store_id = b.store_id and m.id = b.logo_media_id
                                        and m.status = 'ready' and m.deleted_at is null),
                            'cover', (select jsonb_build_object('path', m.storage_path, 'width', m.width,
                                                                'height', m.height, 'alt', m.alt_text)
                                        from public.media m where m.store_id = b.store_id and m.id = b.cover_media_id
                                         and m.status = 'ready' and m.deleted_at is null))
    from public.brands b
   where b.store_id = p_store_id and b.slug = p_slug and b.deleted_at is null
     and app.store_publicly_readable(p_store_id)
$$;

revoke all on function storefront.get_brand(uuid, text) from public;
grant execute on function storefront.get_brand(uuid, text) to storefront_gateway;
