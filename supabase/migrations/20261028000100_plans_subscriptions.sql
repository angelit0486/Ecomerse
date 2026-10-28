-- =============================================================================
-- Fase 10 · F10-T01: planes, suscripciones manuales y límites desde la consola
-- (GATE0 §19; AUTONOMOUS_PLAN F10). Hasta hoy los planes y el estado de la
-- suscripción solo se cambiaban con SQL: vender la plataforma a otro comercio
-- exigía tocar la base a mano.
--
-- - Planes: platform_owner/platform_admin los crean y editan con TODOS sus
--   límites numéricos (una clave ausente vale 0 = cerrado, §19.3; pedirlos todos
--   evita un plan que bloquee sin querer). Las funciones booleanas ausentes = no.
-- - Suscripción (cobro manual, §19.5): activar por N días, extender la prueba,
--   marcar pago vencido con gracia, pausar, cancelar y cambiar de plan. Siempre
--   con motivo y auditoría. Cancelar deja la organización sin suscripción
--   vigente (= suspended); activar después crea una nueva con el plan indicado.
-- - Avance automático (en el mantenimiento): periodo pagado vencido → past_due
--   con 7 días de gracia; gracia vencida → paused (solo lectura); paused más de
--   30 días → suspended (§19.4). Sin fecha de fin de periodo no avanza nada.
-- - Excepciones por organización (overrides) con motivo y vencimiento opcional.
-- - "Plan y uso": la persona dueña o administradora de la organización ve su
--   plan, su estado y su uso en vivo (org.billing.read). Sin notas internas ni
--   ids del proveedor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Desde cuándo está pausada (para pasar a suspended a los 30 días).
-- -----------------------------------------------------------------------------
-- Se llena solo (trigger): cualquier escritura que pause, aunque no lo sepa, la fecha.
alter table public.subscriptions add column paused_at timestamptz;
update public.subscriptions set paused_at = updated_at where status = 'paused';

create function app.subscriptions_track_pause()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'paused' then
    new.paused_at := coalesce(new.paused_at, now());
  else
    new.paused_at := null;
  end if;
  return new;
end
$$;
revoke all on function app.subscriptions_track_pause() from public;
create trigger subscriptions_track_pause before insert or update on public.subscriptions
  for each row execute function app.subscriptions_track_pause();

