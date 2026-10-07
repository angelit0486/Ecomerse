-- =============================================================================
-- Fase 7 · Ajustes → Pagos (F7-T06): onboarding de Stripe Connect (A-01).
--
-- * La cuenta conectada la crea el servidor con la API de Stripe y la registra
--   el worker (system.*): ningún usuario puede asociar un acct_ arbitrario.
-- * El estado `active` solo lo fija system.stripe_sync_account con lo que
--   responde Stripe (charges_enabled), desde el retorno del onboarding o el
--   webhook account.updated. La tienda solo puede desactivarla o reactivarla
--   (reactivar = pendiente hasta la siguiente sincronización).
-- =============================================================================

create or replace function public.payments_get_stripe(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'payments.manage');
  return jsonb_build_object(
    'store', (select jsonb_build_object('country', s.country, 'contact_email', s.contact_email)
                from public.stores s where s.id = p_store_id),
    'account', (select jsonb_build_object('id', a.id, 'account_id', a.public_config ->> 'stripe_account_id',
                                          'status', a.status, 'mode', a.mode,
                                          'details_submitted', coalesce((a.public_config ->> 'details_submitted')::boolean, false))
                  from public.payment_accounts a
                 where a.store_id = p_store_id and a.provider = 'stripe'
                 order by a.created_at limit 1));
end
$$;

-- Registra la cuenta creada por el servidor y devuelve el acct_ vigente.
-- Idempotente: si la tienda ya tiene una cuenta de Stripe, la conserva (la creación en Stripe usa la misma clave
-- de idempotencia por tienda).
create or replace function system.stripe_attach_account(p_store_id uuid, p_account_id text, p_mode text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid;
  v_existing text;
begin
  if p_account_id is null or p_account_id !~ '^acct_[A-Za-z0-9]{8,64}$' or p_mode not in ('test', 'live') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'account_id';
  end if;
  perform 1 from public.stores s where s.id = p_store_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'store';
  end if;
  select a.public_config ->> 'stripe_account_id' into v_existing from public.payment_accounts a
   where a.store_id = p_store_id and a.provider = 'stripe' order by a.created_at limit 1;
  if v_existing is not null then
    return v_existing;
  end if;
  insert into public.payment_accounts (store_id, provider, mode, status, display_name, public_config)
  values (p_store_id, 'stripe', p_mode, 'pending', 'Tarjeta de crédito o débito',
          jsonb_build_object('stripe_account_id', p_account_id, 'details_submitted', false))
  returning id into v_id;
  perform audit.record('payments.stripe_connected', 'payment_account', v_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('status', 'pending', 'mode', p_mode));
  return p_account_id;
end
$$;

-- Refleja el estado que devolvió Stripe. Una cuenta desactivada por la tienda
-- sigue desactivada.
create or replace function system.stripe_sync_account(p_account_id text, p_charges_enabled boolean,
                                                      p_details_submitted boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct public.payment_accounts;
  v_new  text;
begin
  select * into v_acct from public.payment_accounts a
   where a.provider = 'stripe' and a.public_config ->> 'stripe_account_id' = p_account_id for update;
  if v_acct.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'payment_account';
  end if;
  v_new := case when v_acct.status = 'disabled' then 'disabled'
                when coalesce(p_charges_enabled, false) then 'active'
                else 'pending' end;
  if v_new = 'active' and exists (select 1 from public.payment_accounts o
                                   where o.store_id = v_acct.store_id and o.provider = 'stripe'
                                     and o.status = 'active' and o.id <> v_acct.id) then
    v_new := 'pending';
  end if;
  update public.payment_accounts
     set status = v_new,
         public_config = public_config || jsonb_build_object('details_submitted', coalesce(p_details_submitted, false))
   where id = v_acct.id;
  if v_new <> v_acct.status then
    perform audit.record('payments.stripe_status_changed', 'payment_account', v_acct.id,
                         (select s.organization_id from public.stores s where s.id = v_acct.store_id),
                         v_acct.store_id, jsonb_build_object('status', v_acct.status),
                         jsonb_build_object('status', v_new));
  end if;
  return v_new;
end
$$;

-- La tienda desactiva o reactiva el cobro con tarjeta; reactivar nunca activa
-- directamente: queda pendiente hasta que Stripe confirme.
create or replace function public.payments_set_stripe_enabled(p_store_id uuid, p_enabled boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct public.payment_accounts;
  v_new  text;
begin
  perform app.require_store_permission(p_store_id, 'payments.manage');
  select * into v_acct from public.payment_accounts a
   where a.store_id = p_store_id and a.provider = 'stripe' order by a.created_at limit 1 for update;
  if v_acct.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'payment_account';
  end if;
  v_new := case when coalesce(p_enabled, false) then (case when v_acct.status = 'disabled' then 'pending'
                                                          else v_acct.status end)
                else 'disabled' end;
  if v_new <> v_acct.status then
    update public.payment_accounts set status = v_new where id = v_acct.id;
    perform audit.record('payments.stripe_status_changed', 'payment_account', v_acct.id,
                         (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                         jsonb_build_object('status', v_acct.status), jsonb_build_object('status', v_new));
  end if;
  return v_new;
end
$$;

revoke all on function public.payments_get_stripe(uuid) from public;
revoke all on function system.stripe_attach_account(uuid, text, text) from public;
revoke all on function system.stripe_sync_account(text, boolean, boolean) from public;
revoke all on function public.payments_set_stripe_enabled(uuid, boolean) from public;
grant execute on function public.payments_get_stripe(uuid) to authenticated;
grant execute on function public.payments_set_stripe_enabled(uuid, boolean) to authenticated;
grant execute on function system.stripe_attach_account(uuid, text, text) to system_worker;
grant execute on function system.stripe_sync_account(text, boolean, boolean) to system_worker;
