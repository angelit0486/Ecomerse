-- =============================================================================
-- Correcciones de la revisión adversarial de los Pasos 2 y 3 del estudio
-- (docs/phases/ESTUDIO-PASOS-2-3-REVISION.md). Forward-only.
--
-- Dominios (E16 / ADR-037):
--   R-2  Una sola revisión viva por dominio: «Verificar ahora» y «Generar código»
--        adelantan la que ya está en cola en vez de abrir otra cadena.
--   R-3  «Verificar ahora» en un dominio vencido (`failed`) reinicia la ventana
--        de verificación en vez de no hacer nada.
--   R-1  (mitigación) Un hostname quitado o vencido en OTRA tienda ya no queda
--        bloqueado para siempre: se libera al agregarlo. Un `pending` ajeno sigue
--        bloqueando (ver el informe: decisión del propietario).
--   R-6  Sin `storefront.root_domain` configurado no se aceptan dominios.
--   R-7  `domains_set_primary` bloquea las filas de la tienda.
--   R-4  `system.domains_txt_matches`: el worker agrega el dominio al proveedor
--        solo cuando el TXT ya demuestra la propiedad.
-- Plantillas:
--   R-8  Un producto es «de ejemplo» solo con la etiqueta `ejemplo` Y el título
--        «Ejemplo · …» que pone la base: una etiqueta propia ya no lo borra ni
--        bloquea el lanzamiento.
-- Diseño:
--   R-9  Importar un diseño ya no borra el anuncio ni los accesos rápidos del
--        encabezado (son contenido de la tienda): solo cambia `logo_position`.
-- =============================================================================

