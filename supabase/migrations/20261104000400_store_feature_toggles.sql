-- =============================================================================
-- Funciones que la propia tienda enciende o apaga desde el panel
-- (Ajustes → Funciones). Solo las marcadas `store_toggle`: mejoras de
-- experiencia sin costo ni efecto en precios, pagos o planes. La plataforma
-- conserva el kill switch (apaga todo) y sus propias excepciones.
--
-- La portada de imágenes nace encendida para todas las tiendas (pedido del
-- propietario 2026-11-04); cada tienda puede apagarla.
--
-- Reversa: `update public.feature_flags set store_toggle = false` quita las
-- funciones de la pantalla (las excepciones guardadas siguen y se pueden
-- borrar desde la consola); `default_enabled = false` en hero_image_carousel
-- vuelve a apagarla por defecto.
-- =============================================================================

alter table public.feature_flags add column store_toggle boolean not null default false;

update public.feature_flags set store_toggle = true
 where key in ('hero_image_carousel', 'storefront_nav_scroll_fix', 'checkout_shipping_messages',
               'mobile_input_size', 'payment_pending_email');
update public.feature_flags set default_enabled = true where key = 'hero_image_carousel';

-- Lista de la pantalla: solo las que la tienda puede cambiar, con su estado real.
create function public.store_features(p_store_id uuid)
returns table (key text, enabled boolean, locked boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.has_store_permission(p_store_id, 'store.read') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  return query
    select f.key, app.flag_enabled(f.key, p_store_id), f.kill_switch
      from public.feature_flags f
     where f.store_toggle
     order by f.key;
end
$$;

-- Encender o apagar en SU tienda (excepción de alcance `store`), con auditoría.
create function public.store_set_feature(p_store_id uuid, p_key text, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app.require_store_permission(p_store_id, 'store.update');
  v_flag public.feature_flags;
  v_org  uuid;
  v_was  boolean;
begin
  select * into v_flag from public.feature_flags f where f.key = p_key;
  if v_flag.key is null or not v_flag.store_toggle then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'feature';
  end if;
  if p_enabled is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'enabled';
  end if;
  if v_flag.kill_switch then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'kill_switch';
  end if;
  select s.organization_id into v_org from public.stores s where s.id = p_store_id;
  v_was := app.flag_enabled(p_key, p_store_id);

  insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason, created_by)
  values (p_key, 'store', p_store_id, p_enabled, 'La tienda lo cambió desde Ajustes → Funciones', v_uid)
  on conflict (flag_key, scope, scope_id) do update
    set enabled = excluded.enabled, expires_at = null, reason = excluded.reason, created_by = excluded.created_by;

  perform audit.record('store.feature_changed', 'feature_flag_override', null, v_org, p_store_id,
                       jsonb_build_object('key', p_key, 'enabled', v_was),
                       jsonb_build_object('key', p_key, 'enabled', p_enabled));
  return app.flag_enabled(p_key, p_store_id);
end
$$;

revoke all on function public.store_features(uuid) from public;
revoke all on function public.store_set_feature(uuid, text, boolean) from public;
grant execute on function public.store_features(uuid) to authenticated;
grant execute on function public.store_set_feature(uuid, text, boolean) to authenticated;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261104000400'::text
$$;
