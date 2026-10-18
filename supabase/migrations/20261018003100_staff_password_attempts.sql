-- =============================================================================
-- ADR-031: límite propio de intentos de contraseña del staff. Los límites de
-- Supabase Auth son por IP y todas las llamadas salen del servidor de la app:
-- sin este límite, un atacante probaría contraseñas sin freno por cuenta o
-- bloquearía el acceso de todos. Mismo esquema que storefront.take_code_attempt
-- (APP-M4): por email (hash) y por IP (hash), ventana de 15 minutos.
-- =============================================================================
create or replace function system.take_staff_login_attempt(p_email text, p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea := sha256(convert_to(lower(btrim(coalesce(p_email, ''))), 'UTF8'));
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'client';
  end if;
  if app.rate_limit_take('staff_password:email:' || encode(v_hash, 'hex'), 10, 900)
     and app.rate_limit_take('staff_password:ip:' || p_ip_hash, 30, 900) then
    return true;
  end if;
  perform system.record_security_event('auth.password_rate_limited', 'warning', null, null, null, null, null,
                                       jsonb_build_object('ip_hash', left(p_ip_hash, 16)));
  return false;
end
$$;
revoke all on function system.take_staff_login_attempt(text, text) from public;
grant execute on function system.take_staff_login_attempt(text, text) to system_worker;
