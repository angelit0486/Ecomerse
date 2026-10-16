-- =============================================================================
-- Revisión de conversión (M8) — la fecha de apertura en los datos públicos
--
-- La insignia «Nuevo» marca lo que llega después de abrir la tienda: con todo el
-- catálogo «Nuevo» durante 30 días tras el lanzamiento, nada lo es. La tienda
-- pública necesita `launched_at` (dato no sensible: la fecha en que abrió).
-- Misma función que 20261017000200 más el campo; los permisos no cambian.
-- =============================================================================

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
    'primary_hostname', coalesce(
                          (select d.hostname from public.store_domains d
                            where d.store_id = s.id and d.is_primary and d.status = 'active'),
                          (select d.hostname from public.store_domains d
                            where d.store_id = s.id and d.type = 'platform_subdomain' and d.status = 'active'
                            order by d.created_at limit 1)),
    -- Contacto comercial de la tienda (§20.2: email, teléfono; WhatsApp, dirección
    -- y horario van en el tema).
    'contact', jsonb_strip_nulls(jsonb_build_object('email', s.contact_email, 'phone', s.contact_phone)),
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
                     and m.status = 'ready' and m.deleted_at is null)
  )
  from public.stores s
  left join public.store_themes t on t.store_id = s.id
  where s.id = p_store_id and s.status <> 'closed'
$$;
