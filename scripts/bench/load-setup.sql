-- Tienda grande activa, 20 productos sin envío con existencias de sobra y pago manual.
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_big');
insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
values (tests.fx('store_big'), 'manual', 'active', 'Transferencia', '{"instructions": "CLABE 0123"}')
on conflict do nothing;
do $$
declare i int; p uuid; v uuid;
begin
  for i in 1..20 loop
    insert into public.products (store_id, title, slug, status, published_at)
    values (tests.fx('store_big'), 'Carga ' || i, 'carga-' || i, 'active', now()) returning id into p;
    insert into public.product_variants (store_id, product_id, sku, price, option_signature, requires_shipping)
    values (tests.fx('store_big'), p, 'CARGA-' || i, 25000, '', false) returning id into v;
    perform app.apply_inventory_movement(tests.fx('store_big'), l.id, 'initial', 1000000, 0)
       from public.inventory_levels l where l.variant_id = v;
  end loop;
end $$;
select count(*) as variantes from public.product_variants where sku like 'CARGA-%';
-- Los pedidos sintéticos se insertaron directo: el contador de número de pedido
-- de cada tienda sigue al último número usado (si no, place_order chocaría).
insert into public.store_counters (store_id, key, value)
select store_id, 'order_number', max(number) from public.orders group by store_id
on conflict (store_id, key) do update set value = excluded.value;
