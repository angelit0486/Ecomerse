-- =============================================================================
-- Paso 8 del plan «panel y tienda profesionales» (auditoría REN-01): fotos en
-- varios tamaños para `srcset`. El contrato de rutas de Storage (§43) no cambia:
-- las copias viven junto al archivo publicado, en `{ruta}.w{ancho}.webp`
-- (mismo prefijo de tienda), y solo se generan anchos menores que el original.
--
-- - `media.variants_done`: la foto ya tiene sus copias. El worker la marca al
--   publicarla (subidas nuevas) o al generarlas para las fotos de antes
--   (job `media.backfill_variants`, encolado por el mantenimiento mientras falten).
-- - La tienda pide `srcset` solo si TODAS sus fotos listas tienen copias
--   (`media_variants` en los datos públicos): nunca un tamaño que no existe.
-- =============================================================================

alter table public.media add column variants_done boolean not null default false;

create index media_variants_pending_idx on public.media (store_id)
  where status = 'ready' and not variants_done and deleted_at is null;

-- La firma cambia (parámetro nuevo con valor por defecto): se quita la anterior.
drop function system.media_mark_ready(uuid, integer, integer, bigint);
create function system.media_mark_ready(p_media_id uuid, p_width integer, p_height integer, p_bytes bigint,
                                        p_variants_done boolean default false)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.media
     set status = 'ready', width = p_width, height = p_height, bytes = p_bytes, rejection_reason = null,
         variants_done = coalesce(p_variants_done, false)
   where id = p_media_id and status = 'pending';
  if found then
    update public.products p set updated_at = now()
      from public.media m where m.id = p_media_id and p.id = m.product_id;
  end if;
  return found;
end
$$;
revoke all on function system.media_mark_ready(uuid, integer, integer, bigint, boolean) from public;
grant execute on function system.media_mark_ready(uuid, integer, integer, bigint, boolean) to system_worker;

-- Fotos de antes, sin copias todavía (las más antiguas primero).
create function system.media_variants_pending(p_limit integer default 20)
returns table (id uuid, store_id uuid, storage_path text, width integer, mime_type text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.store_id, m.storage_path, m.width, m.mime_type
    from public.media m
   where m.status = 'ready' and not m.variants_done and m.deleted_at is null
   order by m.created_at
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;
revoke all on function system.media_variants_pending(integer) from public;
grant execute on function system.media_variants_pending(integer) to system_worker;

create function system.media_set_variants_done(p_media_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.media set variants_done = true
   where id = p_media_id and status = 'ready' and not variants_done;
  return found;
end
$$;
revoke all on function system.media_set_variants_done(uuid) from public;
grant execute on function system.media_set_variants_done(uuid) to system_worker;

create or replace function app.store_public_json(p_store_id uuid, p_draft boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'name', s.name, 'handle', s.handle, 'status', s.status,
    'locale', s.locale, 'currency', s.currency, 'country', s.country,
    -- Apertura de la tienda: el catálogo con el que abre no lleva «Nuevo».
    'launched_at', s.launched_at,
    -- Zona horaria de la tienda: fechas estimadas de entrega en su calendario.
    'timezone', s.timezone,
    'primary_hostname', coalesce(
                          (select d.hostname from public.store_domains d
                            where d.store_id = s.id and d.is_primary and d.status = 'active'),
                          (select d.hostname from public.store_domains d
                            where d.store_id = s.id and d.type = 'platform_subdomain' and d.status = 'active'
                            order by d.created_at limit 1)),
    -- Contacto comercial de la tienda (§20.2: email, teléfono; WhatsApp, dirección
    -- y horario van en el tema).
    'contact', jsonb_strip_nulls(jsonb_build_object('email', s.contact_email, 'phone', s.contact_phone)),
    -- Paso 8: todas sus fotos listas tienen copias en varios tamaños; la tienda
    -- usa srcset solo entonces (una foto sin copias nunca queda rota).
    'media_variants', not exists (select 1 from public.media mv
                                   where mv.store_id = s.id and mv.status = 'ready' and not mv.variants_done
                                     and mv.deleted_at is null),
    'theme', jsonb_build_object(
      'key', t.theme_key, 'version', t.theme_version,
      'settings', coalesce(case when p_draft then coalesce(t.draft_settings, t.settings) else t.settings end,
                           '{}'::jsonb),
      'published_at', t.published_at,
      'revision', case when p_draft then t.draft_revision end),
    'logo', (select jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height)
               from public.media m
              where m.store_id = s.id
                and m.id = case when p_draft and t.draft_settings is not null then t.draft_logo_media_id
                                else t.logo_media_id end
                and m.status = 'ready' and m.deleted_at is null),
    'seo_image', (select jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height,
                                            'alt', m.alt_text)
                    from public.media m
                   where m.store_id = s.id
                     and m.id = (case when p_draft then coalesce(t.draft_settings, t.settings) else t.settings end
                                 #>> '{seo,image_media_id}')::uuid
                     and m.status = 'ready' and m.deleted_at is null),
    -- Favicon propio (ADR-034): imagen de marca cuadrada de ESTA tienda.
    'favicon', (select jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height)
                  from public.media m
                 where m.store_id = s.id
                   and m.id = (case when p_draft then coalesce(t.draft_settings, t.settings) else t.settings end
                               ->> 'favicon_media_id')::uuid
                   and m.status = 'ready' and m.deleted_at is null and m.owner_type = 'store_branding')
  )
  from public.stores s
  left join public.store_themes t on t.store_id = s.id
  where s.id = p_store_id and s.status <> 'closed'
