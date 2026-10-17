-- =============================================================================
-- ADR-029 · Calificación en las tarjetas de producto: promedio y conteo de las
-- opiniones PUBLICADAS de los productos activos de una página del listado (hasta
-- 100). Productos sin opiniones no aparecen (la tarjeta no muestra estrellas).
-- =============================================================================
create or replace function storefront.rating_summaries(p_store_id uuid, p_product_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(x.product_id, jsonb_build_object('average', x.average, 'count', x.count)),
                  '{}'::jsonb)
    from (select r.product_id, round(avg(r.rating)::numeric, 1) as average, count(*)::integer as count
            from public.product_reviews r
            join public.products p on p.store_id = r.store_id and p.id = r.product_id
           where r.store_id = p_store_id and r.status = 'published'
             and r.product_id = any (p_product_ids[1:100])
             and p.status = 'active' and p.deleted_at is null
             and app.store_publicly_readable(p_store_id)
           group by r.product_id) x
$$;

revoke all on function storefront.rating_summaries(uuid, uuid[]) from public;
grant execute on function storefront.rating_summaries(uuid, uuid[]) to storefront_gateway;