create or replace function app.org_access_mode(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when o.id is null or o.status <> 'active' then 'suspended'
    when s.id is null then 'suspended'
    when s.status = 'active' then 'full'
    when s.status = 'trialing' then case when s.trial_ends_at > now() then 'full' else 'read_only' end
    when s.status = 'past_due' then case when s.grace_ends_at > now() then 'full' else 'read_only' end
    when s.status = 'paused' then
      case when s.paused_at > now() - interval '30 days' then 'read_only' else 'suspended' end
    else 'suspended'
  end
  from (select 1) as one
  left join public.organizations o on o.id = p_org
  left join public.subscriptions s on s.organization_id = p_org and s.status <> 'cancelled'
$$;

-- -----------------------------------------------------------------------------
-- 2. Lectura compartida: plan, estado, límites y uso de una organización.
-- -----------------------------------------------------------------------------
create function app.org_billing_json(p_org uuid, p_internal boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub  public.subscriptions;
  v_plan public.plans;
  v_ents jsonb;
begin
  select s.* into v_sub from public.subscriptions s
   where s.organization_id = p_org and s.status <> 'cancelled';
  if v_sub.id is not null then
    select p.* into v_plan from public.plans p where p.id = v_sub.plan_id;
  end if;

  -- Valor efectivo por clave (override vigente ▷ plan ▷ 0) y uso donde se mide.
  select coalesce(jsonb_object_agg(k.key, jsonb_build_object(
           'type', app.entitlement_type(k.key),
           'value', case app.entitlement_type(k.key)
                      when 'int' then to_jsonb(case when k.key = 'max_variants_per_product'
                                                    then coalesce(ov.value_int, pe.value_int, 100)
                                                    else coalesce(ov.value_int, pe.value_int, 0) end)
                      else to_jsonb(coalesce(ov.value_bool, pe.value_bool, false)) end,
           'used', case when k.key in ('max_stores', 'max_staff', 'max_products', 'storage_mb')
                        then to_jsonb(app.current_usage(p_org, k.key)) end,
           'override', ov.key is not null,
           'override_expires_at', ov.expires_at,
           'override_reason', case when p_internal then ov.reason end)), '{}'::jsonb)
    into v_ents
    from unnest(array['max_stores', 'max_products', 'max_variants_per_product', 'max_staff',
                      'max_locations', 'max_custom_domains', 'storage_mb', 'advanced_analytics',
                      'abandoned_cart', 'custom_roles', 'api_access', 'remove_platform_branding',
                      'custom_domains']) as k(key)
    left join public.plan_entitlements pe on pe.plan_id = v_sub.plan_id and pe.key = k.key
    left join public.organization_entitlement_overrides ov
           on ov.organization_id = p_org and ov.key = k.key
          and (ov.expires_at is null or ov.expires_at > now());

  return jsonb_build_object(
    'organization_id', p_org,
    'access_mode', app.org_access_mode(p_org),
    'plan', case when v_plan.id is not null
                 then jsonb_build_object('key', v_plan.key, 'name', v_plan.name) end,
    'subscription', case when v_sub.id is not null then jsonb_strip_nulls(jsonb_build_object(
        'status', v_sub.status,
        'current_period_start', v_sub.current_period_start,
        'current_period_end', v_sub.current_period_end,
        'trial_ends_at', v_sub.trial_ends_at,
        'grace_ends_at', v_sub.grace_ends_at,
        'paused_at', v_sub.paused_at,
        'provider', case when p_internal then v_sub.provider end,
        'notes', case when p_internal then v_sub.notes end)) end,
    'entitlements', v_ents);
end
$$;
revoke all on function app.org_billing_json(uuid, boolean) from public;

-- Panel de la tienda: "Plan y uso" (dueña o administradora de la organización).
create function public.org_plan_usage(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select s.organization_id from public.stores s where s.id = p_store_id);
begin
  if v_org is null or not app.has_org_permission(v_org, 'org.billing.read') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  return app.org_billing_json(v_org, false);
end
$$;
revoke all on function public.org_plan_usage(uuid) from public;
grant execute on function public.org_plan_usage(uuid) to authenticated;

-- Consola: lo mismo con notas internas, motivo de cada excepción y los planes.
create function public.platform_get_org_billing(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin', 'platform_support']);
  select o.* into v_org from public.organizations o where o.id = p_organization_id;
  if v_org.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'organization';
  end if;
  return app.org_billing_json(v_org.id, true)
    || jsonb_build_object('organization', jsonb_build_object(
         'id', v_org.id, 'name', v_org.name, 'slug', v_org.slug, 'status', v_org.status,
         'billing_email', v_org.billing_email));
end
$$;
revoke all on function public.platform_get_org_billing(uuid) from public;
grant execute on function public.platform_get_org_billing(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Planes.
-- -----------------------------------------------------------------------------
create function public.platform_list_plans()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin', 'platform_support']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', p.key, 'name', p.name, 'status', p.status, 'sort', p.sort,
             'subscribers', (select count(*) from public.subscriptions s
                              where s.plan_id = p.id and s.status <> 'cancelled'),
             'entitlements', (select coalesce(jsonb_object_agg(e.key,
                                       coalesce(to_jsonb(e.value_int), to_jsonb(e.value_bool))), '{}'::jsonb)
                                from public.plan_entitlements e where e.plan_id = p.id))
           order by p.sort, p.name)
      from public.plans p
  ), '[]'::jsonb);
end
$$;
revoke all on function public.platform_list_plans() from public;
grant execute on function public.platform_list_plans() to authenticated;