$$;

create or replace function system.enqueue_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.enqueue_job('media.purge_orphans', '{}'::jsonb, null,
                          'media.purge_orphans:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
  perform app.enqueue_job('orders.expire', '{}'::jsonb, null,
                          'orders.expire:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'), now(), 3);
  perform app.enqueue_job('rate_limits.purge', '{}'::jsonb, null,
                          'rate_limits.purge:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
  perform app.enqueue_job('payments.reconcile', '{}'::jsonb, null,
                          'payments.reconcile:' || to_char(date_trunc('hour', now() at time zone 'utc')
                            + floor(extract(minute from now() at time zone 'utc') / 10) * interval '10 minutes',
                            'YYYY-MM-DD"T"HH24:MI'), now(), 3);
  perform app.enqueue_job('orders.complete', '{}'::jsonb, null,
                          'orders.complete:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
  -- Tanda 7: publicaciones programadas que ya vencieron.
  perform app.enqueue_job('catalog.publish_scheduled', '{}'::jsonb, null,
                          'catalog.publish_scheduled:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'),
                          now(), 3);
  -- ADR-030: ofertas con fechas que empiezan o terminan.
  perform app.enqueue_job('catalog.apply_sales', '{}'::jsonb, null,
                          'catalog.apply_sales:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'),
                          now(), 3);
  -- Paso 8: copias en varios tamaños de las fotos que aún no las tienen (por hora).
  if exists (select 1 from public.media m
              where m.status = 'ready' and not m.variants_done and m.deleted_at is null) then
    perform app.enqueue_job('media.backfill_variants', '{}'::jsonb, null,
                            'media.backfill_variants:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24'),
                            now(), 3);
  end if;
  perform system.fail_stuck_imports();
end
$$;

-- El job de copias se vuelve a encolar solo mientras falten fotos (si no,
-- esperaría a la siguiente hora del mantenimiento).
create function system.media_backfill_requeue()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.media m
                  where m.status = 'ready' and not m.variants_done and m.deleted_at is null) then
    return false;
  end if;
  perform app.enqueue_job('media.backfill_variants', '{}'::jsonb, null,
                          'media.backfill_variants:' || to_char(clock_timestamp() at time zone 'utc',
                                                                'YYYY-MM-DD"T"HH24:MI:SS.US'),
                          now(), 3);
  return true;
end
$$;
revoke all on function system.media_backfill_requeue() from public;
grant execute on function system.media_backfill_requeue() to system_worker;

-- La purga de huérfanos reconoce las copias como parte de su foto (si no, las
-- borraría a las 48 horas). Las de una foto borrada las quita el worker con ella.
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
      and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' and char_length(o.name) <= 500
      and not exists (select 1 from public.media m
                       where m.storage_path = o.name and m.status = 'pending')
    order by o.created_at limit p_limit)
  union all
  (select 'orphan_media', 'store-media', o.name, null::uuid
     from storage.objects o
    where o.bucket_id = 'store-media' and o.created_at < now() - interval '48 hours'
      and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' and char_length(o.name) <= 500
      -- Paso 8: una copia en varios tamaños ({ruta}.w{ancho}.webp) es de su foto.
      and not exists (select 1 from public.media m
                       where m.storage_path = regexp_replace(o.name, '\.w(320|640|960|1280)\.webp$', '')
                         and m.status = 'ready'
                         and (m.deleted_at is null or m.deleted_at > now() - interval '7 days'))
    order by o.created_at limit p_limit)
  union all
  (select 'deleted_media', 'store-media', m.storage_path, m.id
     from public.media m
    where m.deleted_at < now() - interval '7 days'
    order by m.deleted_at limit p_limit)
$$;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261027000300'::text
$$;
