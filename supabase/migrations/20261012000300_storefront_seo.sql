-- =============================================================================
-- Fase 5 · SEO (F5-T05): hostname primario en los datos públicos de la tienda,
-- para canonical, Open Graph, JSON-LD y sitemap (GATE0 §22 «Canonical», §24).
-- Redefine storefront.get_store_public (última versión: 20261009000400).
-- =============================================================================
create or replace function storefront.get_store_public(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'name', s.name, 'handle', s.handle, 'status', s.status,
    'locale', s.locale, 'currency', s.currency, 'country', s.country,
    'primary_hostname', (select d.hostname from public.store_domains d
                          where d.store_id = s.id and d.is_primary and d.status = 'active'),
    'theme', jsonb_build_object('key', t.theme_key, 'version', t.theme_version,
                                'settings', coalesce(t.settings, '{}'::jsonb)),
    'logo', (select jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height)
               from public.media m
              where m.store_id = s.id and m.id = t.logo_media_id
                and m.status = 'ready' and m.deleted_at is null)
  )
  from public.stores s
  left join public.store_themes t on t.store_id = s.id
  where s.id = p_store_id and s.status <> 'closed'
$$;
