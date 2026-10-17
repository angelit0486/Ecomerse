-- =============================================================================
-- Fase 5 · Mercado Pago Checkout Pro (ADR-028). Contrato: GATE0 §18.2-18.6, CF-04.
--
-- * La plataforma opera con UNA credencial de Mercado Pago (variables de entorno);
--   la cuenta de pago de la tienda guarda solo el `mp_user_id` (collector) que
--   devolvió /users/me al conectarla. Ningún secreto por tienda (como A-01).
--   Un `mp_user_id` pertenece a una sola tienda.
-- * Conectar lo hace el servidor tras validar la credencial (system.*): nadie
--   puede asociar un collector arbitrario desde el navegador.
-- * Mercado Pago permite varios cobros por preferencia: un cobro aprobado
--   distinto del ya registrado deja el pedido en atención (reembolso), nunca se
--   ignora en silencio.
-- * Se amplían a `mercadopago` la cuenta del webhook, la reconciliación de pagos
--   y de reembolsos, y el registro del id del reembolso; el resto del ciclo
--   (apply_payment_status, apply_refund_result) ya es genérico.
-- =============================================================================

alter table public.payment_accounts drop constraint payment_accounts_provider_check;
alter table public.payment_accounts
  add constraint payment_accounts_provider_check check (provider in ('manual', 'fake', 'stripe', 'mercadopago'));
alter table public.payments drop constraint payments_provider_check;
alter table public.payments
  add constraint payments_provider_check check (provider in ('manual', 'fake', 'stripe', 'mercadopago'));
alter table public.payment_accounts
  add constraint payment_accounts_mercadopago_config check (
    provider <> 'mercadopago' or coalesce(public_config ->> 'mp_user_id', '') ~ '^[0-9]{1,20}$');
create unique index payment_accounts_mercadopago_uq on public.payment_accounts ((public_config ->> 'mp_user_id'))
  where provider = 'mercadopago' and status <> 'disabled';

