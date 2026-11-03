-- =============================================================================
-- Llave primaria en system.auth_login_intents (la única tabla sin ella) e
-- índices para las llaves foráneas que se recorren al crecer:
--   - al borrar o desactivar lo referido (variante, imagen, marca, cliente, pago),
--     Postgres busca filas que lo usen; sin índice recorre la tabla entera de la
--     tienda (pedidos y carritos son las tablas que más crecen);
--   - consultas habituales del panel (reembolsos de un pago, carritos de un
--     cliente, pedido de un carrito).
-- Parciales `where … is not null` cuando la columna es opcional. Las FK de
-- catálogos pequeños (planes, permisos, roles, categorías reguladas) y de quién
-- creó algo en tablas del staff quedan sin índice a propósito: la lista vive en
-- la metaprueba 118, que obliga a decidir cada FK nueva.
-- =============================================================================

alter table system.auth_login_intents add column id uuid not null default app.uuid_v7();
alter table system.auth_login_intents add constraint auth_login_intents_pkey primary key (id);
create index auth_login_intents_store_idx on system.auth_login_intents (store_id);

-- Pedidos y lo que cuelga de ellos.
create index order_items_variant_idx on public.order_items (store_id, variant_id) where variant_id is not null;
create index order_items_product_idx on public.order_items (store_id, product_id) where product_id is not null;
create index orders_cart_idx on public.orders (store_id, cart_id) where cart_id is not null;
create index orders_shipping_rate_idx on public.orders (store_id, shipping_rate_id) where shipping_rate_id is not null;
create index refunds_payment_idx on public.refunds (store_id, payment_id);
create index shipment_items_order_item_idx on public.shipment_items (store_id, order_item_id);
create index supplier_order_items_order_item_idx on public.supplier_order_items (store_id, order_item_id);
create index supplier_order_items_variant_idx on public.supplier_order_items (store_id, variant_id) where variant_id is not null;
create index discount_redemptions_customer_fk_idx on public.discount_redemptions (store_id, customer_id) where customer_id is not null;

-- Carritos.
create index cart_items_variant_idx on public.cart_items (store_id, variant_id);
create index carts_customer_idx on public.carts (store_id, customer_id) where customer_id is not null;
create index carts_shipping_rate_idx on public.carts (store_id, shipping_rate_id) where shipping_rate_id is not null;

-- Catálogo.
create index products_brand_idx on public.products (store_id, brand_id) where brand_id is not null;
create index product_variants_image_idx on public.product_variants (store_id, image_id) where image_id is not null;
create index variant_option_values_option_value_idx on public.variant_option_values (store_id, option_value_id, option_id);
create index variant_costs_store_idx on public.variant_costs (store_id);
create index inventory_reservation_items_level_idx on public.inventory_reservation_items (store_id, level_id);
create index shipping_rates_zone_idx on public.shipping_rates (store_id, zone_id);
create index media_created_by_idx on public.media (created_by) where created_by is not null;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261029001300'::text
$$;
