-- =============================================================================
-- Fase 3 · Medios (F3-T03)
-- Contrato: GATE0 §25 (Storage), §14 (imágenes del catálogo), §44.13 (sin SVG).
--
-- Ciclo de vida (§25.3) con una desviación registrada (D-F3-03): el original
-- subido por el navegador nunca toca el bucket público. Vive en el bucket
-- PRIVADO `store-uploads`; el worker lo valida, lo re-codifica y publica el
-- resultado en `store-media` (público, no listable). Así ningún byte sin
-- validar es servible por URL pública.
--
--   1. media_create_upload  → fila media(pending) + ruta generada por el servidor
--   2. URL firmada de subida (Storage la emite solo si la política
--      media_upload_insert acepta ESA ruta para ESE usuario)
--   3. media_finalize       → encola media.process
--   4. worker (SR-2)        → magic bytes, sharp, sin EXIF, límite de píxeles
--                             → ready | rejected
--   5. purga diaria         → pendientes vencidos, subidas huérfanas, objetos
--                             sin fila, medios borrados hace más de 7 días
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Buckets. Los límites de tamaño y MIME los aplica Storage al subir (MIME
-- declarado); los magic bytes los verifica el worker.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('store-uploads', 'store-uploads', false, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  ('store-media', 'store-media', true, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- Reglas por tipo de dueño: permiso requerido y tamaño máximo (branding 2 MB).
-- -----------------------------------------------------------------------------
create or replace function app.media_permission(p_owner_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_owner_type
    when 'product' then 'products.update'
    when 'brand' then 'brands.manage'
    when 'category' then 'categories.manage'
    when 'store_branding' then 'appearance.manage'
    when 'banner' then 'content.manage'
  end
$$;
revoke all on function app.media_permission(text) from public;

create or replace function app.media_max_bytes(p_owner_type text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when p_owner_type = 'store_branding' then 2097152 else 10485760 end::bigint
$$;
revoke all on function app.media_max_bytes(text) from public;

-- -----------------------------------------------------------------------------
-- Uso de almacenamiento (storage_mb): bytes de medios no rechazados de la
-- organización, en MB redondeados hacia arriba. Se conservan las demás claves.
-- -----------------------------------------------------------------------------
create or replace function app.current_usage(p_org uuid, p_key text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  case p_key
    when 'max_stores' then
      return (select count(*) from public.stores s
               where s.organization_id = p_org and s.status <> 'closed');
    when 'max_staff' then
      return (select count(*) from public.organization_members m
               where m.organization_id = p_org and m.status = 'active');
    when 'max_products' then
      return (select count(*) from public.products p
                join public.stores s on s.id = p.store_id
               where s.organization_id = p_org and p.deleted_at is null);
    when 'storage_mb' then
      return (select ceil(coalesce(sum(m.bytes), 0) / 1048576.0)::integer
                from public.media m
                join public.stores s on s.id = m.store_id
               where s.organization_id = p_org and m.status <> 'rejected');
    else
      raise exception using errcode = '22023', message = 'unsupported_limit', detail = p_key;
  end case;
end
$$;

-- -----------------------------------------------------------------------------
-- Política de subida (§25.2): solo a la ruta exacta de un medio pendiente,
-- reservado por el MISMO usuario hace menos de 15 minutos, con el permiso
-- vigente. Sin políticas de SELECT/UPDATE/DELETE: el bucket privado solo lo
-- lee y borra el worker (Storage Admin, SR-2).
-- -----------------------------------------------------------------------------
create or replace function app.media_upload_allowed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.media m
     where m.storage_path = p_name
       and split_part(p_name, '/', 1) = m.store_id::text
       and m.status = 'pending'
       and m.deleted_at is null
       and m.created_by = auth.uid()
       and m.created_at > now() - interval '15 minutes'
       and app.has_store_permission(m.store_id, app.media_permission(m.owner_type))
  )
$$;
revoke all on function app.media_upload_allowed(text) from public;
grant execute on function app.media_upload_allowed(text) to authenticated;

create policy media_upload_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'store-uploads' and app.media_upload_allowed(name));

-- -----------------------------------------------------------------------------
-- Medio vivo de la tienda, bloqueado; si no existe en ESA tienda: not_found.
-- Exige el permiso del tipo de dueño.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 1. Reservar una subida. La ruta la genera el servidor (nunca el nombre del
--    archivo del usuario): {store_id}/{owner_type}/{owner_id}/{media_id}/original.{ext}
-- -----------------------------------------------------------------------------
create or replace function public.media_create_upload(
  p_store_id   uuid,
  p_owner_type text,
  p_product_id uuid,
  p_mime_type  text,
  p_bytes      bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid;
  v_org      uuid;
  v_id       uuid := app.uuid_v7();
  v_ext      text;
  v_path     text;
  v_position integer := 0;
begin
  if app.media_permission(p_owner_type) is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'owner_type';
  end if;
  v_uid := app.require_store_permission(p_store_id, app.media_permission(p_owner_type));

  v_ext := case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/avif' then 'avif'
  end;
  if v_ext is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'mime_type';
  end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > app.media_max_bytes(p_owner_type) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'bytes';
  end if;

  if p_owner_type = 'product' then
    perform app.lock_product(p_store_id, p_product_id);
    select coalesce(max(m.position) + 1, 0) into v_position
      from public.media m where m.product_id = p_product_id;
  elsif p_product_id is not null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'product_id';
  end if;

  -- Contra el abuso: como máximo 50 subidas pendientes por tienda a la vez.
  perform pg_advisory_xact_lock(hashtextextended('media_pending:' || p_store_id::text, 0));
  if (select count(*) from public.media m
       where m.store_id = p_store_id and m.status = 'pending' and m.deleted_at is null
         and m.created_at > now() - interval '24 hours') >= 50 then
    raise exception using errcode = 'P0001', message = 'limit_reached',
      detail = json_build_object('key', 'pending_uploads', 'limit', 50)::text;
  end if;

  select s.organization_id into v_org from public.stores s where s.id = p_store_id;
  perform app.assert_within_limit(v_org, 'storage_mb', ceil(p_bytes / 1048576.0)::integer);

  v_path := format('%s/%s/%s/%s/original.%s', p_store_id, p_owner_type,
                   coalesce(p_product_id, p_store_id), v_id, v_ext);

  insert into public.media (id, store_id, owner_type, product_id, status, storage_path, mime_type,
                            bytes, position, created_by)
  values (v_id, p_store_id, p_owner_type, p_product_id, 'pending', v_path, p_mime_type,
          p_bytes, v_position, v_uid);

  return jsonb_build_object('media_id', v_id, 'bucket', 'store-uploads', 'path', v_path);
end
$$;

-- -----------------------------------------------------------------------------
-- 3. Finalizar: el objeto debe existir en store-uploads. Idempotente.
-- -----------------------------------------------------------------------------
create or replace function public.media_finalize(p_store_id uuid, p_media_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.media;
begin
  v := app.lock_media(p_store_id, p_media_id);
  if v.status <> 'pending' then
    return jsonb_build_object('media_id', v.id, 'status', v.status);
  end if;
  if not exists (select 1 from storage.objects o
                  where o.bucket_id = 'store-uploads' and o.name = v.storage_path) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'file';
  end if;
  perform app.enqueue_job('media.process', jsonb_build_object('media_id', v.id), v.store_id,
                          'media.process:' || v.id::text, now(), 5);
  return jsonb_build_object('media_id', v.id, 'status', v.status);
end
$$;

-- -----------------------------------------------------------------------------
-- Texto alternativo (accesibilidad; advertencia de publicación si falta).
-- -----------------------------------------------------------------------------
create or replace function public.media_set_alt_text(p_store_id uuid, p_media_id uuid, p_alt_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.media;
begin
  v := app.lock_media(p_store_id, p_media_id);
  if p_alt_text is not null and char_length(p_alt_text) > 250 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'alt_text';
  end if;
  update public.media set alt_text = nullif(btrim(p_alt_text), '') where id = v.id;
end
$$;

-- -----------------------------------------------------------------------------
-- Orden de las imágenes de un producto: los ids dados primero (0..n-1); el
-- resto conserva su orden relativo detrás.
-- -----------------------------------------------------------------------------
create or replace function public.media_reorder_product(p_store_id uuid, p_product_id uuid, p_media_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'products.update');
  perform app.lock_product(p_store_id, p_product_id);
  if p_media_ids is null or cardinality(p_media_ids) <> cardinality(array(select distinct unnest(p_media_ids)))
     or exists (select 1 from unnest(p_media_ids) i(id)
                 where not exists (select 1 from public.media m
                                    where m.id = i.id and m.product_id = p_product_id
                                      and m.store_id = p_store_id and m.deleted_at is null)) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'media_ids';
  end if;

  set constraints public.media_product_position_uq deferred;
  update public.media m
     set position = o.new_position
    from (select m2.id,
                 (row_number() over (order by coalesce(array_position(p_media_ids, m2.id), 2147483647),
                                     m2.position, m2.id) - 1)::integer as new_position
            from public.media m2
           where m2.product_id = p_product_id) o
   where m.id = o.id and m.position is distinct from o.new_position;
  set constraints public.media_product_position_uq immediate;
end
$$;

-- -----------------------------------------------------------------------------
-- Borrado lógico: deja de usarse en variantes, marcas y categorías; el objeto
-- se purga a los 7 días (§25.3.6).
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
  update public.categories set image_media_id = null where store_id = p_store_id and image_media_id = v.id;
  update public.media set deleted_at = now() where id = v.id;
  perform audit.record('media.deleted', 'media', v.id, null, p_store_id,
                       jsonb_build_object('owner_type', v.owner_type, 'product_id', v.product_id), null);
end
$$;

revoke all on function public.media_create_upload(uuid, text, uuid, text, bigint) from public;
revoke all on function public.media_finalize(uuid, uuid) from public;
revoke all on function public.media_set_alt_text(uuid, uuid, text) from public;
revoke all on function public.media_reorder_product(uuid, uuid, uuid[]) from public;
revoke all on function public.media_delete(uuid, uuid) from public;
grant execute on function public.media_create_upload(uuid, text, uuid, text, bigint) to authenticated;
grant execute on function public.media_finalize(uuid, uuid) to authenticated;
grant execute on function public.media_set_alt_text(uuid, uuid, text) to authenticated;
grant execute on function public.media_reorder_product(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.media_delete(uuid, uuid) to authenticated;

-- =============================================================================
-- Worker (system_worker). Deriva todo de la fila: el payload solo trae el id.
-- =============================================================================
create or replace function system.media_for_processing(p_media_id uuid)
returns table (store_id uuid, storage_path text, mime_type text, owner_type text, max_bytes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select m.store_id, m.storage_path, m.mime_type, m.owner_type, app.media_max_bytes(m.owner_type)
    from public.media m
   where m.id = p_media_id and m.status = 'pending' and m.deleted_at is null
     and split_part(m.storage_path, '/', 1) = m.store_id::text
$$;

create or replace function system.media_mark_ready(p_media_id uuid, p_width integer, p_height integer, p_bytes bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.media
     set status = 'ready', width = p_width, height = p_height, bytes = p_bytes, rejection_reason = null
   where id = p_media_id and status = 'pending';
  if found then
    update public.products p set updated_at = now()
      from public.media m where m.id = p_media_id and p.id = m.product_id;
  end if;
  return found;
end
$$;

create or replace function system.media_mark_rejected(p_media_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_reason is null or p_reason !~ '^[a-z_]{1,50}$' then
    raise exception using errcode = '22023', message = 'invalid_reason';
  end if;
  update public.media set status = 'rejected', rejection_reason = p_reason
   where id = p_media_id and status = 'pending';
  return found;
end
$$;

-- Candidatos a purga (§25.3.6-7), en lotes:
--   expired_pending : media pendiente de más de 24 h (objeto en store-uploads)
--   stale_upload    : objeto de store-uploads de más de 24 h sin medio pendiente
--   orphan_media    : objeto de store-media de más de 48 h sin medio ready vivo
--   deleted_media   : medio borrado hace más de 7 días (objeto en store-media)
create or replace function system.media_purge_candidates(p_limit integer default 200)
returns table (kind text, bucket text, path text, media_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  (select 'expired_pending', 'store-uploads', m.storage_path, m.id
     from public.media m
    where m.status = 'pending' and m.created_at < now() - interval '24 hours'
    order by m.created_at limit p_limit)
  union all
  (select 'stale_upload', 'store-uploads', o.name, null::uuid
     from storage.objects o
    where o.bucket_id = 'store-uploads' and o.created_at < now() - interval '24 hours'
      and not exists (select 1 from public.media m
                       where m.storage_path = o.name and m.status = 'pending')
    order by o.created_at limit p_limit)
  union all
  (select 'orphan_media', 'store-media', o.name, null::uuid
     from storage.objects o
    where o.bucket_id = 'store-media' and o.created_at < now() - interval '48 hours'
      and not exists (select 1 from public.media m
                       where m.storage_path = o.name and m.status = 'ready'
                         and (m.deleted_at is null or m.deleted_at > now() - interval '7 days'))
    order by o.created_at limit p_limit)
  union all
  (select 'deleted_media', 'store-media', m.storage_path, m.id
     from public.media m
    where m.deleted_at < now() - interval '7 days'
    order by m.deleted_at limit p_limit)
$$;

-- Tras borrar los objetos: elimina las filas que siguen cumpliendo la condición.
create or replace function system.media_purge_rows(p_media_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.media m
   where m.id = any (p_media_ids)
     and ((m.status = 'pending' and m.created_at < now() - interval '24 hours')
          or m.deleted_at < now() - interval '7 days');
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- Mantenimiento periódico: el runner lo llama en cada invocación; la clave de
-- deduplicación por día hace que la purga se encole una vez al día.
create or replace function system.enqueue_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.enqueue_job('media.purge_orphans', '{}'::jsonb, null,
                          'media.purge_orphans:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
end
$$;

revoke all on function system.media_for_processing(uuid) from public;
revoke all on function system.media_mark_ready(uuid, integer, integer, bigint) from public;
revoke all on function system.media_mark_rejected(uuid, text) from public;
revoke all on function system.media_purge_candidates(integer) from public;
revoke all on function system.media_purge_rows(uuid[]) from public;
revoke all on function system.enqueue_maintenance() from public;
grant execute on function system.media_for_processing(uuid) to system_worker;
grant execute on function system.media_mark_ready(uuid, integer, integer, bigint) to system_worker;
grant execute on function system.media_mark_rejected(uuid, text) to system_worker;
grant execute on function system.media_purge_candidates(integer) to system_worker;
grant execute on function system.media_purge_rows(uuid[]) to system_worker;
grant execute on function system.enqueue_maintenance() to system_worker;