-- -----------------------------------------------------------------------------
-- Cuenta del webhook (§18.4.1). Sin filtro de estado: los cobros en curso de una
-- cuenta desactivada se siguen aplicando (Gate F7).
-- -----------------------------------------------------------------------------
create or replace function system.payment_account_for_webhook(p_provider text, p_external_account text)
returns table (id uuid, store_id uuid, status text, mode text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.store_id, a.status, a.mode
    from public.payment_accounts a
   where a.provider = p_provider
     and ((p_provider = 'stripe' and a.public_config ->> 'stripe_account_id' = p_external_account)
          or (p_provider = 'mercadopago' and a.public_config ->> 'mp_user_id' = p_external_account))
   order by (a.status <> 'disabled') desc, a.created_at desc
   limit 1
$$;

-- -----------------------------------------------------------------------------
-- Reconciliación (§18.5): intentos abiertos de Stripe y de Mercado Pago.
-- -----------------------------------------------------------------------------
create or replace function system.payments_to_reconcile(p_limit integer default 100)
returns table (payment_id uuid, account jsonb, provider_checkout_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, jsonb_build_object('id', a.id, 'provider', a.provider, 'mode', a.mode,
                                  'public_config', a.public_config), p.provider_checkout_id
    from public.payments p
    join public.payment_accounts a on a.store_id = p.store_id and a.id = p.payment_account_id
    join public.orders o on o.store_id = p.store_id and o.id = p.order_id
   where (p.status in ('created', 'pending', 'authorized')
          -- Intentos cancelados por la tienda con el cobro aún abierto en el proveedor (≤ 2 días).
          or (p.status = 'cancelled' and p.created_at > now() - interval '2 days'))
     and p.provider in ('stripe', 'mercadopago')
     and p.provider_checkout_id is not null and p.created_at < now() - interval '15 minutes'
     and o.status in ('pending_payment', 'cancelled')
     and (p.last_synced_at is null or p.last_synced_at < now() - interval '10 minutes')
   order by p.created_at
   limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

create or replace function system.refunds_to_reconcile(p_limit integer default 100)
returns table (refund_id uuid, provider_refund_id text, age_hours numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.provider_refund_id, extract(epoch from now() - r.created_at) / 3600
    from public.refunds r
    join public.payments p on p.store_id = r.store_id and p.id = r.payment_id
   where r.status = 'pending' and p.provider in ('stripe', 'mercadopago')
     and r.created_at < now() - interval '15 minutes'
     and not exists (select 1 from system.jobs j
                      where j.dedupe_key = 'refund.execute:' || r.id and j.status in ('queued', 'running'))
   order by r.created_at
   limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

-- Id del reembolso en el proveedor (para CONSULTARLO en los reintentos): `re_…`
-- de Stripe o numérico de Mercado Pago, según el proveedor del intento.
create or replace function system.record_refund_provider_ref(p_refund_id uuid, p_provider_refund_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.refunds r set provider_refund_id = left(p_provider_refund_id, 200)
    from public.payments p
   where r.id = p_refund_id and r.status = 'pending' and r.provider_refund_id is null
     and p.store_id = r.store_id and p.id = r.payment_id
     and ((p.provider = 'stripe' and p_provider_refund_id ~ '^re_[A-Za-z0-9_]{6,200}$')
          or (p.provider = 'mercadopago' and p_provider_refund_id ~ '^[0-9]{1,20}$'))
$$;

-- -----------------------------------------------------------------------------
-- Aplicar un cobro de Mercado Pago. Un cobro aprobado distinto del registrado
-- en un intento ya pagado es un segundo cobro: atención y reembolso manual.
-- Solo un cobro aprobado fija `provider_payment_id` (el que se reembolsa).
-- -----------------------------------------------------------------------------
create or replace function system.apply_mercadopago_payment(p_payment_id uuid, p_payment jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay   public.payments;
  v_order public.orders;
  v_mp_id text := nullif(p_payment ->> 'provider_payment_id', '');
begin
  select * into v_pay from public.payments p where p.id = p_payment_id and p.provider = 'mercadopago';
  if v_pay.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'payment';
  end if;
  if v_pay.status = 'succeeded' and p_payment ->> 'status' = 'succeeded' and v_mp_id is not null
     and v_pay.provider_payment_id is not null and v_pay.provider_payment_id <> v_mp_id
     and coalesce(p_payment ->> 'external_reference', '') = v_pay.id::text then
    select * into v_order from public.orders o where o.store_id = v_pay.store_id and o.id = v_pay.order_id for update;
    if not exists (select 1 from public.order_events e
                    where e.order_id = v_order.id and e.type = 'payment.duplicate'
                      and e.metadata ->> 'provider_payment_id' = v_mp_id) then
      perform app.set_order_actor('system');
      update public.orders set needs_attention = true where id = v_order.id;
      insert into public.order_events (store_id, order_id, type, message, actor_type, metadata)
      values (v_order.store_id, v_order.id, 'payment.duplicate', 'Cobro adicional: requiere reembolso', 'system',
              jsonb_build_object('payment_id', v_pay.id, 'provider_payment_id', left(v_mp_id, 200)));
    end if;
    return jsonb_build_object('outcome', 'duplicate');
  end if;
  return system.apply_payment_status(
    p_payment_id,
    case when p_payment ->> 'status' in ('succeeded', 'refunded', 'partially_refunded') then p_payment
         else p_payment - 'provider_payment_id' end);
end
$$;

-- -----------------------------------------------------------------------------
-- Ajustes → Pagos (payments.manage).
-- -----------------------------------------------------------------------------
create or replace function public.payments_get_mercadopago(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'payments.manage');
  return jsonb_build_object(
    'account', (select jsonb_build_object('id', a.id, 'user_id', a.public_config ->> 'mp_user_id',
                                          'status', a.status, 'mode', a.mode)
                  from public.payment_accounts a
                 where a.store_id = p_store_id and a.provider = 'mercadopago'
                 order by a.created_at desc limit 1));
end
$$;

-- Registra la cuenta validada por el servidor (/users/me). Idempotente: si la
-- tienda ya tiene esa cuenta, la reactiva; otra tienda con el mismo collector → conflicto.
create or replace function system.mercadopago_attach_account(p_store_id uuid, p_user_id text, p_mode text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct public.payment_accounts;
  v_id   uuid;
begin
  if p_user_id is null or p_user_id !~ '^[0-9]{1,20}$' or p_mode not in ('test', 'live') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'user_id';
  end if;
  perform 1 from public.stores s where s.id = p_store_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'store';
  end if;
  if exists (select 1 from public.payment_accounts a
              where a.provider = 'mercadopago' and a.public_config ->> 'mp_user_id' = p_user_id
                and a.store_id <> p_store_id and a.status <> 'disabled') then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'mercadopago_account_in_use';
  end if;
  select * into v_acct from public.payment_accounts a
   where a.store_id = p_store_id and a.provider = 'mercadopago' order by a.created_at desc limit 1 for update;
  if v_acct.id is not null and v_acct.public_config ->> 'mp_user_id' = p_user_id and v_acct.mode = p_mode then
    if v_acct.status <> 'active' then
      update public.payment_accounts set status = 'active' where id = v_acct.id;
      perform audit.record('payments.mercadopago_status_changed', 'payment_account', v_acct.id,
                           (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                           jsonb_build_object('status', v_acct.status), jsonb_build_object('status', 'active'));
    end if;
    return 'active';
  end if;
  -- Otra credencial: la cuenta anterior queda desactivada (su historial se conserva).
  if v_acct.id is not null then
    update public.payment_accounts set status = 'disabled' where id = v_acct.id and status <> 'disabled';
  end if;
  insert into public.payment_accounts (store_id, provider, mode, status, display_name, public_config)
  values (p_store_id, 'mercadopago', p_mode, 'active', 'Mercado Pago',
          jsonb_build_object('mp_user_id', p_user_id))
  returning id into v_id;
  perform audit.record('payments.mercadopago_connected', 'payment_account', v_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('status', 'active', 'mode', p_mode));
  return 'active';
end
$$;

create or replace function public.payments_set_mercadopago_enabled(p_store_id uuid, p_enabled boolean)
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
   where a.store_id = p_store_id and a.provider = 'mercadopago' order by a.created_at desc limit 1 for update;
  if v_acct.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'payment_account';
  end if;
  v_new := case when coalesce(p_enabled, false) then 'active' else 'disabled' end;
  if v_new = 'active' and exists (select 1 from public.payment_accounts a
                                   where a.provider = 'mercadopago' and a.store_id <> p_store_id
                                     and a.public_config ->> 'mp_user_id' = v_acct.public_config ->> 'mp_user_id'
                                     and a.status <> 'disabled') then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'mercadopago_account_in_use';
  end if;
  if v_new <> v_acct.status then
    update public.payment_accounts set status = v_new where id = v_acct.id;
    perform audit.record('payments.mercadopago_status_changed', 'payment_account', v_acct.id,
                         (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                         jsonb_build_object('status', v_acct.status), jsonb_build_object('status', v_new));
  end if;
  return v_new;
end
$$;

revoke all on function system.record_refund_provider_ref(uuid, text) from public;
revoke all on function system.apply_mercadopago_payment(uuid, jsonb) from public;
revoke all on function public.payments_get_mercadopago(uuid) from public;
revoke all on function system.mercadopago_attach_account(uuid, text, text) from public;
revoke all on function public.payments_set_mercadopago_enabled(uuid, boolean) from public;
grant execute on function system.record_refund_provider_ref(uuid, text) to system_worker;
grant execute on function system.apply_mercadopago_payment(uuid, jsonb) to system_worker;
grant execute on function public.payments_get_mercadopago(uuid) to authenticated;
grant execute on function system.mercadopago_attach_account(uuid, text, text) to system_worker;
grant execute on function public.payments_set_mercadopago_enabled(uuid, boolean) to authenticated;
