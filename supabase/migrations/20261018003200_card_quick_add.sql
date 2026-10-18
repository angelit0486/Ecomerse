-- =============================================================================
-- Rediseño A+B · «Agregar» desde la tarjeta de producto.
--
-- Para cada producto publicado de la lista: la variante que se agrega directo
-- (producto simple: una sola variante activa, sin opciones) o null si el comprador
-- debe elegir una opción en la ficha. Los productos que no se ven en la tienda no
-- aparecen. Solo devuelve identificadores: el precio y las existencias los decide
-- storefront.cart_add_item al agregar (§17.2).
-- =============================================================================

create or replace function storefront.card_variants(p_store_id uuid, p_product_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(p.id, (
           select v.id
             from public.product_variants v
            where v.store_id = p.store_id and v.product_id = p.id
              and v.option_signature = '' and v.status = 'active' and v.deleted_at is null
              and not exists (select 1 from public.product_variants o
                               where o.store_id = p.store_id and o.product_id = p.id and o.id <> v.id
                                 and o.status = 'active' and o.deleted_at is null))),
         '{}'::jsonb)
    from public.products p
   where p.store_id = p_store_id
     and p.id = any (p_product_ids[1:100])
     and p.status = 'active' and p.deleted_at is null
     and app.store_publicly_readable(p_store_id)
$$;

revoke all on function storefront.card_variants(uuid, uuid[]) from public;
grant execute on function storefront.card_variants(uuid, uuid[]) to storefront_gateway;
