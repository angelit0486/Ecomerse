-- =============================================================================
-- E16 · Dominio propio (aprobado por el propietario el 2026-10-20). Contrato:
-- GATE0 «Dominio propio (P2)» y ADR-011: `store_domains(type = custom, status =
-- pending)` → `DomainProvider.add(hostname)` → TXT de propiedad
-- `_platform-verify.{hostname}` = token → job de verificación (cada 5 min durante
-- 72 h, luego diario hasta 14 días) → `active` / `failed`.
--
-- * El token se guarda solo como hash (sha256); se muestra al crearlo y se puede
--   generar uno nuevo (el anterior deja de valer).
-- * La base nunca hace llamadas de red (§44.10): el worker consulta el DNS y el
--   proveedor y entrega lo que vio a `system.domains_record_check`, que compara
--   el TXT con el hash. El panel no puede declarar un dominio verificado.
-- * Un dominio no puede estar bajo el dominio raíz de la plataforma.
-- * Hacer principal un dominio activo hace que la dirección de la plataforma
--   redirija a él (301, ya implementado en el proxy).
-- =============================================================================

-- Inicio de la ventana de verificación (72 h + 14 días); se reinicia al volver a
-- agregar el dominio o generar otro código.
alter table public.store_domains add column check_started_at timestamptz;

