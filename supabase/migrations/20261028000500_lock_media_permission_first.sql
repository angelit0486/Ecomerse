-- =============================================================================
-- Misión vendible F1.9 · auditoría SEC-10: app.lock_media verifica que la persona
-- tenga algún permiso sobre medios en ESA tienda antes de buscar (y bloquear) la
-- fila. Antes, quien no tenía acceso a la tienda distinguía «not_found» de
-- «forbidden» y podía saber si un id de foto existía, además de bloquear la fila.
-- Con algún permiso de medios, el comportamiento es el de antes: not_found si no
-- existe y el permiso exacto del tipo de dueño.
-- =============================================================================

create or replace function app.lock_media(p_store_id uuid, p_media_id uuid)
returns public.media
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.media;
begin
  perform app.require_aal2_user();
  if not (app.has_store_permission(p_store_id, 'products.update')
          or app.has_store_permission(p_store_id, 'brands.manage')
          or app.has_store_permission(p_store_id, 'categories.manage')
          or app.has_store_permission(p_store_id, 'appearance.manage')
          or app.has_store_permission(p_store_id, 'content.manage')) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  select * into v from public.media m
   where m.id = p_media_id and m.store_id = p_store_id and m.deleted_at is null
   for update;
  if v.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'media';
  end if;
  perform app.require_store_permission(p_store_id, app.media_permission(v.owner_type));
  return v;
end
$$;
revoke all on function app.lock_media(uuid, uuid) from public;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261028000500'::text
$$;
