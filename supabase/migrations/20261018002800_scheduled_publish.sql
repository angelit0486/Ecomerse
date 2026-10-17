-- =============================================================================
-- Panel de productos, tanda 7: publicación programada.
--
-- * products.publish_at: cuándo publicar un borrador. Se borra solo si el
--   producto deja de ser borrador o se elimina (un horario viejo nunca publica
--   por sorpresa).
-- * catalog_schedule_publish: lo fija o lo quita (products.publish). La hora
--   llega como fecha y hora local y se interpreta en la zona de la tienda.
-- * system.publish_scheduled_products: el worker publica los vencidos con la
--   MISMA validación que la publicación manual; si no pasa, quita el horario y
--   lo deja en la auditoría con los motivos. En una tienda que no puede
--   publicar, el horario espera un día y después se cancela (schedule_expired). Job catalog.publish_scheduled,
--   encolado cada minuto por system.enqueue_maintenance.
-- =============================================================================

alter table public.products add column publish_at timestamptz;
create index products_publish_at_idx on public.products (publish_at) where publish_at is not null;

create or replace function app.products_clear_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'draft' or new.deleted_at is not null then
    new.publish_at := null;
  end if;
  return new;
end
$$;
revoke all on function app.products_clear_schedule() from public;
create trigger products_clear_schedule before insert or update on public.products
  for each row execute function app.products_clear_schedule();

create or replace function public.catalog_schedule_publish(p_store_id uuid, p_product_id uuid, p_local text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_at      timestamptz;
  v_tz      text := (select s.timezone from public.stores s where s.id = p_store_id);
begin
  perform app.require_store_permission(p_store_id, 'products.publish');
  v_product := app.lock_product(p_store_id, p_product_id);
  if v_product.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
  if p_local is not null then
    if p_local !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'publish_at';
    end if;
    begin
      v_at := p_local::timestamp at time zone v_tz;
    exception when others then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'publish_at';
    end;
    -- En el futuro (la hora llega sin segundos: «el próximo minuto» vale) y dentro de un año.
    if v_at <= now() or v_at > now() + interval '1 year' then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'publish_at';
    end if;
  end if;
  if v_product.publish_at is not distinct from v_at then
    return jsonb_build_object('publish_at', v_at);  -- sin cambios: nada que auditar
  end if;
  update public.products set publish_at = v_at where id = p_product_id;
  perform audit.record(case when v_at is null then 'product.publish_unscheduled' else 'product.publish_scheduled' end,
                       'product', p_product_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('publish_at', v_product.publish_at), jsonb_build_object('publish_at', v_at));
  return jsonb_build_object('publish_at', v_at);
end
$$;
revoke all on function public.catalog_schedule_publish(uuid, uuid, text) from public;
grant execute on function public.catalog_schedule_publish(uuid, uuid, text) to authenticated;

create or replace function system.publish_scheduled_products(p_limit integer default 100)
returns table (store_id uuid, product_id uuid, published boolean, codes text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p     record;
  v_codes text;
begin
  for v_p in
    select p.id, p.store_id, s.organization_id
      from public.products p
      join public.stores s on s.id = p.store_id
     where p.publish_at <= now() and p.status = 'draft' and p.deleted_at is null
       -- Una tienda cerrada o una organización suspendida no publica nada.
       and s.status not in ('suspended', 'closed') and app.org_access_mode(s.organization_id) = 'full'
     order by p.publish_at, p.id
     limit least(greatest(coalesce(p_limit, 100), 1), 500)
     for update of p skip locked
  loop
    select string_agg(v.code, ',') into v_codes
      from app.validate_product_for_publish(v_p.id) v where v.level = 'error';
    if v_codes is null then
      update public.products set status = 'active', published_at = coalesce(published_at, now()) where id = v_p.id;
      perform audit.record('product.published', 'product', v_p.id, v_p.organization_id, v_p.store_id,
                           jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'active'),
                           null, jsonb_build_object('scheduled', true));
    else
      update public.products set publish_at = null where id = v_p.id;
      perform audit.record('product.publish_failed', 'product', v_p.id, v_p.organization_id, v_p.store_id,
                           null, jsonb_build_object('codes', string_to_array(v_codes, ',')),
                           null, jsonb_build_object('scheduled', true));
    end if;
    store_id := v_p.store_id; product_id := v_p.id; published := v_codes is null; codes := v_codes;
    return next;
  end loop;
  -- Un horario vencido hace más de un día en una tienda que no podía publicar
  -- (suspendida, cerrada o sin acceso completo) se cancela: al reactivarla, un
  -- horario viejo nunca publica por sorpresa.
  for v_p in
    select p.id, p.store_id, s.organization_id
      from public.products p
      join public.stores s on s.id = p.store_id
     where p.publish_at < now() - interval '1 day' and p.status = 'draft' and p.deleted_at is null
       and (s.status in ('suspended', 'closed') or app.org_access_mode(s.organization_id) <> 'full')
     order by p.publish_at, p.id
     limit least(greatest(coalesce(p_limit, 100), 1), 500)
     for update of p skip locked
  loop
    update public.products set publish_at = null where id = v_p.id;
    perform audit.record('product.publish_failed', 'product', v_p.id, v_p.organization_id, v_p.store_id,
                         null, jsonb_build_object('codes', array['schedule_expired']),
                         null, jsonb_build_object('scheduled', true));
    store_id := v_p.store_id; product_id := v_p.id; published := false; codes := 'schedule_expired';
    return next;
  end loop;
end
$$;
revoke all on function system.publish_scheduled_products(integer) from public;
grant execute on function system.publish_scheduled_products(integer) to system_worker;

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
  perform system.fail_stuck_imports();
end
$$;