-- R-2 ---------------------------------------------------------------------------
create or replace function app.domains_enqueue_check(p_store_id uuid, p_domain_id uuid, p_run_after timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update system.jobs j
     set run_after = least(j.run_after, p_run_after)
   where j.type = 'domains.verify' and j.status = 'queued' and j.payload ->> 'domain_id' = p_domain_id::text;
  if found then
    return;
  end if;
  perform app.enqueue_job('domains.verify', jsonb_build_object('domain_id', p_domain_id), p_store_id,
                          'domains.verify:' || p_domain_id || ':' || app.uuid_v7(), p_run_after, 3);
end
$$;
revoke all on function app.domains_enqueue_check(uuid, uuid, timestamptz) from public;

-- R-3 ---------------------------------------------------------------------------
create or replace function public.domains_request_check(p_store_id uuid, p_domain_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.domains_require_manager(p_store_id);
  update public.store_domains d
     set status = case when d.status = 'failed' then 'pending' else d.status end,
         check_started_at = case when d.status = 'failed' then now() else d.check_started_at end
   where d.id = p_domain_id and d.store_id = p_store_id and d.type = 'custom'
     and d.status in ('pending', 'verifying', 'failed');
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'domain';
  end if;
  perform app.domains_enqueue_check(p_store_id, p_domain_id, now());
end
$$;

-- R-1, R-6 ------------------------------------------------------------------------
create or replace function public.domains_add_custom(p_store_id uuid, p_hostname text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host  text := regexp_replace(lower(btrim(coalesce(p_hostname, ''))), '\.$', '');
  v_root  text;
  v_id    uuid;
  v_token text;
  v_other public.store_domains;
begin
  perform app.domains_require_manager(p_store_id);
  select lower(ps.value ->> 'domain') into v_root from public.platform_settings ps
   where ps.key = 'storefront.root_domain';
  if v_root is null then
    raise exception using errcode = 'P0001', message = 'internal', detail = 'platform_settings.storefront.root_domain';
  end if;
  if v_host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' or char_length(v_host) > 253 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'hostname';
  end if;
  if v_host = v_root or v_host like '%.' || v_root then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'platform_domain';
  end if;
  if (select count(*) from public.store_domains d
       where d.store_id = p_store_id and d.type = 'custom' and d.status <> 'removed') >= 2 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'too_many';
  end if;
  select * into v_other from public.store_domains d where d.hostname = v_host for update;
  if v_other.id is not null and v_other.store_id <> p_store_id then
    -- Quitado o vencido en otra tienda: se libera (queda en la auditoría).
    if v_other.type = 'custom' and v_other.status in ('removed', 'failed') then
      delete from public.store_domains d where d.id = v_other.id;
      perform audit.record('domain.released', 'store_domain', v_other.id,
                           (select s.organization_id from public.stores s where s.id = v_other.store_id),
                           v_other.store_id, jsonb_build_object('hostname', v_host, 'status', v_other.status), null);
      v_other := null;
    else
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'taken';
    end if;
  end if;
  if v_other.id is not null then
    if v_other.status <> 'removed' then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'taken';
    end if;
    v_id := v_other.id;
    update public.store_domains
       set status = 'pending', verified_at = null, last_checked_at = null, provider_ref = null,
           check_started_at = now()
     where id = v_id;
  else
    insert into public.store_domains (store_id, hostname, type, status, check_started_at)
    values (p_store_id, v_host, 'custom', 'pending', now()) returning id into v_id;
  end if;
  v_token := app.domains_new_token(v_id);
  perform app.domains_enqueue_check(p_store_id, v_id, now());
  perform audit.record('domain.added', 'store_domain', v_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('hostname', v_host));
  return jsonb_build_object('id', v_id, 'hostname', v_host, 'token', v_token);
end
$$;

-- R-7 ---------------------------------------------------------------------------
create or replace function public.domains_set_primary(p_store_id uuid, p_domain_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.domains_require_manager(p_store_id);
  perform 1 from public.store_domains d where d.store_id = p_store_id order by d.id for update;
  if not exists (select 1 from public.store_domains d
                  where d.id = p_domain_id and d.store_id = p_store_id and d.status = 'active') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'not_active';
  end if;
  update public.store_domains set is_primary = false where store_id = p_store_id and is_primary;
  update public.store_domains set is_primary = true where id = p_domain_id;
  perform audit.record('domain.primary_set', 'store_domain', p_domain_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, null);
end
$$;

-- R-4 ---------------------------------------------------------------------------
create or replace function system.domains_txt_matches(p_domain_id uuid, p_txt text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select d.verification_token_hash is not null and exists (
                     select 1 from unnest(coalesce(p_txt, '{}')) t
                      where sha256(convert_to(btrim(t, ' "'), 'UTF8')) = d.verification_token_hash)
                     from public.store_domains d where d.id = p_domain_id), false)
$$;
revoke all on function system.domains_txt_matches(uuid, text[]) from public;
grant execute on function system.domains_txt_matches(uuid, text[]) to system_worker;

-- R-8 ---------------------------------------------------------------------------
create or replace function app.product_is_sample(p_tags text[], p_title text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select 'ejemplo' = any (coalesce(p_tags, '{}')) and coalesce(p_title, '') like 'Ejemplo · %' $$;
revoke all on function app.product_is_sample(text[], text) from public;

create or replace function public.store_remove_sample_products(p_store_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  perform app.require_store_permission(p_store_id, 'products.delete');
  for v_id in select p.id from public.products p
               where p.store_id = p_store_id and p.deleted_at is null and app.product_is_sample(p.tags, p.title)
               order by p.id loop
    perform public.catalog_soft_delete_product(p_store_id, v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

create or replace function app.validate_store_for_launch(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_issues jsonb := app.validate_store_for_launch_regulatory(p_store_id);
begin
  if exists (select 1 from public.products p
              where p.store_id = p_store_id and p.deleted_at is null and app.product_is_sample(p.tags, p.title)) then
    v_issues := v_issues || jsonb_build_object('code', 'sample_products',
      'message', 'Quita los productos de ejemplo de la plantilla (etiqueta «ejemplo») antes de publicar.');
  end if;
  return v_issues;
end
$$;
revoke all on function app.validate_store_for_launch(uuid) from public;

-- R-9 ---------------------------------------------------------------------------
create or replace function public.appearance_import_design(p_store_id uuid, p_settings jsonb, p_sections jsonb,
                                                          p_expected_revision integer, p_source text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys    text[] := array['colors', 'typography', 'shape', 'header', 'product_page', 'listing'];
  v_current jsonb;
  v_header  jsonb;
  v_patch   jsonb;
  v_rev     integer;
begin
  perform app.theme_require_editor(p_store_id);
  if jsonb_typeof(p_settings) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_settings) k where not (k = any (v_keys)))
     or (p_settings ? 'header' and (jsonb_typeof(p_settings -> 'header') <> 'object'
         or exists (select 1 from jsonb_object_keys(p_settings -> 'header') k where k <> 'logo_position')))
     or p_source is null or p_source !~ '^(file|store:[0-9a-f-]{36})$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'design';
  end if;
  select coalesce(t.draft_settings, t.settings, '{}'::jsonb) into v_current
    from public.store_themes t where t.store_id = p_store_id;
  -- El anuncio y los accesos rápidos son de la tienda: se conservan.
  v_header := (coalesce(v_current -> 'header', '{}'::jsonb) - 'logo_position')
              || coalesce(p_settings -> 'header', '{}'::jsonb);
  select jsonb_object_agg(k, case when k = 'header'
                                  then case when v_header = '{}'::jsonb then 'null'::jsonb else v_header end
                                  else coalesce(p_settings -> k, 'null'::jsonb) end)
    into v_patch from unnest(v_keys) k;
  v_rev := public.appearance_save_theme_draft(p_store_id, v_patch, p_expected_revision);
  v_rev := public.appearance_save_home_draft(p_store_id, p_sections, v_rev);
  perform audit.record('theme.design_imported', 'store_theme', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('source', p_source));
  return v_rev;
end
$$;
