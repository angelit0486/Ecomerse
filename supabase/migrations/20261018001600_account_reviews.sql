-- =============================================================================
-- ADR-029 · Opinar desde «Mi cuenta»: el comprador con cuenta no necesita el
-- enlace del pedido. Mismo patrón que account_get_order: se exige la cuenta de
-- la tienda, el pedido debe ser suyo y se reutilizan las funciones del enlace
-- (mismas reglas: pagado y entregado, producto del pedido, una por producto).
-- =============================================================================
create or replace function public.account_order_reviewables(p_store_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v       public.customers;
  v_token bytea;
begin
  v := app.require_account(p_store_id);
  select o.guest_access_token_hash into v_token from public.orders o
   where o.store_id = p_store_id and o.id = p_order_id and o.customer_id = v.id;
  if not found then
    return '[]'::jsonb;
  end if;
  return storefront.order_reviewables(p_store_id, p_order_id, v_token);
end
$$;

create or replace function public.account_submit_review(p_store_id uuid, p_order_id uuid, p_product_id uuid,
                                                        p_review jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v       public.customers;
  v_token bytea;
begin
  v := app.require_account(p_store_id);
  select o.guest_access_token_hash into v_token from public.orders o
   where o.store_id = p_store_id and o.id = p_order_id and o.customer_id = v.id;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'order';
  end if;
  return storefront.submit_review(p_store_id, p_order_id, v_token, p_product_id, p_review);
end
$$;

revoke all on function public.account_order_reviewables(uuid, uuid) from public;
revoke all on function public.account_submit_review(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.account_order_reviewables(uuid, uuid) to authenticated;
grant execute on function public.account_submit_review(uuid, uuid, uuid, jsonb) to authenticated;
