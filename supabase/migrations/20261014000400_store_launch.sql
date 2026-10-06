-- =============================================================================
-- Fase 7 · Validación de lanzamiento (F7-T05). Contrato: GATE0 §14.3 (punto de
-- extensión de validadores), F7 (§38): método de pago live activo, zona de envío
-- si hay productos físicos, políticas publicadas, contacto, ≥ 1 producto activo.
--
-- * app.validate_store_for_launch devuelve la lista de bloqueos (vacía = se puede
--   publicar). Nunca redacta ni inventa contenido legal: solo exige que la tienda
--   haya publicado el suyo.
-- * stores_launch vuelve a validar dentro de la transacción, con la tienda
--   bloqueada, y la pasa a `active` (primer lanzamiento o reanudación).
-- =============================================================================

create or replace function app.validate_store_for_launch(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store    public.stores;
  v_physical boolean;
  v_issues   jsonb := '[]'::jsonb;
  v_policy   record;
begin
  select * into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'store';
  end if;

  if not exists (select 1 from public.payment_accounts a
                  where a.store_id = p_store_id and a.status = 'active' and a.mode = 'live'
                    and a.provider <> 'fake') then
    v_issues := v_issues || jsonb_build_object('code', 'payment_method',
      'message', 'Activa al menos un método de pago real (transferencia o tarjeta).');
  end if;

  if not exists (select 1 from public.products p
                  where p.store_id = p_store_id and p.status = 'active' and p.deleted_at is null
                    and exists (select 1 from public.product_variants v
                                 where v.store_id = p.store_id and v.product_id = p.id
                                   and v.status = 'active' and v.deleted_at is null)) then
    v_issues := v_issues || jsonb_build_object('code', 'active_product',
      'message', 'Publica al menos un producto con una variante activa.');
  end if;

  v_physical := exists (select 1 from public.products p
                          join public.product_variants v on v.store_id = p.store_id and v.product_id = p.id
                         where p.store_id = p_store_id and p.status = 'active' and p.deleted_at is null
                           and v.status = 'active' and v.deleted_at is null and v.requires_shipping);
  if v_physical and not exists (
       select 1 from public.shipping_zones z
         join public.shipping_rates r on r.store_id = z.store_id and r.zone_id = z.id and r.is_active
        where z.store_id = p_store_id) then
    v_issues := v_issues || jsonb_build_object('code', 'shipping_zone',
      'message', 'Configura al menos una zona de envío con una tarifa activa.');
  end if;

  -- La plantilla de F5-T01 no cuenta: la tienda debe completarla (sin el aviso de
  -- borrador ni párrafos que sean solo un [marcador]).
  for v_policy in
    select t.type, t.message from (values
      ('policy_privacy', 'Publica tu aviso de privacidad, completo y sin marcadores de la plantilla.', true),
      ('policy_terms', 'Publica tus términos y condiciones, completos y sin marcadores de la plantilla.', true),
      ('policy_returns', 'Publica tu política de devoluciones, completa y sin marcadores de la plantilla.', true),
      ('policy_shipping', 'Publica tu política de envíos, completa y sin marcadores de la plantilla.', v_physical))
      as t (type, message, required)
     where t.required
       and not exists (select 1 from public.store_pages pg
                        where pg.store_id = p_store_id and pg.type = t.type and pg.is_published
                          and pg.deleted_at is null and btrim(pg.body_html) <> ''
                          and position('Plantilla en borrador' in pg.body_html) = 0
                          and pg.body_html !~ '<p>\s*\[[^]<]*\]\s*</p>')
  loop
    v_issues := v_issues || jsonb_build_object('code', v_policy.type, 'message', v_policy.message);
  end loop;

  if v_store.contact_email is null then
    v_issues := v_issues || jsonb_build_object('code', 'contact',
      'message', 'Agrega el email de contacto de la tienda.');
  end if;

  return v_issues;
end
$$;

-- Checklist para el panel (cualquiera con store.read).
create or replace function public.stores_launch_checklist(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'store.read');
  return jsonb_build_object(
    'status', (select s.status from public.stores s where s.id = p_store_id),
    'launched_at', (select s.launched_at from public.stores s where s.id = p_store_id),
    'issues', app.validate_store_for_launch(p_store_id));
end
$$;

create or replace function public.stores_launch(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store  public.stores;
  v_issues jsonb;
begin
  perform app.require_store_permission(p_store_id, 'store.update');
  select * into v_store from public.stores s where s.id = p_store_id for update;
  if v_store.status = 'active' then
    return jsonb_build_object('status', 'active', 'replayed', true);
  end if;
  if v_store.status not in ('draft', 'paused') then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'store_status';
  end if;
  if not exists (select 1 from public.organizations o where o.id = v_store.organization_id and o.status = 'active') then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'organization_status';
  end if;
  v_issues := app.validate_store_for_launch(p_store_id);
  if jsonb_array_length(v_issues) > 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed',
      detail = (select string_agg(i ->> 'code', ',') from jsonb_array_elements(v_issues) i);
  end if;
  update public.stores set status = 'active', launched_at = coalesce(launched_at, now()) where id = p_store_id;
  perform audit.record(case when v_store.launched_at is null then 'store.launched' else 'store.resumed' end,
                       'store', p_store_id, v_store.organization_id, p_store_id,
                       jsonb_build_object('status', v_store.status), jsonb_build_object('status', 'active'));
  return jsonb_build_object('status', 'active', 'replayed', false);
end
$$;

-- Paso 3 del onboarding (A-02): pago manual (transferencia o depósito) con las
-- instrucciones que escribe la tienda (texto plano, se escapa al mostrarse). Una
-- cuenta manual por tienda; Stripe Connect se conecta desde Ajustes → Pagos.
create or replace function public.payments_save_manual(p_store_id uuid, p_display_name text, p_instructions text,
                                                       p_active boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name  text := btrim(coalesce(p_display_name, ''));
  v_instr text := btrim(coalesce(p_instructions, ''));
  v_id    uuid;
  v_old   public.payment_accounts;
begin
  perform app.require_store_permission(p_store_id, 'payments.manage');
  if char_length(v_name) not between 1 and 80 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'display_name';
  end if;
  if char_length(v_instr) not between 10 and 2000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'instructions';
  end if;
  select * into v_old from public.payment_accounts a
   where a.store_id = p_store_id and a.provider = 'manual' order by a.created_at limit 1 for update;
  if v_old.id is null then
    insert into public.payment_accounts (store_id, provider, mode, status, display_name, public_config)
    values (p_store_id, 'manual', 'live', case when coalesce(p_active, true) then 'active' else 'disabled' end,
            v_name, jsonb_build_object('instructions', v_instr))
    returning id into v_id;
  else
    update public.payment_accounts
       set display_name = v_name, mode = 'live',
           status = case when coalesce(p_active, true) then 'active' else 'disabled' end,
           public_config = public_config || jsonb_build_object('instructions', v_instr)
     where id = v_old.id
    returning id into v_id;
  end if;
  perform audit.record('payments.account_saved', 'payment_account', v_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       case when v_old.id is not null then jsonb_build_object('status', v_old.status) end,
                       jsonb_build_object('provider', 'manual',
                                          'status', case when coalesce(p_active, true) then 'active' else 'disabled' end));
  return v_id;
end
$$;

revoke all on function app.validate_store_for_launch(uuid) from public;
revoke all on function public.stores_launch_checklist(uuid) from public;
revoke all on function public.stores_launch(uuid) from public;
revoke all on function public.payments_save_manual(uuid, text, text, boolean) from public;
grant execute on function public.stores_launch_checklist(uuid) to authenticated;
grant execute on function public.stores_launch(uuid) to authenticated;
grant execute on function public.payments_save_manual(uuid, text, text, boolean) to authenticated;
