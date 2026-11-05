-- =============================================================================
-- Auditoría global 2026-11-05, paso 19 (2.ª parte): «Salud de tu tienda».
-- Revisión continua (no solo al lanzar) de lo que hace fallar una tienda que ya
-- vende: quién recibe los avisos, pagos y envíos activos, productos sin foto o
-- sin existencias, políticas publicadas, uso del plan y pedidos que esperan.
-- Solo lee; detrás del interruptor por tienda `store_health` (apagado; la
-- tienda lo enciende en Ajustes → Funciones).
--
-- Reversa: `update public.feature_flags set kill_switch = true where key =
-- 'store_health'` oculta la pantalla; la función no cambia datos.
-- =============================================================================

insert into public.feature_flags (key, description, default_enabled, owner, store_toggle) values
  ('store_health', 'Panel: «Salud de tu tienda» con lo que falta o está por fallar', false, 'plataforma', true)
on conflict (key) do nothing;

-- Cada revisión: {key, status ok|warning|critical, value, limit?}. Los umbrales
-- viven aquí; los textos, en src/lib/store-health/checks.ts.
create function public.store_health(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store    public.stores;
  v_checks   jsonb := '[]'::jsonb;
  v_n        integer;
  v_online   integer;
  v_limit    integer;
  v_used     integer;
  v_key      text;
  v_missing  text[];
begin
  perform app.require_store_permission(p_store_id, 'store.read');
  select * into v_store from public.stores s where s.id = p_store_id;

  -- Avisos de pedidos: a alguien deben llegarle.
  v_checks := v_checks || jsonb_build_object('key', 'notifications', 'status',
    case when exists (select 1 from public.store_notification_settings n
                       where n.store_id = p_store_id and cardinality(n.staff_emails) > 0)
              or nullif(btrim(coalesce(v_store.contact_email, '')), '') is not null
         then 'ok' else 'critical' end, 'value', 0);

  -- Pagos activos; sin pago en línea, aviso.
  select count(*), count(*) filter (where a.provider in ('mercadopago', 'stripe'))
    into v_n, v_online
    from public.payment_accounts a where a.store_id = p_store_id and a.status = 'active';
  v_checks := v_checks || jsonb_build_object('key', 'payments', 'status',
    case when v_n = 0 then 'critical' when v_online = 0 then 'warning' else 'ok' end, 'value', v_n);

  -- Envíos: con productos que se envían, al menos una tarifa activa.
  select count(*) into v_n from public.shipping_rates r where r.store_id = p_store_id and r.is_active;
  v_checks := v_checks || jsonb_build_object('key', 'shipping', 'status',
    case when v_n = 0 and exists (select 1 from public.product_variants v
                                   join public.products p on p.store_id = v.store_id and p.id = v.product_id
                                  where v.store_id = p_store_id and v.deleted_at is null and v.requires_shipping
                                    and p.status = 'active' and p.deleted_at is null)
         then 'critical' else 'ok' end, 'value', v_n);

  -- Productos activos sin ninguna foto lista.
  select count(*) into v_n from public.products p
   where p.store_id = p_store_id and p.status = 'active' and p.deleted_at is null
     and not exists (select 1 from public.media m
                      where m.store_id = p.store_id and m.product_id = p.id
                        and m.status = 'ready' and m.deleted_at is null);
  v_checks := v_checks || jsonb_build_object('key', 'products_without_photo',
    'status', case when v_n > 0 then 'warning' else 'ok' end, 'value', v_n);

  -- Productos activos que hoy no se pueden comprar: ninguna presentación con
  -- existencias (las que no llevan control o permiten vender sin existencias cuentan).
  select count(*) into v_n from public.products p
   where p.store_id = p_store_id and p.status = 'active' and p.deleted_at is null
     and exists (select 1 from public.product_variants v
                  where v.store_id = p.store_id and v.product_id = p.id and v.deleted_at is null and v.status = 'active')
     and not exists (
       select 1 from public.product_variants v
        where v.store_id = p.store_id and v.product_id = p.id and v.deleted_at is null and v.status = 'active'
          and (not v.track_inventory or v.inventory_policy = 'continue'
               or coalesce((select sum(l.available) from public.inventory_levels l
                             where l.store_id = v.store_id and l.variant_id = v.id), 0) > 0));
  v_checks := v_checks || jsonb_build_object('key', 'out_of_stock',
    'status', case when v_n > 0 then 'warning' else 'ok' end, 'value', v_n);

  -- Políticas publicadas: el aviso de privacidad es obligatorio (LFPDPPP); las demás, aviso.
  select array_agg(t order by t) into v_missing
    from unnest(array['policy_privacy', 'policy_returns', 'policy_shipping', 'policy_terms']) t
   where not exists (select 1 from public.store_pages g
                      where g.store_id = p_store_id and g.type = t and g.is_published and g.deleted_at is null);
  v_checks := v_checks || jsonb_build_object('key', 'policies',
    'status', case when 'policy_privacy' = any (coalesce(v_missing, '{}')) then 'critical'
                   when cardinality(coalesce(v_missing, '{}')) > 0 then 'warning' else 'ok' end,
    'value', cardinality(coalesce(v_missing, '{}')), 'missing', to_jsonb(coalesce(v_missing, '{}')));

  -- Uso del plan de la organización: aviso al 80 %, urgente al 100 %.
  foreach v_key in array array['max_products', 'max_staff', 'storage_mb'] loop
    v_limit := app.effective_limit(v_store.organization_id, v_key);
    if v_limit > 0 then
      v_used := app.current_usage(v_store.organization_id, v_key);
      v_checks := v_checks || jsonb_build_object('key', 'plan_' || v_key,
        'status', case when v_used >= v_limit then 'critical'
                       when v_used * 5 >= v_limit * 4 then 'warning' else 'ok' end,
        'value', v_used, 'limit', v_limit);
    end if;
  end loop;

  -- Pedidos pagados sin enviar con más de 3 días, y pedidos en atención.
  select count(*) into v_n from public.orders o
   where o.store_id = p_store_id and o.status = 'open' and o.payment_status in ('paid', 'partially_refunded')
     and o.fulfillment_status in ('unfulfilled', 'partially_fulfilled') and o.requires_shipping
     and o.placed_at < now() - interval '3 days';
  v_checks := v_checks || jsonb_build_object('key', 'orders_waiting',
    'status', case when v_n > 0 then 'warning' else 'ok' end, 'value', v_n);
  select count(*) into v_n from public.orders o
   where o.store_id = p_store_id and o.needs_attention and o.status <> 'cancelled';
  v_checks := v_checks || jsonb_build_object('key', 'orders_attention',
    'status', case when v_n > 0 then 'warning' else 'ok' end, 'value', v_n);

  return jsonb_build_object(
    'checked_at', now(),
    'status', case when v_checks @> '[{"status":"critical"}]' then 'critical'
                   when v_checks @> '[{"status":"warning"}]' then 'warning' else 'ok' end,
    'checks', v_checks);
end
$$;
revoke all on function public.store_health(uuid) from public;
grant execute on function public.store_health(uuid) to authenticated;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261105000700'::text
$$;
