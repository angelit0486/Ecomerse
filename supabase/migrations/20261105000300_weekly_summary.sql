-- =============================================================================
-- Auditoría global 2026-11-05, paso 19: resumen semanal por correo a la dueña
-- (ventas de 7 días contra los 7 anteriores, por surtir, en atención, pendientes
-- de pago, stock bajo, carritos abandonados y lo más vendido).
--
-- Interruptor por tienda `weekly_summary` (apagado; la tienda lo enciende en
-- Ajustes → Funciones). Un solo trabajo por semana ISO desde el lunes 8:00 (hora
-- del centro de México); el correo no se repite (clave única por semana, tienda
-- y destinatario). Solo lectura de datos: no cambia pedidos, pagos ni precios.
--
-- Reversa: kill switch de `weekly_summary`; volver a aplicar enqueue_maintenance
-- de 20261105000100. Las funciones nuevas pueden quedarse.
-- =============================================================================

insert into public.feature_flags (key, description, default_enabled, owner, store_toggle) values
  ('weekly_summary',
   'Correo semanal a la dueña: ventas, pendientes, stock bajo y carritos abandonados', false,
   'plataforma', true)
on conflict (key) do nothing;

-- Semana ISO a la que toca el resumen, o null el lunes antes de las 8:00 (México).
create or replace function system.weekly_summary_window(p_now timestamptz)
returns text
language sql
stable -- la zona horaria con nombre puede cambiar sus reglas: no es inmutable
set search_path = ''
as $$
  select case
           when extract(isodow from p_now at time zone 'America/Mexico_City') = 1
                and extract(hour from p_now at time zone 'America/Mexico_City') < 8 then null
           else to_char(p_now at time zone 'America/Mexico_City', 'IYYY-"S"IW')
         end
$$;
revoke all on function system.weekly_summary_window(timestamptz) from public;
grant execute on function system.weekly_summary_window(timestamptz) to system_worker;

-- Datos del resumen de las tiendas con el interruptor encendido (páginas por id).
create or replace function system.weekly_summaries(p_after uuid, p_limit integer default 50)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'store', jsonb_build_object('id', s.id, 'name', s.name, 'handle', s.handle,
                                'organization_id', s.organization_id, 'currency', s.currency),
    'recipients', to_jsonb(coalesce(
      nullif((select n.staff_emails from public.store_notification_settings n where n.store_id = s.id),
             '{}'::text[]),
      case when s.contact_email is not null then array[s.contact_email] else '{}'::text[] end)),
    'sales', (select coalesce(sum(o.total), 0) from public.orders o
               where o.store_id = s.id and o.paid_at >= now() - interval '7 days'),
    'orders', (select count(*) from public.orders o
                where o.store_id = s.id and o.paid_at >= now() - interval '7 days'),
    'sales_prev', (select coalesce(sum(o.total), 0) from public.orders o
                    where o.store_id = s.id and o.paid_at >= now() - interval '14 days'
                      and o.paid_at < now() - interval '7 days'),
    'refunds', (select coalesce(sum(r.amount), 0) from public.refunds r
                 where r.store_id = s.id and r.status = 'succeeded'
                   and r.updated_at >= now() - interval '7 days'),
    'to_fulfill', (select count(*) from public.orders o
                    where o.store_id = s.id and o.status = 'open'
                      and o.fulfillment_status in ('unfulfilled', 'partially_fulfilled')),
    'needs_attention', (select count(*) from public.orders o
                         where o.store_id = s.id and o.needs_attention),
    'pending_payment', (select count(*) from public.orders o
                         where o.store_id = s.id and o.status = 'pending_payment'),
    'abandoned_carts', (select count(*) from public.carts c
                         where c.store_id = s.id and c.status = 'abandoned'
                           and c.last_activity_at >= now() - interval '7 days'),
    'low_stock', (select coalesce(jsonb_agg(x order by x ->> 'available', x ->> 'title'), '[]'::jsonb)
                    from (select jsonb_build_object('title', p.title, 'sku', v.sku,
                                                    'available', l.available) as x
                            from public.inventory_levels l
                            join public.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
                                                          and v.deleted_at is null
                            join public.products p on p.store_id = v.store_id and p.id = v.product_id
                                                  and p.deleted_at is null
                           where l.store_id = s.id and l.low_stock_threshold is not null
                             and l.available <= l.low_stock_threshold
                           order by l.available, l.id limit 5) t),
    'top_products', (select coalesce(jsonb_agg(t order by (t ->> 'quantity')::integer desc, t ->> 'title'),
                                     '[]'::jsonb)
                       from (select jsonb_build_object('title', min(i.product_title),
                                                       'quantity', sum(i.quantity)::integer) as t
                               from public.order_items i
                               join public.orders o on o.store_id = i.store_id and o.id = i.order_id
                              where o.store_id = s.id and o.paid_at >= now() - interval '7 days'
                              group by coalesce(i.product_id::text, i.product_title)
                              order by sum(i.quantity) desc limit 3) q))
    from public.stores s
   where s.status = 'active'
     and (p_after is null or s.id > p_after)
     and app.flag_enabled('weekly_summary', s.id)
   order by s.id
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;
revoke all on function system.weekly_summaries(uuid, integer) from public;
grant execute on function system.weekly_summaries(uuid, integer) to system_worker;

create or replace function system.enqueue_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Auditoría global 2026-11-05 (B1): la auditoría siempre con 24 meses de
  -- particiones por delante. Solo hace DDL cuando falta la del mes +24 (una vez al mes).
  if to_regclass(format('audit.%I', 'audit_logs_'
       || to_char(date_trunc('month', now()) + interval '24 months', 'YYYYMM'))) is null then
    perform audit.ensure_partitions(24);
  end if;
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
  -- ADR-046: datos personales de tiendas cerradas hace más de 30 días.
  perform system.anonymize_closed_stores(5);
  -- ADR-048: recordatorios de carritos (cada 15 minutos; solo tiendas que lo activaron).
  if exists (select 1 from public.store_notification_settings n where n.cart_recovery) then
    perform app.enqueue_job('carts.recover', '{}'::jsonb, null,
                            'carts.recover:' || to_char(date_trunc('hour', now() at time zone 'utc')
                              + floor(extract(minute from now() at time zone 'utc') / 15) * interval '15 minutes',
                              'YYYY-MM-DD"T"HH24:MI'), now(), 3);
  end if;
  -- Paso 19 (auditoría global): resumen semanal a la dueña, una vez por semana ISO,
  -- solo si alguna tienda lo encendió (o si la plataforma lo enciende por defecto).
  if system.weekly_summary_window(now()) is not null
     and (exists (select 1 from public.feature_flag_overrides o
                   where o.flag_key = 'weekly_summary' and o.enabled)
          or exists (select 1 from public.feature_flags f
                      where f.key = 'weekly_summary' and f.default_enabled and not f.kill_switch)) then
    perform app.enqueue_job('stores.weekly_summary',
                            jsonb_build_object('week', system.weekly_summary_window(now())), null,
                            'stores.weekly_summary:' || system.weekly_summary_window(now()), now(), 3);
  end if;
  -- Misión vendible F1.6: revisión de salud cada 15 minutos (el job solo avisa si hay problemas).
  perform app.enqueue_job('platform.health_check', '{}'::jsonb, null,
                          'platform.health_check:' || to_char(date_trunc('hour', now() at time zone 'utc')
                            + floor(extract(minute from now() at time zone 'utc') / 15) * interval '15 minutes',
                            'YYYY-MM-DD"T"HH24:MI'), now(), 3);
end
$$;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261105000300'::text
$$;
