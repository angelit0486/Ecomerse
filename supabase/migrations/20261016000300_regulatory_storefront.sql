-- =============================================================================
-- Fase R · R-T03 — La ficha sanitaria y las leyendas en la tienda pública
-- (ADR-021, ADR-018). Solo productos publicados de una tienda legible; las
-- leyendas salen de las reglas vigentes del país de la tienda, como texto. La
-- etiqueta interna de cada regla no se publica.
-- =============================================================================

-- Leyendas vigentes de una categoría en el país de la tienda para un lugar.
create or replace function app.compliance_legends(p_store_id uuid, p_category text, p_placement text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', r.key, 'text', r.body) order by r.position, r.key),
                  '[]'::jsonb)
    from public.stores s
    join public.compliance_profiles cp
      on cp.country = s.country::text and cp.category_key = p_category and cp.status = 'active'
    join public.compliance_rules r
      on r.profile_id = cp.id and r.status = 'active' and r.kind = 'required_legend'
   where s.id = p_store_id and p_placement = any (r.placements)
$$;
revoke all on function app.compliance_legends(uuid, text, text) from public;

create or replace function storefront.get_product_regulatory(p_store_id uuid, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'category', i.category_key,
           'category_name', rc.name,
           'data', i.data,
           'legends', app.compliance_legends(p.store_id, i.category_key, 'product_page'))
    from public.products p
    join public.product_regulatory_info i
      on i.store_id = p.store_id and i.product_id = p.id and i.category_key is not null
    join public.regulated_categories rc on rc.key = i.category_key
   where p.store_id = p_store_id and p.slug = p_slug and p.status = 'active' and p.deleted_at is null
     and app.store_publicly_readable(p_store_id)
$$;
revoke all on function storefront.get_product_regulatory(uuid, text) from public;
grant execute on function storefront.get_product_regulatory(uuid, text) to storefront_gateway;

-- Leyendas del carrito o del checkout: las de las categorías de lo que trae el
-- carrito, sin repetir.
create or replace function storefront.cart_legends(p_store_id uuid, p_token text, p_placement text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cart public.carts;
begin
  if p_placement is null or p_placement not in ('cart', 'checkout') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'placement';
  end if;
  if not app.store_accepts_carts(p_store_id, false) then
    return '[]'::jsonb;
  end if;
  v_cart := app.cart_for_token(p_store_id, p_token);
  if v_cart.id is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(x.legend order by x.legend ->> 'key')
      from (select distinct l.value as legend
              from public.cart_items ci
              join public.product_variants v on v.store_id = ci.store_id and v.id = ci.variant_id
              join public.product_regulatory_info i
                on i.store_id = v.store_id and i.product_id = v.product_id and i.category_key is not null
             cross join lateral jsonb_array_elements(app.compliance_legends(p_store_id, i.category_key,
                                                                            p_placement)) l
             where ci.store_id = p_store_id and ci.cart_id = v_cart.id) x), '[]'::jsonb);
end
$$;
revoke all on function storefront.cart_legends(uuid, text, text) from public;
grant execute on function storefront.cart_legends(uuid, text, text) to storefront_gateway;
