-- =============================================================================
-- Gestión de productos en el panel (pedido del propietario, 2026-10-17).
--
-- * catalog_set_variant_image: foto propia de una presentación (sabor, tamaño)
--   elegida entre las fotos LISTAS del mismo producto; null = usa la del
--   producto. La tienda ya muestra la foto de la variante en la galería.
-- * catalog_list_extras: datos extra del listado del panel (miniatura, marca,
--   existencias disponibles y presentaciones agotadas). Las existencias solo con
--   inventory.read; sin ese permiso llegan como null.
-- =============================================================================

create or replace function public.catalog_set_variant_image(p_store_id uuid, p_variant_id uuid, p_media_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_variant public.product_variants;
begin
  perform app.require_store_permission(p_store_id, 'products.update');
  select * into v_variant from public.product_variants v
   where v.store_id = p_store_id and v.id = p_variant_id and v.deleted_at is null;
  if v_variant.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'variant';
  end if;
  perform app.lock_product(p_store_id, v_variant.product_id);
  if p_media_id is not null and not exists (
       select 1 from public.media m
        where m.store_id = p_store_id and m.id = p_media_id and m.product_id = v_variant.product_id
          and m.status = 'ready' and m.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'media_id';
  end if;
  update public.product_variants set image_id = p_media_id
   where id = v_variant.id and image_id is distinct from p_media_id;
  -- Las validaciones diferidas de la variante corren aquí, dentro de la función:
  -- al confirmar la transacción ya no tendrían los privilegios del definer.
  set constraints all immediate;
  set constraints all deferred;
end
$$;

create or replace function public.catalog_list_extras(p_store_id uuid, p_product_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stock boolean;
begin
  perform app.require_store_permission(p_store_id, 'products.read');
  v_stock := app.has_store_permission(p_store_id, 'inventory.read');
  return coalesce((
    select jsonb_object_agg(p.id, jsonb_build_object(
             'image', (select m.storage_path from public.media m
                        where m.store_id = p.store_id and m.product_id = p.id and m.status = 'ready'
                          and m.deleted_at is null
                        order by m.position, m.id limit 1),
             'brand', (select b.name from public.brands b
                        where b.store_id = p.store_id and b.id = p.brand_id and b.deleted_at is null),
             'available', case when v_stock then (
                 select sum(greatest(l.available, 0))::integer
                   from public.product_variants v
                   join public.inventory_levels l on l.variant_id = v.id
                   join public.inventory_locations loc on loc.id = l.location_id and loc.is_active
                  where v.product_id = p.id and v.deleted_at is null and v.status = 'active'
                    and v.track_inventory) end,
             'sold_out_variants', case when v_stock then (
                 select count(*)::integer from public.product_variants v
                  where v.product_id = p.id and v.deleted_at is null and v.status = 'active'
                    and v.track_inventory and v.inventory_policy = 'deny'
                    and coalesce((select sum(l.available) from public.inventory_levels l
                                    join public.inventory_locations loc on loc.id = l.location_id and loc.is_active
                                   where l.variant_id = v.id), 0) <= 0) end))
      from public.products p
     where p.store_id = p_store_id and p.id = any (p_product_ids[1:100])), '{}'::jsonb);
end
$$;

revoke all on function public.catalog_set_variant_image(uuid, uuid, uuid) from public;
revoke all on function public.catalog_list_extras(uuid, uuid[]) from public;
grant execute on function public.catalog_set_variant_image(uuid, uuid, uuid) to authenticated;
grant execute on function public.catalog_list_extras(uuid, uuid[]) to authenticated;
