-- =============================================================================
-- Estudio · Paso 4 (DECISIONS §25: D-EST-01, D-EST-02, D-EST-03).
--
-- 1. Rol de sistema «Diseño» (designer): apariencia, páginas, menús y SEO, con
--    lectura de la tienda y de productos para la vista previa. Una fila más en
--    `roles`; el modelo de permisos no cambia.
-- 2. Redirecciones 301 por tienda (`store_redirects`): ruta vieja → ruta de la
--    misma tienda (nunca a otro sitio: sin redirección abierta). Las aplica el
--    proxy después de resolver la tienda por host. Sin cadenas: un destino no
--    puede ser origen de otra.
-- 3. Categorías: SEO e imagen en `catalog_upsert_category` (las columnas y la
--    lectura de la tienda ya existían). Solo se cambia lo que se manda.
-- =============================================================================

-- 1. Rol Diseño ----------------------------------------------------------------
insert into public.roles (key, name, is_system, rank) values ('designer', 'Diseño', true, 50)
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
  from public.roles r
  join (values ('store.read'), ('products.read'), ('appearance.manage'), ('content.manage'), ('seo.manage'))
       as p (key) on true
 where r.key = 'designer' and r.organization_id is null
on conflict do nothing;

-- 2. Redirecciones -------------------------------------------------------------
create or replace function app.redirect_path_valid(p_path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_path is not null and char_length(p_path) between 2 and 500
     and p_path ~ '^/[^\s?#\\]*$' and p_path !~ '//' and p_path !~ '(^|/)\.\.?(/|$)'
$$;
revoke all on function app.redirect_path_valid(text) from public;

create table public.store_redirects (
  id         uuid primary key default app.uuid_v7(),
  store_id   uuid not null references public.stores (id) on delete cascade,
  from_path  text not null check (app.redirect_path_valid(from_path) and from_path = lower(from_path)),
  to_path    text not null check (to_path = '/' or app.redirect_path_valid(to_path)),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, from_path),
  check (from_path <> to_path)
);
create index store_redirects_store_idx on public.store_redirects (store_id);

create trigger store_redirects_set_updated_at before update on public.store_redirects
  for each row execute function app.set_updated_at();
create trigger store_redirects_prevent_tenant_change before update on public.store_redirects
  for each row execute function app.prevent_tenant_change();

alter table public.store_redirects enable row level security;
alter table public.store_redirects force row level security;
revoke all on table public.store_redirects from public, anon, authenticated, service_role;
grant select on public.store_redirects to authenticated;
create policy store_redirects_select on public.store_redirects for select to authenticated
  using (app.has_store_permission(store_id, 'seo.manage'));