create function public.platform_save_plan(p_key text, p_name text, p_status text, p_sort integer,
                                          p_entitlements jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_plan   uuid;
  v_key    text;
  v_val    jsonb;
  v_ints   text[] := array['max_stores', 'max_products', 'max_variants_per_product', 'max_staff',
                             'max_locations', 'max_custom_domains', 'storage_mb'];
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin']);
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{1,30}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'key';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 60 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'name';
  end if;
  if p_status is null or p_status not in ('active', 'legacy', 'hidden') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
  if p_entitlements is null or jsonb_typeof(p_entitlements) <> 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'entitlements';
  end if;
  -- Todos los límites numéricos, explícitos (clave ausente = 0, §19.3).
  foreach v_key in array v_ints loop
    if jsonb_typeof(p_entitlements -> v_key) is distinct from 'number'
       or (p_entitlements ->> v_key)::numeric <> floor((p_entitlements ->> v_key)::numeric)
       or (p_entitlements ->> v_key)::numeric not between 0 and 1000000 then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = v_key;
    end if;
  end loop;
  for v_key, v_val in select * from jsonb_each(p_entitlements) loop
    if app.entitlement_type(v_key) is null
       or (app.entitlement_type(v_key) = 'bool' and jsonb_typeof(v_val) <> 'boolean') then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = v_key;
    end if;
  end loop;

  select jsonb_build_object('name', p.name, 'status', p.status, 'entitlements',
           (select jsonb_object_agg(e.key, coalesce(to_jsonb(e.value_int), to_jsonb(e.value_bool)))
              from public.plan_entitlements e where e.plan_id = p.id))
    into v_before from public.plans p where p.key = p_key;

  insert into public.plans (key, name, status, sort)
  values (p_key, btrim(p_name), p_status, coalesce(p_sort, 0))
  on conflict (key) do update set name = excluded.name, status = excluded.status, sort = excluded.sort
  returning id into v_plan;

  delete from public.plan_entitlements e where e.plan_id = v_plan;
  insert into public.plan_entitlements (plan_id, key, value_int, value_bool)
  select v_plan, j.key,
         case when app.entitlement_type(j.key) = 'int' then (j.value #>> '{}')::integer end,
         case when app.entitlement_type(j.key) = 'bool' then (j.value #>> '{}')::boolean end
    from jsonb_each(p_entitlements) j;

  perform audit.record('plan.saved', 'plan', v_plan, null, null, v_before,
                       jsonb_build_object('name', btrim(p_name), 'status', p_status,
                                          'entitlements', p_entitlements));
end
$$;
revoke all on function public.platform_save_plan(text, text, text, integer, jsonb) from public;
grant execute on function public.platform_save_plan(text, text, text, integer, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Suscripción manual (§19.5) con transiciones explícitas.
-- -----------------------------------------------------------------------------
create function public.platform_set_subscription(p_organization_id uuid, p_action text, p_plan_key text,
                                                 p_days integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(p_reason);
  v_org    public.organizations;
  v_sub    public.subscriptions;
  v_after  public.subscriptions;
  v_plan   uuid;
  v_days   integer;
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin']);
  if v_reason is null or char_length(v_reason) not between 5 and 500 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'reason';
  end if;
  if p_action is null or p_action not in
       ('activate', 'extend_trial', 'past_due', 'pause', 'cancel', 'change_plan') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'action';
  end if;
  if p_days is not null and p_days not between 1 and 400 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'days';
  end if;
  select o.* into v_org from public.organizations o where o.id = p_organization_id for update;
  if v_org.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'organization';
  end if;
  if v_org.status = 'closed' then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'organization_closed';
  end if;
  if p_plan_key is not null then
    select p.id into v_plan from public.plans p where p.key = p_plan_key and p.status <> 'hidden';
    if v_plan is null then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'plan';
    end if;
  end if;

  select s.* into v_sub from public.subscriptions s
   where s.organization_id = v_org.id and s.status <> 'cancelled' for update;

  if v_sub.id is null then
    -- Sin suscripción vigente solo se puede empezar una (activa o de prueba) con plan.
    if p_action not in ('activate', 'extend_trial') or v_plan is null then
      raise exception using errcode = 'P0001', message = 'conflict', detail = 'no_subscription';
    end if;
    insert into public.subscriptions (organization_id, plan_id, status, current_period_start,
                                      current_period_end, trial_ends_at, provider)
    values (v_org.id, v_plan,
            case p_action when 'activate' then 'active' else 'trialing' end, now(),
            case p_action when 'activate' then now() + make_interval(days => coalesce(p_days, 30)) end,
            case p_action when 'extend_trial' then now() + make_interval(days => coalesce(p_days, 14)) end,
            'manual')
    returning * into v_after;
  else
    if p_action = 'change_plan' and v_plan is null then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'plan';
    end if;
    v_days := coalesce(p_days, case p_action when 'activate' then 30 when 'extend_trial' then 14
                                             when 'past_due' then 7 end);
    update public.subscriptions s set
      plan_id = coalesce(v_plan, s.plan_id),
      status = case p_action when 'activate' then 'active' when 'extend_trial' then 'trialing'
                             when 'past_due' then 'past_due' when 'pause' then 'paused'
                             when 'cancel' then 'cancelled' else s.status end,
      current_period_start = case when p_action = 'activate' then now() else s.current_period_start end,
      -- Activar suma los días al final del periodo vigente si aún no vence (pago adelantado).
      current_period_end = case when p_action = 'activate'
                                then greatest(coalesce(s.current_period_end, now()), now())
                                     + make_interval(days => v_days)
                                else s.current_period_end end,
      trial_ends_at = case when p_action = 'extend_trial' then now() + make_interval(days => v_days)
                           when p_action in ('activate', 'past_due', 'pause', 'cancel') then null
                           else s.trial_ends_at end,
      grace_ends_at = case when p_action = 'past_due' then now() + make_interval(days => v_days)
                           when p_action in ('activate', 'extend_trial', 'pause', 'cancel') then null
                           else s.grace_ends_at end
     -- paused_at la fija y la borra el trigger subscriptions_track_pause.
     where s.id = v_sub.id
    returning * into v_after;
  end if;

  perform audit.record('subscription.' || p_action, 'subscription', v_after.id, v_org.id, null,
                       case when v_sub.id is not null then to_jsonb(v_sub) - 'notes' end,
                       to_jsonb(v_after) - 'notes', v_reason);
end
$$;
revoke all on function public.platform_set_subscription(uuid, text, text, integer, text) from public;
grant execute on function public.platform_set_subscription(uuid, text, text, integer, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Excepciones por organización (p_value null = quitarla).
-- -----------------------------------------------------------------------------
create function public.platform_set_entitlement_override(p_organization_id uuid, p_key text, p_value jsonb,
                                                         p_expires_at timestamptz, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_platform_role(array['platform_owner', 'platform_admin']);
  v_reason text := btrim(p_reason);
  v_type   text := app.entitlement_type(p_key);
  v_before jsonb;
begin
  if v_type is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'key';
  end if;
  if v_reason is null or char_length(v_reason) not between 5 and 500 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'reason';
  end if;
  if not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'organization';
  end if;
  if p_value is not null and (
       (v_type = 'int' and (jsonb_typeof(p_value) <> 'number'
                            or (p_value #>> '{}')::numeric <> floor((p_value #>> '{}')::numeric)
                            or (p_value #>> '{}')::numeric not between 0 and 1000000))
       or (v_type = 'bool' and jsonb_typeof(p_value) <> 'boolean')) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'value';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'expires_at';
  end if;

  select to_jsonb(o) into v_before from public.organization_entitlement_overrides o
   where o.organization_id = p_organization_id and o.key = p_key;
  delete from public.organization_entitlement_overrides o
   where o.organization_id = p_organization_id and o.key = p_key;
  if p_value is not null then
    insert into public.organization_entitlement_overrides
      (organization_id, key, value_int, value_bool, reason, expires_at, created_by)
    values (p_organization_id, p_key,
            case when v_type = 'int' then (p_value #>> '{}')::integer end,
            case when v_type = 'bool' then (p_value #>> '{}')::boolean end,
            v_reason, p_expires_at, v_uid);
  end if;
  perform audit.record(case when p_value is null then 'entitlement_override.removed'
                            else 'entitlement_override.set' end,
                       'organization', p_organization_id, p_organization_id, null, v_before,
                       case when p_value is not null then jsonb_build_object(
                         'key', p_key, 'value', p_value, 'expires_at', p_expires_at) end,
                       v_reason);
end
$$;
revoke all on function public.platform_set_entitlement_override(uuid, text, jsonb, timestamptz, text) from public;
grant execute on function public.platform_set_entitlement_override(uuid, text, jsonb, timestamptz, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Avance automático de los estados (lo llama el mantenimiento).
-- -----------------------------------------------------------------------------
create function system.subscriptions_advance()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   record;
  v_count integer := 0;
begin
  for v_row in
    update public.subscriptions s
       set status = 'past_due', grace_ends_at = now() + interval '7 days'
     where s.status = 'active' and s.current_period_end is not null and s.current_period_end <= now()
    returning s.id, s.organization_id, 'past_due'::text as to_status
  loop
    perform audit.record('subscription.auto_past_due', 'subscription', v_row.id, v_row.organization_id);
    v_count := v_count + 1;
  end loop;
  for v_row in
    update public.subscriptions s
       set status = 'paused', grace_ends_at = null
     where s.status = 'past_due' and s.grace_ends_at <= now()
    returning s.id, s.organization_id
  loop
    perform audit.record('subscription.auto_paused', 'subscription', v_row.id, v_row.organization_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;
revoke all on function system.subscriptions_advance() from public;
grant execute on function system.subscriptions_advance() to system_worker;

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
  -- F10: periodos vencidos → pago pendiente → pausa (§19.4). Solo toca filas vencidas.
  perform system.subscriptions_advance();
end
$$;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261028000100'::text
$$;
