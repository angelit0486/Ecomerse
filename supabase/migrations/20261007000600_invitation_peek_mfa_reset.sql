-- =============================================================================
-- Fase 2 · Aceptación de invitaciones y reset de MFA (F2-T10)
-- Contrato: GATE0 §7.2 (registro de staff solo por invitación; recuperación:
-- el org_owner/org_admin solicita el reset de MFA de un miembro → función de
-- plataforma con service role, uso #1 de la lista blanca SR-1, con auditoría).
-- =============================================================================

-- El servidor (rol system_worker) comprueba un token antes de permitir el alta de
-- la cuenta invitada: solo se crea un usuario si existe una invitación vigente
-- para ESE email. Devuelve lo mínimo para la pantalla de aceptación.
create or replace function system.peek_invitation(p_token text)
returns table (email text, organization_name text, store_name text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.email, o.name, s.name, i.expires_at
    from public.organization_invitations i
    join public.organizations o on o.id = i.organization_id and o.status = 'active'
    left join public.stores s on s.id = i.store_id
   where p_token ~ '^[0-9a-f]{64}$'
     and i.token_hash = app.token_hash(p_token)
     and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
$$;

revoke all on function system.peek_invitation(text) from public;
grant execute on function system.peek_invitation(text) to system_worker;

-- Autoriza y audita el reset de MFA de un miembro (las mismas reglas que
-- gestionar al miembro: nunca al dueño, org_admin solo por el dueño, nunca a sí
-- mismo). El borrado de factores lo hace después el servidor con Auth Admin.
create or replace function public.access_authorize_mfa_reset(p_organization_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_can_manage_org_member(p_organization_id, p_user_id);
  perform audit.record('member.mfa_reset', 'organization_member', p_user_id, p_organization_id,
                       null, null, null, 'Reset de verificación en dos pasos solicitado por la organización');
end
$$;

revoke all on function public.access_authorize_mfa_reset(uuid, uuid) from public;
grant execute on function public.access_authorize_mfa_reset(uuid, uuid) to authenticated;
