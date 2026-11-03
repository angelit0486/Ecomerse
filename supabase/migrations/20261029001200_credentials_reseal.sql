-- =============================================================================
-- Rotación de PAYMENT_CREDENTIALS_KEY sin reconectar comercios
-- (docs/runbooks/rotacion-de-claves.md). El servidor lee las llaves cifradas por
-- lotes, las descifra con la clave anterior o la nueva y las vuelve a cifrar con
-- la nueva. La base nunca ve una llave en claro (ADR-041).
--
-- La escritura es condicional: solo reemplaza si el sobre sigue siendo el que se
-- leyó. Si en medio la renovación preventiva guardó tokens nuevos (ya cifrados
-- con la clave nueva), no se pisan.
-- =============================================================================

create function system.payment_credentials_batch(p_after uuid, p_limit integer default 100)
returns table (payment_account_id uuid, store_id uuid, access_token_enc text, refresh_token_enc text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.payment_account_id, c.store_id, c.access_token_enc, c.refresh_token_enc
    from system.payment_credentials c
   where p_after is null or c.payment_account_id > p_after
   order by c.payment_account_id
   limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

create function system.payment_credentials_reseal(p_payment_account_id uuid, p_old_access_enc text,
                                                  p_new_access_enc text, p_new_refresh_enc text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_payment_account_id is null or p_old_access_enc is null or p_new_access_enc is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'payment_account_id';
  end if;
  update system.payment_credentials c
     set access_token_enc = p_new_access_enc,
         refresh_token_enc = p_new_refresh_enc
   where c.payment_account_id = p_payment_account_id
     and c.access_token_enc = p_old_access_enc;
  return found;
end
$$;

revoke all on function system.payment_credentials_batch(uuid, integer) from public;
revoke all on function system.payment_credentials_reseal(uuid, text, text, text) from public;
grant execute on function system.payment_credentials_batch(uuid, integer) to system_worker;
grant execute on function system.payment_credentials_reseal(uuid, text, text, text) to system_worker;

-- El job diario corre si hay alguna tienda con llaves propias (antes, solo si
-- alguna vencía): así una rotación se completa en un día aunque nada venza. Si
-- no hay rotación ni llaves por vencer, el job no hace nada.
create or replace function system.mercadopago_enqueue_refresh()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from system.payment_credentials) then
    perform app.enqueue_job('payments.mercadopago_refresh', '{}'::jsonb, null,
                            'payments.mercadopago_refresh:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'),
                            now(), 3);
  end if;
end
$$;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261029001200'::text
$$;
