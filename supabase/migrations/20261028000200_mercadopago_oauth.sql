-- =============================================================================
-- ADR-041 · Mercado Pago por tienda con OAuth (marketplace). Cada comercio
-- conecta SU cuenta y el dinero de sus ventas llega a ella. Vuelve al diseño
-- original de GATE0 §18.1 (credenciales del proveedor por tienda) que ADR-028
-- había aplazado con una sola credencial de plataforma.
--
-- - Las llaves del comercio (access y refresh token) se guardan CIFRADAS por el
--   servidor (AES-256-GCM, clave PAYMENT_CREDENTIALS_KEY solo en el entorno):
--   la base nunca ve una llave en claro y un respaldo de la base no basta para
--   usarlas.
-- - Tabla en `system` (nunca expuesta en la Data API, §44.6), RLS forzado y sin
--   grants: solo funciones system.* del worker la leen o escriben (§44.4).
-- - Una cuenta sin credenciales (conectada antes con la credencial de plataforma)
--   sigue cobrando como hasta hoy.
-- - Los tokens jamás salen hacia el panel ni la auditoría: solo "conectada con
--   tu cuenta" y la fecha de renovación.
-- =============================================================================

create table system.payment_credentials (
  id                 uuid primary key default app.uuid_v7(),
  store_id           uuid not null references public.stores (id) on delete restrict,
  payment_account_id uuid not null,
  provider           text not null check (provider = 'mercadopago'),
  -- Formato del sobre: v1.<iv>.<tag>.<ciphertext> en base64url (src/server/security/secret-box.ts).
  access_token_enc   text not null check (access_token_enc ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
                                          and char_length(access_token_enc) <= 4096),
  refresh_token_enc  text check (refresh_token_enc is null or (
                                   refresh_token_enc ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
                                   and char_length(refresh_token_enc) <= 4096)),
  expires_at         timestamptz not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (store_id, id),
  unique (payment_account_id),
  foreign key (store_id, payment_account_id)
    references public.payment_accounts (store_id, id) on delete restrict
);
alter table system.payment_credentials enable row level security;
alter table system.payment_credentials force row level security;
-- Sin políticas ni grants: denegado para todo rol salvo el dueño de las funciones.
create trigger payment_credentials_prevent_tenant_change before update on system.payment_credentials
  for each row execute function app.prevent_tenant_change();
create trigger payment_credentials_set_updated_at before update on system.payment_credentials
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Conectar: el servidor ya validó la cuenta con /users/me usando el token del
-- comercio. Reusa el registro de la cuenta (conflictos, reactivación, auditoría)
-- y guarda las llaves cifradas junto a ella.
-- -----------------------------------------------------------------------------
create function system.mercadopago_attach_oauth(p_store_id uuid, p_user_id text, p_mode text,
                                                p_access_enc text, p_refresh_enc text, p_expires_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
begin
  if p_expires_at is null or p_expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'expires_at';
  end if;
  perform system.mercadopago_attach_account(p_store_id, p_user_id, p_mode);
  select a.id into v_account from public.payment_accounts a
   where a.store_id = p_store_id and a.provider = 'mercadopago' and a.status = 'active'
     and a.public_config ->> 'mp_user_id' = p_user_id;
  update public.payment_accounts a
     set public_config = a.public_config || jsonb_build_object('connection', 'oauth')
   where a.id = v_account;
  insert into system.payment_credentials (store_id, payment_account_id, provider, access_token_enc,
                                          refresh_token_enc, expires_at)
  values (p_store_id, v_account, 'mercadopago', p_access_enc, p_refresh_enc, p_expires_at)
  on conflict (payment_account_id) do update
     set access_token_enc = excluded.access_token_enc,
         refresh_token_enc = excluded.refresh_token_enc,
         expires_at = excluded.expires_at;
  perform audit.record('payments.mercadopago_oauth_connected', 'payment_account', v_account,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('mode', p_mode, 'expires_at', p_expires_at));
  return v_account;
end
$$;

-- Llaves cifradas de una cuenta (null si se conectó con la credencial de plataforma).
create function system.mercadopago_credentials(p_payment_account_id uuid)
returns table (store_id uuid, access_token_enc text, refresh_token_enc text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.store_id, c.access_token_enc, c.refresh_token_enc, c.expires_at
    from system.payment_credentials c
   where c.payment_account_id = p_payment_account_id
$$;

-- Tras renovar con el refresh token (Mercado Pago entrega uno nuevo cada vez).
create function system.mercadopago_save_tokens(p_payment_account_id uuid, p_access_enc text,
                                               p_refresh_enc text, p_expires_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_expires_at is null or p_expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'expires_at';
  end if;
  update system.payment_credentials c
     set access_token_enc = p_access_enc,
         refresh_token_enc = coalesce(p_refresh_enc, c.refresh_token_enc),
         expires_at = p_expires_at
   where c.payment_account_id = p_payment_account_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'credentials';
  end if;
end
$$;

-- Cuentas cuya llave vence en menos de 30 días (renovación preventiva).
create function system.mercadopago_credentials_due(p_limit integer default 50)
returns table (payment_account_id uuid, store_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.payment_account_id, c.store_id
    from system.payment_credentials c
    join public.payment_accounts a on a.store_id = c.store_id and a.id = c.payment_account_id
   where c.expires_at < now() + interval '30 days' and a.status <> 'disabled'
     and c.refresh_token_enc is not null
   order by c.expires_at
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- Ajustes → Pagos: además del estado, si la tienda cobra en su propia cuenta.
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
                                          'status', a.status, 'mode', a.mode,
                                          'own_account', c.id is not null,
                                          'renews_by', c.expires_at)
                  from public.payment_accounts a
                  left join system.payment_credentials c on c.payment_account_id = a.id
                 where a.store_id = p_store_id and a.provider = 'mercadopago'
                 order by a.created_at desc limit 1));
end
$$;

-- Renovación preventiva diaria en el mantenimiento (solo si hay llaves por vencer).
create function system.mercadopago_enqueue_refresh()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from system.mercadopago_credentials_due(1)) then
    perform app.enqueue_job('payments.mercadopago_refresh', '{}'::jsonb, null,
                            'payments.mercadopago_refresh:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'),
                            now(), 3);
  end if;
end
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
  -- F10: periodos vencidos → pago pendiente → pausa (§19.4). Solo toca filas vencidas.
  perform system.subscriptions_advance();
  -- ADR-041: llaves de Mercado Pago de los comercios que vencen en menos de 30 días.
  perform system.mercadopago_enqueue_refresh();
end
$$;

revoke all on function system.mercadopago_attach_oauth(uuid, text, text, text, text, timestamptz) from public;
revoke all on function system.mercadopago_credentials(uuid) from public;
revoke all on function system.mercadopago_save_tokens(uuid, text, text, timestamptz) from public;
revoke all on function system.mercadopago_credentials_due(integer) from public;
revoke all on function system.mercadopago_enqueue_refresh() from public;
grant execute on function system.mercadopago_attach_oauth(uuid, text, text, text, text, timestamptz) to system_worker;
grant execute on function system.mercadopago_credentials(uuid) to system_worker;
grant execute on function system.mercadopago_save_tokens(uuid, text, text, timestamptz) to system_worker;
grant execute on function system.mercadopago_credentials_due(integer) to system_worker;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261028000200'::text
$$;
