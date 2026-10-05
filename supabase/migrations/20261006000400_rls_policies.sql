-- =============================================================================
-- Fase 2 · RLS, privilegios y políticas (GATE0 §12.3)
--
-- Principios:
--  - RLS habilitado Y forzado en todas las tablas. Sin políticas = sin acceso.
--  - anon: cero grants. service_role: cero grants de tabla.
--  - Las escrituras sensibles (membresías, tiendas, invitaciones, concesiones,
--    suscripciones) NO tienen políticas de escritura: solo RPC (20261006000500).
--  - Grants por columna: authenticated solo puede modificar columnas no estructurales.
--  - Ninguna política usa USING (true).
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'platform_staff', 'plans', 'plan_entitlements', 'organizations',
    'organization_members', 'subscriptions', 'organization_entitlement_overrides', 'stores',
    'permissions', 'roles', 'role_permissions', 'store_members', 'store_domains',
    'store_counters', 'store_themes', 'customers', 'organization_invitations',
    'support_access_grants'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
  end loop;
end
$$;

-- PostgreSQL verifica EXECUTE sobre las funciones usadas en restricciones CHECK
-- cuando un rol de aplicación modifica la fila. Solo se conceden las funciones de
-- validación PURAS de las tablas que authenticated puede actualizar.
grant execute on function app.is_reserved_handle(text) to authenticated;
grant execute on function app.theme_settings_valid(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Plano plataforma
-- -----------------------------------------------------------------------------
grant select, update (full_name, avatar_path, locale) on public.profiles to authenticated;
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

grant select on public.platform_staff to authenticated;
create policy platform_staff_select_own on public.platform_staff for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.plans to authenticated;
create policy plans_select_visible on public.plans for select to authenticated
  using ((select auth.uid()) is not null and status <> 'hidden');

grant select on public.plan_entitlements to authenticated;
create policy plan_entitlements_select_visible on public.plan_entitlements for select to authenticated
  using (exists (select 1 from public.plans p where p.id = plan_id));

-- Catálogo de permisos y roles del sistema: legible por usuarios autenticados.
grant select on public.permissions to authenticated;
create policy permissions_select_authenticated on public.permissions for select to authenticated
  using ((select auth.uid()) is not null);

grant select on public.roles to authenticated;
create policy roles_select_visible on public.roles for select to authenticated
  using (
    (organization_id is null and (select auth.uid()) is not null)
    or (organization_id is not null and app.has_org_permission(organization_id, 'org.read'))
  );

grant select on public.role_permissions to authenticated;
create policy role_permissions_select_visible on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id));

-- -----------------------------------------------------------------------------
-- Plano tenant · organización (solo lectura directa; escrituras por RPC)
-- -----------------------------------------------------------------------------
grant select on public.organizations to authenticated;
create policy organizations_select_member on public.organizations for select to authenticated
  using (app.has_org_permission(id, 'org.read'));

grant select on public.organization_members to authenticated;
create policy organization_members_select_member on public.organization_members for select to authenticated
  using (app.has_org_permission(organization_id, 'org.read'));

grant select on public.subscriptions to authenticated;
create policy subscriptions_select_billing on public.subscriptions for select to authenticated
  using (app.has_org_permission(organization_id, 'org.billing.read'));

grant select on public.organization_entitlement_overrides to authenticated;
create policy overrides_select_billing on public.organization_entitlement_overrides for select to authenticated
  using (app.has_org_permission(organization_id, 'org.billing.read'));

-- Invitaciones: token_hash NUNCA es legible (grant por columnas).
grant select (id, organization_id, store_id, email, org_role, store_role_id, token_issued_at,
              expires_at, accepted_at, revoked_at, invited_by, created_at)
  on public.organization_invitations to authenticated;
create policy invitations_select_managers on public.organization_invitations for select to authenticated
  using (
    app.has_org_permission(organization_id, 'org.members.manage')
    or (store_id is not null and app.has_store_permission(store_id, 'staff.manage'))
  );

-- -----------------------------------------------------------------------------
-- Plano tenant · tienda
-- -----------------------------------------------------------------------------
grant select on public.stores to authenticated;
grant update (name, contact_email, contact_phone, legal_name, tax_id, timezone, locale)
  on public.stores to authenticated;
create policy stores_select on public.stores for select to authenticated
  using (app.has_store_permission(id, 'store.read'));
create policy stores_update on public.stores for update to authenticated
  using (app.has_store_permission(id, 'store.update'))
  with check (app.has_store_permission(id, 'store.update'));

grant select on public.store_members to authenticated;
create policy store_members_select on public.store_members for select to authenticated
  using (
    app.has_store_permission(store_id, 'staff.read')
    or (user_id = (select auth.uid()) and (select app.has_aal2()))
  );

grant select on public.store_domains to authenticated;
create policy store_domains_select on public.store_domains for select to authenticated
  using (app.has_store_permission(store_id, 'store.read'));

-- store_counters: sin grants ni políticas (solo funciones).

grant select on public.store_themes to authenticated;
grant update (draft_settings, draft_home_sections) on public.store_themes to authenticated;
create policy store_themes_select on public.store_themes for select to authenticated
  using (app.has_store_permission(store_id, 'store.read'));
create policy store_themes_update_draft on public.store_themes for update to authenticated
  using (app.has_store_permission(store_id, 'appearance.manage'))
  with check (app.has_store_permission(store_id, 'appearance.manage'));

-- Compradores: cada comprador ve SU fila (sin AAL2). El staff necesita PII
-- explícita (customers.pii.read); el listado enmascarado llega por RPC (Fase 8).
grant select on public.customers to authenticated;
grant update (first_name, last_name, phone) on public.customers to authenticated;
create policy customers_select_self on public.customers for select to authenticated
  using (user_id = (select auth.uid()));
create policy customers_select_staff on public.customers for select to authenticated
  using (app.has_store_permission(store_id, 'customers.pii.read'));
create policy customers_update_self on public.customers for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy customers_update_staff on public.customers for update to authenticated
  using (app.has_store_permission(store_id, 'customers.update'))
  with check (app.has_store_permission(store_id, 'customers.update'));

-- Concesiones de soporte: las ve el propio soporte (AAL2) y el dueño de la organización.
grant select on public.support_access_grants to authenticated;
create policy support_grants_select on public.support_access_grants for select to authenticated
  using (
    (grantee_user_id = (select auth.uid()) and (select app.has_aal2()))
    or app.current_org_role(organization_id) = 'org_owner'
  );