-- Rutas que la tienda siempre resuelve: no se pueden tapar con una redirección.
create or replace function app.redirect_reserved(p_path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_path = '/' or p_path ~ '^/(_|api/|api$|carrito|checkout|cuenta|pedido|buscar$|productos$|sitemap|robots)'
$$;
revoke all on function app.redirect_reserved(text) from public;

create or replace function public.seo_upsert_redirect(p_store_id uuid, p_from text, p_to text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app.require_store_permission(p_store_id, 'seo.manage');
  v_from text := lower(btrim(coalesce(p_from, '')));
  v_to   text := btrim(coalesce(p_to, ''));
  v_id   uuid;
begin
  if not app.redirect_path_valid(v_from) or app.redirect_reserved(v_from) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'from_path';
  end if;
  if not (v_to = '/' or app.redirect_path_valid(v_to)) or lower(v_to) = v_from then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'to_path';
  end if;
  -- Sin cadenas ni ciclos: el destino no es origen de otra y el origen no es destino de otra.
  if exists (select 1 from public.store_redirects r
              where r.store_id = p_store_id and r.from_path = lower(v_to) and r.from_path <> v_from)
     or exists (select 1 from public.store_redirects r
                 where r.store_id = p_store_id and lower(r.to_path) = v_from) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'chain';
  end if;
  if (select count(*) from public.store_redirects r where r.store_id = p_store_id) >= 500
     and not exists (select 1 from public.store_redirects r where r.store_id = p_store_id and r.from_path = v_from) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'too_many';
  end if;
  insert into public.store_redirects (store_id, from_path, to_path, created_by)
  values (p_store_id, v_from, v_to, v_uid)
  on conflict (store_id, from_path) do update set to_path = excluded.to_path
  returning id into v_id;
  perform audit.record('redirect.saved', 'store_redirect', v_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('from', v_from, 'to', v_to));
  return v_id;
end
$$;

create or replace function public.seo_delete_redirect(p_store_id uuid, p_redirect_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.store_redirects;
begin
  perform app.require_store_permission(p_store_id, 'seo.manage');
  delete from public.store_redirects r where r.store_id = p_store_id and r.id = p_redirect_id returning * into v;
  if v.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'redirect';
  end if;
  perform audit.record('redirect.deleted', 'store_redirect', v.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('from', v.from_path, 'to', v.to_path), null);
end
$$;

-- Lectura del proxy (rol storefront_gateway): el mapa completo de UNA tienda.
create or replace function storefront.store_redirects(p_store_id uuid)
returns table (from_path text, to_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.from_path, r.to_path from public.store_redirects r
   where r.store_id = p_store_id and app.store_publicly_readable(p_store_id)
$$;

revoke all on function public.seo_upsert_redirect(uuid, text, text) from public;
revoke all on function public.seo_delete_redirect(uuid, uuid) from public;
revoke all on function storefront.store_redirects(uuid) from public;
grant execute on function public.seo_upsert_redirect(uuid, text, text) to authenticated;
grant execute on function public.seo_delete_redirect(uuid, uuid) to authenticated;
grant execute on function storefront.store_redirects(uuid) to storefront_gateway;

-- 3. Categorías: SEO e imagen ----------------------------------------------------
create or replace function public.catalog_upsert_category(p_store_id uuid, p_category jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid := nullif(p_category ->> 'id', '')::uuid;
  v_parent uuid := nullif(p_category ->> 'parent_id', '')::uuid;
  v_slug   text := coalesce(nullif(btrim(p_category ->> 'slug'), ''), app.slugify(p_category ->> 'name'));
  v_image  uuid := nullif(p_category ->> 'image_media_id', '')::uuid;
  v_msg    text;
begin
  perform app.require_store_permission(p_store_id, 'categories.manage');
  if coalesce(char_length(btrim(p_category ->> 'name')), 0) not between 1 and 120 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'name';
  end if;
  if not app.slug_valid(v_slug) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'slug';
  end if;
  if v_parent is not null and not exists (select 1 from public.categories c where c.store_id = p_store_id
                                            and c.id = v_parent and c.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'parent_id';
  end if;
  if v_id is not null and not exists (select 1 from public.categories c where c.store_id = p_store_id
                                        and c.id = v_id and c.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'category';
  end if;
  if coalesce(char_length(p_category ->> 'seo_title'), 0) > 70 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'seo_title';
  end if;
  if coalesce(char_length(p_category ->> 'seo_description'), 0) > 320 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'seo_description';
  end if;
  -- Solo una imagen lista de ESTA tienda subida para categorías.
  if v_image is not null and not exists (
       select 1 from public.media m
        where m.store_id = p_store_id and m.id = v_image and m.owner_type = 'category'
          and m.status = 'ready' and m.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'image_media_id';
  end if;
  begin
    if v_id is null then
      insert into public.categories (store_id, parent_id, name, slug, description, is_visible, position,
                                     seo_title, seo_description, image_media_id)
      values (p_store_id, v_parent, btrim(p_category ->> 'name'), v_slug, nullif(p_category ->> 'description', ''),
              coalesce((p_category ->> 'is_visible')::boolean, true), coalesce((p_category ->> 'position')::integer, 0),
              nullif(btrim(p_category ->> 'seo_title'), ''), nullif(btrim(p_category ->> 'seo_description'), ''),
              v_image)
      returning id into v_id;
    else
      update public.categories
         set parent_id = v_parent, name = btrim(p_category ->> 'name'),
             -- Sin slug explícito se conserva la dirección (renombrar no rompe enlaces).
             slug = case when nullif(btrim(p_category ->> 'slug'), '') is null then slug else v_slug end,
             description = case when p_category ? 'description'
                                then nullif(p_category ->> 'description', '') else description end,
             is_visible = case when p_category ? 'is_visible'
                               then coalesce((p_category ->> 'is_visible')::boolean, true) else is_visible end,
             position = case when p_category ? 'position'
                             then coalesce((p_category ->> 'position')::integer, 0) else position end,
             seo_title = case when p_category ? 'seo_title'
                              then nullif(btrim(p_category ->> 'seo_title'), '') else seo_title end,
             seo_description = case when p_category ? 'seo_description'
                                    then nullif(btrim(p_category ->> 'seo_description'), '') else seo_description end,
             image_media_id = case when p_category ? 'image_media_id' then v_image else image_media_id end
       where id = v_id;
    end if;
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'slug';
    when check_violation then
      get stacked diagnostics v_msg = message_text;
      raise exception using errcode = 'P0001', message = 'validation_failed',
        detail = case v_msg when 'category_cycle' then 'parent_id' when 'category_too_deep' then 'parent_id'
                            else 'name' end;
  end;
  perform audit.record('category.saved', 'category', v_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('name', btrim(p_category ->> 'name'), 'parent_id', v_parent));
  return v_id;
end
$$;
