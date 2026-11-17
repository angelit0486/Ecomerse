-- =============================================================================
-- Límite propio de intentos del segundo factor (TOTP) del staff. Auditoría de
-- autorización 2026-11-17, hallazgo 1 (riesgo medio): verifyTotp no tenía
-- límite propio. Los límites de Supabase Auth son por IP y todas las llamadas
-- salen del servidor de la app: quien ya tiene el primer factor podía adivinar
-- códigos hasta el límite global y agotarlo para todo el staff. Mismo esquema
-- que system.take_staff_login_attempt (ADR-031), ventana de 15 minutos:
--   * 5 por usuario (staff_mfa:user:<uid>): el freno contra adivinar; cambiar
--     de factor no lo reinicia.
--   * 5 por factor (staff_mfa:factor:<fid>).
--   * 30 por IP (staff_mfa:ip:<hash>).
--
-- ORDEN: IP → usuario → factor, cada uno solo si el anterior aceptó.
-- app.rate_limit_take SIEMPRE suma el intento, también cuando ya rechaza, y en
-- SQL «a and b» no garantiza el orden ni el corte de la evaluación; por eso son
-- IF sucesivos. Así:
--   * un intento rechazado por IP no gasta el presupuesto de ninguna cuenta: un
--     atacante que agotó su IP ya no consume el de los usuarios legítimos;
--   * uno rechazado por usuario no gasta el del factor. El factor llega del
--     formulario (el cliente lo elige); con este orden una sesión gasta como
--     mucho 5 intentos por ventana de un factor ajeno, y solo si conoce su UUID
--     (nunca se muestra a otros usuarios). Supabase rechaza un factor ajeno.
-- Lo que sí se comparte es inevitable: los intentos de un atacante con el primer
-- factor gastan el presupuesto de esa cuenta (eso es el límite) y los de una IP
-- compartida (p. ej. una oficina), el de esa IP. La ventana es fija: los
-- intentos rechazados no la alargan.
--
-- Al rechazar registra auth.mfa_rate_limited con el usuario, la IP recortada
-- (16 de 64) y qué límite rechazó. Sin tablas nuevas: las claves viven en
-- system.rate_limits y las purga system.purge_rate_limits.
-- =============================================================================
create or replace function system.take_staff_mfa_attempt(p_user_id uuid, p_factor_id uuid, p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit text;
begin
  if p_user_id is null or p_factor_id is null or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'client';
  end if;
  if not app.rate_limit_take('staff_mfa:ip:' || p_ip_hash, 30, 900) then
    v_limit := 'ip';
  elsif not app.rate_limit_take('staff_mfa:user:' || p_user_id, 5, 900) then
    v_limit := 'user';
  elsif not app.rate_limit_take('staff_mfa:factor:' || p_factor_id, 5, 900) then
    v_limit := 'factor';
  else
    return true;
  end if;
  perform system.record_security_event('auth.mfa_rate_limited', 'warning', p_user_id, null, null, null, null,
                                       jsonb_build_object('ip_hash', left(p_ip_hash, 16), 'limit', v_limit));
  return false;
end
$$;
revoke all on function system.take_staff_mfa_attempt(uuid, uuid, text) from public;
grant execute on function system.take_staff_mfa_attempt(uuid, uuid, text) to system_worker;

-- Versión del esquema (D-POR-06).
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261117000300'::text
$$;