create or replace function app.domains_require_manager(p_store_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_aal2_user();
begin
  if not app.has_store_permission(p_store_id, 'domains.manage') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  return v_uid;
end
$$;
revoke all on function app.domains_require_manager(uuid) from public;

create or replace function app.domains_enqueue_check(p_store_id uuid, p_domain_id uuid, p_run_after timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  select app.enqueue_job('domains.verify', jsonb_build_object('domain_id', p_domain_id), p_store_id,
                         'domains.verify:' || p_domain_id || ':' || floor(extract(epoch from p_run_after) / 60)::bigint,
                         p_run_after, 3);
$$;
revoke all on function app.domains_enqueue_check(uuid, uuid, timestamptz) from public;

create or replace function app.domains_new_token(p_domain_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := 'pruva-' || replace(gen_random_uuid()::text, '-', '');
begin
  update public.store_domains
     set verification_token_hash = sha256(convert_to(v_token, 'UTF8'))
   where id = p_domain_id;
  return v_token;
end
$$;
revoke all on function app.domains_new_token(uuid) from public;

-- -----------------------------------------------------------------------------
-- Agregar un dominio propio: queda pendiente y se encola la primera revisión.
-- -----------------------------------------------------------------------------
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
begin
  perform app.domains_require_manager(p_store_id);
  select lower(ps.value ->> 'domain') into v_root from public.platform_settings ps
   where ps.key = 'storefront.root_domain';
  if v_host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' or char_length(v_host) > 253 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'hostname';
  end if;
  if v_root is not null and (v_host = v_root or v_host like '%.' || v_root) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'platform_domain';
  end if;
  if (select count(*) from public.store_domains d
       where d.store_id = p_store_id and d.type = 'custom' and d.status <> 'removed') >= 2 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'too_many';
  end if;
  -- Un dominio quitado de esta tienda se puede volver a agregar; de otra, nunca.
  select d.id into v_id from public.store_domains d where d.hostname = v_host;
  if v_id is not null then
    if not exists (select 1 from public.store_domains d
                    where d.id = v_id and d.store_id = p_store_id and d.status = 'removed') then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'taken';
    end if;
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

create or replace function public.domains_rotate_token(p_store_id uuid, p_domain_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  perform app.domains_require_manager(p_store_id);
  if not exists (select 1 from public.store_domains d
                  where d.id = p_domain_id and d.store_id = p_store_id and d.type = 'custom'
                    and d.status in ('pending', 'verifying', 'failed')) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'domain';
  end if;
  v_token := app.domains_new_token(p_domain_id);
  update public.store_domains set status = 'pending', check_started_at = now() where id = p_domain_id;
  perform app.domains_enqueue_check(p_store_id, p_domain_id, now());
  perform audit.record('domain.token_rotated', 'store_domain', p_domain_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, null);
  return v_token;
end
$$;

-- «Verificar ahora»: encola una revisión (como mucho una por minuto).
create or replace function public.domains_request_check(p_store_id uuid, p_domain_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.domains_require_manager(p_store_id);
  if not exists (select 1 from public.store_domains d
                  where d.id = p_domain_id and d.store_id = p_store_id and d.type = 'custom'
                    and d.status in ('pending', 'verifying', 'failed')) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'domain';
  end if;
  perform app.domains_enqueue_check(p_store_id, p_domain_id, now());
end
$$;

create or replace function public.domains_set_primary(p_store_id uuid, p_domain_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.domains_require_manager(p_store_id);
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

-- Quitar: si era el principal, vuelve la dirección de la plataforma.
create or replace function public.domains_remove(p_store_id uuid, p_domain_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.store_domains;
begin
  perform app.domains_require_manager(p_store_id);
  select * into v from public.store_domains d
   where d.id = p_domain_id and d.store_id = p_store_id and d.type = 'custom' and d.status <> 'removed'
   for update;
  if v.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'domain';
  end if;
  update public.store_domains set status = 'removed', is_primary = false, verification_token_hash = null
   where id = p_domain_id;
  if v.is_primary then
    update public.store_domains set is_primary = true
     where id = (select d.id from public.store_domains d
                  where d.store_id = p_store_id and d.type = 'platform_subdomain' and d.status = 'active'
                  order by d.created_at limit 1);
  end if;
  perform audit.record('domain.removed', 'store_domain', p_domain_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('hostname', v.hostname), null);
end
$$;

-- -----------------------------------------------------------------------------
-- Worker: qué revisar y qué se vio.
-- -----------------------------------------------------------------------------
create or replace function system.domains_check_target(p_domain_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('store_id', d.store_id, 'hostname', d.hostname, 'status', d.status,
                            'provider_ref', d.provider_ref)
    from public.store_domains d
   where d.id = p_domain_id and d.type = 'custom' and d.status in ('pending', 'verifying')
$$;

-- p_txt: los valores TXT de `_platform-verify.{hostname}` que vio el worker.
-- p_provider: 'ready' (DNS y certificado listos), 'pending' o 'not_configured'.
create or replace function system.domains_record_check(p_domain_id uuid, p_txt text[], p_provider text,
                                                       p_provider_ref text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v        public.store_domains;
  v_owned  boolean;
  v_status text;
  v_next   timestamptz;
begin
  if p_provider is null or p_provider not in ('ready', 'pending', 'not_configured') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'provider';
  end if;
  select * into v from public.store_domains d
   where d.id = p_domain_id and d.type = 'custom' and d.status in ('pending', 'verifying') for update;
  if v.id is null then
    return jsonb_build_object('status', 'skipped');
  end if;
  v_owned := v.verification_token_hash is not null and exists (
    select 1 from unnest(coalesce(p_txt, '{}')) t
     where sha256(convert_to(btrim(t, ' "'), 'UTF8')) = v.verification_token_hash);

  if v_owned and p_provider = 'ready' then
    v_status := 'active';
  elsif now() - coalesce(v.check_started_at, v.created_at) > interval '17 days' then
    v_status := 'failed';
  else
    v_status := 'verifying';
    v_next := case when now() - coalesce(v.check_started_at, v.created_at) < interval '72 hours' then now() + interval '5 minutes'
                   else now() + interval '1 day' end;
  end if;

  update public.store_domains
     set status = v_status, last_checked_at = now(),
         verified_at = case when v_status = 'active' then now() else verified_at end,
         provider_ref = coalesce(nullif(btrim(p_provider_ref), ''), provider_ref)
   where id = p_domain_id;
  if v_next is not null then
    perform app.domains_enqueue_check(v.store_id, p_domain_id, v_next);
  end if;
  if v_status <> v.status then
    perform audit.record('domain.' || v_status, 'store_domain', p_domain_id,
                         (select s.organization_id from public.stores s where s.id = v.store_id), v.store_id,
                         jsonb_build_object('status', v.status),
                         jsonb_build_object('status', v_status, 'owned', v_owned, 'provider', p_provider));
  end if;
  return jsonb_build_object('status', v_status, 'owned', v_owned, 'store_id', v.store_id,
                            'hostname', v.hostname);
end
$$;

revoke all on function public.domains_add_custom(uuid, text) from public;
revoke all on function public.domains_rotate_token(uuid, uuid) from public;
revoke all on function public.domains_request_check(uuid, uuid) from public;
revoke all on function public.domains_set_primary(uuid, uuid) from public;
revoke all on function public.domains_remove(uuid, uuid) from public;
grant execute on function public.domains_add_custom(uuid, text) to authenticated;
grant execute on function public.domains_rotate_token(uuid, uuid) to authenticated;
grant execute on function public.domains_request_check(uuid, uuid) to authenticated;
grant execute on function public.domains_set_primary(uuid, uuid) to authenticated;
grant execute on function public.domains_remove(uuid, uuid) to authenticated;
revoke all on function system.domains_check_target(uuid) from public;
revoke all on function system.domains_record_check(uuid, text[], text, text) from public;
grant execute on function system.domains_check_target(uuid) to system_worker;
grant execute on function system.domains_record_check(uuid, text[], text, text) to system_worker;
