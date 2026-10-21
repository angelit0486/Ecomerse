-- =============================================================================
-- Revisión adversarial del Paso 2 (marcas), docs/phases/PORTADA-PASO-2-REVISION.md:
--
-- A1. import_apply_brand_profiles ya no tumba la importación: normaliza la
--     descripción como catalog_upsert_brand y omite la que no pase el CHECK.
-- A2. Tampoco reemplaza un logo listo: solo pone el del archivo si la marca no
--     tiene logo o el suyo no está listo (para cambiarlo, el panel).
-- M3. Un logo del archivo que se rechazó se puede reintentar con el mismo CSV.
-- M4. Cambiar o quitar el logo o la portada borra (soft) la imagen anterior:
--     sin huérfanos que cuenten en la cuota; la purga la quita a los 7 días.
-- B8. Cada marca cambiada por la importación queda en la auditoría.
-- =============================================================================

create or replace function public.catalog_set_brand_media(p_store_id uuid, p_brand_id uuid, p_kind text,
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
  perform app.require_store_permission(p_store_id, 'brands.manage');
  if p_kind is null or p_kind not in ('logo', 'cover') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'kind';
  end if;
  select case when p_kind = 'logo' then b.logo_media_id else b.cover_media_id end,
         case when p_kind = 'logo' then b.cover_media_id else b.logo_media_id end
    into v_before, v_other
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
  -- M4: la imagen anterior ya no la usa nadie (las de marca no se comparten).
  if v_before is not null and v_before is distinct from p_media_id and v_before is distinct from v_other
     and not exists (select 1 from public.brands b
                      where b.store_id = p_store_id and (b.logo_media_id = v_before or b.cover_media_id = v_before)) then
    update public.media set deleted_at = now()
     where store_id = p_store_id and id = v_before and owner_type = 'brand' and deleted_at is null;
  end if;
  perform audit.record('brand.media_set', 'brand', p_brand_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object(p_kind, v_before), jsonb_build_object(p_kind, p_media_id));
end
$$;

revoke all on function public.catalog_set_brand_media(uuid, uuid, text, uuid) from public;
grant execute on function public.catalog_set_brand_media(uuid, uuid, text, uuid) to authenticated;

create or replace function system.import_apply_brand_profiles(p_job_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job     public.import_jobs;
  v_row     record;
  v_brand   public.brands;
  v_id      uuid;
  v_desc    text;
  v_url     text;
  v_done    uuid[] := '{}';
  v_count   integer := 0;
  v_skipped integer := 0;
  v_org     uuid;
begin
  select * into v_job from public.import_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'completed' then
    return 0;
  end if;
  v_org := (select s.organization_id from public.stores s where s.id = v_job.store_id);
  for v_row in
    select r.normalized ->> 'brand' as brand, r.normalized -> 'brand_profile' as profile
      from public.import_job_rows r
     where r.import_job_id = p_job_id and r.store_id = v_job.store_id
       and jsonb_typeof(r.normalized -> 'brand_profile') = 'object'
       and nullif(btrim(r.normalized ->> 'brand'), '') is not null
     order by r.row_number
  loop
    select * into v_brand from public.brands b
     where b.store_id = v_job.store_id and b.deleted_at is null and lower(b.name) = lower(btrim(v_row.brand))
       for update;
    -- La primera fila de cada marca manda (varias filas del mismo archivo la repiten).
    continue when v_brand.id is null or v_brand.id = any (v_done);
    v_done := v_done || v_brand.id;

    -- A1: misma normalización que catalog_upsert_brand; lo que no pase se omite.
    v_desc := nullif(btrim(regexp_replace(coalesce(v_row.profile ->> 'description', ''), '\r\n?', E'\n', 'g')), '');
    if v_desc is not null and char_length(v_desc) <= 1000
       and v_desc !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' and v_desc is distinct from v_brand.description then
      update public.brands set description = v_desc where store_id = v_job.store_id and id = v_brand.id;
      perform audit.record('brand.saved', 'brand', v_brand.id, v_org, v_job.store_id,
                           jsonb_build_object('description', v_brand.description),
                           jsonb_build_object('description', v_desc, 'import_job_id', p_job_id));
    end if;

    v_url := v_row.profile ->> 'logo_url';
    -- Se valida al crear la importación; aquí se vuelve a exigir (la base es la autoridad).
    continue when v_url is null or v_url !~ '^https://' or char_length(v_url) > 2000;
    -- El mismo enlace ya es su logo (y no se rechazó): reimportar no duplica (M3).
    continue when exists (select 1 from public.media m
                           where m.store_id = v_job.store_id and m.id = v_brand.logo_media_id
                             and m.source_url = v_url and m.deleted_at is null and m.status <> 'rejected');
    -- A2: un logo listo no se reemplaza desde el archivo.
    if exists (select 1 from public.media m
                where m.store_id = v_job.store_id and m.id = v_brand.logo_media_id
                  and m.status = 'ready' and m.deleted_at is null) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_id := app.uuid_v7();
    -- Tipo provisional: el worker fija el real al descargar (la ruta no cambia).
    insert into public.media (id, store_id, owner_type, product_id, status, storage_path, mime_type,
                              position, created_by, source_url, alt_text)
    values (v_id, v_job.store_id, 'brand', null, 'pending',
            format('%s/brand/%s/%s/original.jpg', v_job.store_id, v_job.store_id, v_id),
            'image/jpeg', 0, v_job.requested_by, v_url, left('Logo de ' || v_brand.name, 250));
    update public.brands set logo_media_id = v_id where store_id = v_job.store_id and id = v_brand.id;
    -- El intento anterior (pendiente o rechazado) ya no se usa.
    if v_brand.logo_media_id is not null then
      update public.media set deleted_at = now()
       where store_id = v_job.store_id and id = v_brand.logo_media_id and owner_type = 'brand'
         and deleted_at is null;
    end if;
    perform audit.record('brand.media_set', 'brand', v_brand.id, v_org, v_job.store_id,
                         jsonb_build_object('logo', v_brand.logo_media_id),
                         jsonb_build_object('logo', v_id, 'import_job_id', p_job_id));
    perform app.enqueue_job('media.fetch_remote', jsonb_build_object('media_id', v_id), v_job.store_id,
                            'media.fetch_remote:' || v_id::text, now(), 5);
    v_count := v_count + 1;
  end loop;
  update public.import_jobs
     set totals = totals || jsonb_build_object('brand_logos', v_count, 'brand_logos_kept', v_skipped)
   where id = p_job_id;
  return v_count;
end
$$;

revoke all on function system.import_apply_brand_profiles(uuid) from public;
grant execute on function system.import_apply_brand_profiles(uuid) to system_worker;
