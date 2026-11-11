-- =============================================================================
-- Generador de catálogo sintético (Orden 06, T02). SOLO bases locales
-- desechables: vive en el esquema `capgen`, nunca en una migración.
--
-- Determinista: los mismos (semilla, tienda, cantidades) producen los mismos
-- ids, SKU, precios y relaciones. No usa random() ni now() para decidir datos.
-- Respeta el modelo: todo pasa por los triggers reales (búsqueda, precios
-- mínimos, niveles de inventario, validación de variantes) y las existencias
-- entran por app.apply_inventory_movement (regla 10). Sin datos personales:
-- correos @capgen.test y nombres inventados.
--
--   select capgen.store(p_idx, p_products, p_seed);   -- una tienda completa
-- =============================================================================
create schema if not exists capgen;

-- Entero pseudoaleatorio estable en [0, p_mod) a partir de una llave.
create or replace function capgen.h(p_key text, p_mod integer) returns integer
language sql immutable as $$ select (abs(hashtextextended(p_key, 0)) % p_mod)::integer $$;

-- UUID estable a partir de una llave.
create or replace function capgen.id(p_key text) returns uuid
language sql immutable as $$ select md5(p_key)::uuid $$;

create or replace function capgen.plan() returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.plans (key, name) values ('capacity_plan', 'Capacidad')
  on conflict (key) do update set name = excluded.name returning id into v;
  insert into public.plan_entitlements (plan_id, key, value_int) values
    (v, 'max_stores', 1000), (v, 'max_staff', 100), (v, 'max_products', 1000000),
    (v, 'max_variants_per_product', 100), (v, 'storage_mb', 1000000)
  on conflict (plan_id, key) do update set value_int = excluded.value_int;
  return v;
end $$;

-- Una tienda con dueña, 3 personas de equipo, marcas, categorías y p_products
-- productos. Devuelve el id de la tienda. Una transacción por tienda.
create or replace function capgen.store(p_idx integer, p_products integer, p_seed text default 'pruva')
returns uuid language plpgsql as $$
declare
  k        text := p_seed || ':' || p_idx;
  v_store  uuid := capgen.id(k || ':store');
  v_org    uuid := capgen.id(k || ':org');
  v_owner  uuid := capgen.id(k || ':owner');
  v_plan   uuid := capgen.plan();
  v_role   record;
  v_user   uuid;
  tipos    text[] := array['Playera','Tenis','Sudadera','Mochila','Gorra','Pantalón','Chamarra','Calcetas','Termo','Reloj',
                           'Lentes','Cartera','Bolsa','Vestido','Falda','Short','Camisa','Blusa','Botas','Sandalias'];
  mats     text[] := array['algodón','deportiva','urbana','clásica','premium','ligera','térmica','casual','de piel','reciclada'];
  cols     text[] := array['negro','blanco','azul marino','gris','rojo','verde olivo','beige','vino','mostaza','rosa'];
  roots    text[] := array['Ropa','Calzado','Accesorios','Deportes','Hogar','Ofertas'];
begin
  insert into auth.users (id, email) values (v_owner, 'owner' || p_idx || '@capgen.test');
  insert into public.organizations (id, name, slug, country) values (v_org, 'Org cap ' || p_idx, 'org-cap-' || p_idx, 'MX');
  insert into public.subscriptions (organization_id, plan_id, status) values (v_org, v_plan, 'active');
  insert into public.organization_members (organization_id, user_id, role) values (v_org, v_owner, 'org_owner');
  insert into public.stores (id, organization_id, name, handle, currency, country, timezone, status, launched_at, tax_rate_bps)
  values (v_store, v_org, 'Tienda cap ' || p_idx, 'cap-' || p_idx, 'MXN', 'MX', 'America/Mexico_City', 'active',
          '2026-01-01T00:00:00Z', 1600);
  insert into public.store_domains (store_id, hostname, type, status, is_primary, verified_at)
  values (v_store, 'cap-' || p_idx || '.tiendas.localhost', 'platform_subdomain', 'active', true, '2026-01-01T00:00:00Z');
  insert into public.store_themes (store_id) values (v_store);
  insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
  values (v_store, 'manual', 'active', 'Transferencia', '{"instructions":"CLABE 000000000000000000"}');

  -- Equipo con roles reales del sistema (para T05 y T06).
  for v_role in select r.id, r.key from public.roles r
                 where r.organization_id is null and r.key in ('store_admin', 'catalog_manager', 'order_manager', 'viewer') loop
    v_user := capgen.id(k || ':user:' || v_role.key);
    insert into auth.users (id, email) values (v_user, v_role.key || p_idx || '@capgen.test');
    insert into public.organization_members (organization_id, user_id, role) values (v_org, v_user, 'org_member');
    insert into public.store_members (store_id, user_id, role_id) values (v_store, v_user, v_role.id);
  end loop;

  insert into public.brands (id, store_id, name, slug)
  select capgen.id(k || ':brand:' || g), v_store, 'Marca ' || g, 'marca-' || g from generate_series(1, 20) g;

  insert into public.categories (id, store_id, name, slug, position)
  select capgen.id(k || ':cat:' || g), v_store, roots[g], 'cat-' || g, g from generate_series(1, 6) g;
  insert into public.categories (id, store_id, parent_id, name, slug, position)
  select capgen.id(k || ':cat:' || r || ':' || c), v_store, capgen.id(k || ':cat:' || r),
         roots[r] || ' ' || c, 'cat-' || r || '-' || c, c
    from generate_series(1, 6) r, generate_series(1, 5) c;

  -- Como el importador: el límite del plan se comprueba por lote, no por fila.
  insert into system.product_limit_bulk (txid, store_id) values (txid_current(), v_store) on conflict do nothing;

  create temp table cg_p on commit drop as
  select g as n, capgen.id(k || ':p:' || g) as id,
         tipos[1 + capgen.h(k || ':t:' || g, 20)] || ' ' || mats[1 + capgen.h(k || ':m:' || g, 10)] || ' ' ||
           cols[1 + capgen.h(k || ':c:' || g, 10)] || ' modelo ' || g as title,
         capgen.h(k || ':st:' || g, 100) as st,
         capgen.h(k || ':var:' || g, 100) < 40 as multi,
         4900 + capgen.h(k || ':pr:' || g, 4951) * 100 as price,
         capgen.h(k || ':b:' || g, 100) as b
    from generate_series(1, p_products) g;

  insert into public.products (id, store_id, brand_id, title, slug, description_html, status, published_at, tags, specs)
  select p.id, v_store, case when p.b < 90 then capgen.id(k || ':brand:' || (1 + p.b % 20)) end,
         p.title, 'p-' || p.n, '<p>' || p.title || '. Envío a todo México.</p>',
         case when p.st < 85 then 'active' when p.st < 95 then 'draft' else 'archived' end,
         case when p.st < 85 or p.st >= 95 then '2026-01-01T00:00:00Z'::timestamptz + make_interval(mins => p.n) end,
         array['t' || (p.n % 10), 'temporada' || (p.n % 4)],
         jsonb_build_object('material', mats[1 + capgen.h(k || ':m:' || p.n, 10)])
    from cg_p p;

  insert into public.product_options (id, store_id, product_id, name, position)
  select capgen.id(k || ':o:' || p.n), v_store, p.id, 'Talla', 0 from cg_p p where p.multi;
  insert into public.product_option_values (id, store_id, option_id, value, position)
  select capgen.id(k || ':ov:' || p.n || ':' || t.ord), v_store, capgen.id(k || ':o:' || p.n), t.val, t.ord
    from cg_p p cross join (values (0, 'CH'), (1, 'M'), (2, 'G')) t(ord, val) where p.multi;

  create temp table cg_v on commit drop as
  select capgen.id(k || ':v:' || p.n || ':' || t.ord) as id, p.id as product_id, p.n, t.ord, t.val, p.multi,
         p.price + t.ord * 2000 as price
    from cg_p p cross join (values (0, 'CH'), (1, 'M'), (2, 'G')) t(ord, val)
   where p.multi or t.ord = 0;

  insert into public.product_variants (id, store_id, product_id, sku, price, compare_at_price, weight_g, position, option_signature)
  select v.id, v_store, v.product_id, 'C' || p_idx || '-' || v.n || '-' || v.ord, v.price,
         case when capgen.h(k || ':cmp:' || v.n, 100) < 20 then v.price + 10000 end,
         200 + capgen.h(k || ':w:' || v.n, 1800), v.ord,
         case when v.multi then 'Talla=' || v.val else '' end
    from cg_v v;

  insert into public.variant_option_values (variant_id, option_value_id, option_id, store_id)
  select v.id, capgen.id(k || ':ov:' || v.n || ':' || v.ord), capgen.id(k || ':o:' || v.n), v_store
    from cg_v v where v.multi;

  insert into public.variant_costs (store_id, variant_id, cost)
  select v_store, v.id, (v.price * (40 + capgen.h(k || ':cost:' || v.n, 31)) / 100)::bigint
    from cg_v v where capgen.h(k || ':hascost:' || v.n, 100) < 80;

  insert into public.product_categories (product_id, category_id, store_id, is_primary, position)
  select p.id, capgen.id(k || ':cat:' || (1 + capgen.h(k || ':cr:' || p.n, 6)) || ':' || (1 + capgen.h(k || ':cc:' || p.n, 5))),
         v_store, true, 0
    from cg_p p;
  insert into public.product_categories (product_id, category_id, store_id, is_primary, position)
  select p.id, capgen.id(k || ':cat:6'), v_store, false, 1 from cg_p p where capgen.h(k || ':of:' || p.n, 100) < 15;

  -- Existencias por el único camino permitido; 10 % agotado.
  perform app.apply_inventory_movement(v_store, l.id, 'initial',
            case when capgen.h(k || ':q:' || v.n || ':' || v.ord, 100) < 10 then 0
                 else 1 + capgen.h(k || ':qq:' || v.n || ':' || v.ord, 200) end, 0)
     from cg_v v join public.inventory_levels l on l.variant_id = v.id
    where capgen.h(k || ':q:' || v.n || ':' || v.ord, 100) >= 10;

  -- Referencias controladas a imágenes (sin archivos): 70 % de los productos.
  insert into public.media (id, store_id, owner_type, product_id, status, storage_path, mime_type, bytes, width, height, position, variants_done)
  select capgen.id(k || ':img:' || p.n), v_store, 'product', p.id, 'ready',
         v_store || '/product/' || p.id || '/' || capgen.id(k || ':img:' || p.n) || '/original.webp',
         'image/webp', 80000 + capgen.h(k || ':ib:' || p.n, 200000), 1200, 1200, 0, true
    from cg_p p where capgen.h(k || ':hasimg:' || p.n, 100) < 70;

  drop table cg_p; drop table cg_v;
  return v_store;
end $$;

-- Huella del catálogo de una tienda: sirve para comprobar el determinismo.
create or replace function capgen.fingerprint(p_store uuid) returns text language sql stable as $$
  select md5(string_agg(x, '|' order by x)) from (
    select 'p:' || p.id || ':' || p.title || ':' || p.status || ':' || coalesce(p.min_price::text, '') as x
      from public.products p where p.store_id = p_store
    union all
    select 'v:' || v.id || ':' || v.sku || ':' || v.price || ':' || v.option_signature
      from public.product_variants v where v.store_id = p_store
    union all
    select 'l:' || l.variant_id || ':' || l.on_hand from public.inventory_levels l where l.store_id = p_store
    union all
    select 'c:' || c.product_id || ':' || c.category_id from public.product_categories c where c.store_id = p_store
  ) s
$$;

-- ---------------------------------------------------------------- Medición
-- Sesión como una persona del panel (igual que el JWT de Supabase Auth) o como
-- la tienda en línea. `set local`: dura la transacción.
create or replace function capgen.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function capgen.user_id(p_idx integer, p_role text, p_seed text default 'pruva') returns uuid
language sql immutable as $$
  select capgen.id(p_seed || ':' || p_idx || case when p_role = 'owner' then ':owner' else ':user:' || p_role end) $$;

-- Ejecuta p_sql p_runs veces con el rol actual y devuelve mínimo, mediana y máximo (ms).
create or replace function capgen.bench(p_label text, p_sql text, p_runs integer default 5)
returns table (label text, runs integer, min_ms numeric, p50_ms numeric, max_ms numeric, rows bigint)
language plpgsql as $$
declare t0 timestamptz; v_ms numeric[] := '{}'; v_rows bigint; i integer;
begin
  for i in 1 .. p_runs loop
    t0 := clock_timestamp();
    execute 'select count(q::text) from (' || p_sql || ') q' into v_rows;
    v_ms := v_ms || round(1000 * extract(epoch from clock_timestamp() - t0)::numeric, 2);
  end loop;
  return query select p_label, p_runs, (select min(x) from unnest(v_ms) x),
    (select percentile_disc(0.5) within group (order by x) from unnest(v_ms) x),
    (select max(x) from unnest(v_ms) x), v_rows;
end $$;
grant usage on schema capgen to authenticated, storefront_gateway, system_worker;
grant execute on all functions in schema capgen to authenticated, storefront_gateway, system_worker;

-- Clientes y pedidos sintéticos (sin pasar por el checkout): sirven para medir
-- listas del panel y para la matriz de aislamiento. Un artículo por pedido.
create or replace function capgen.orders(p_idx integer, p_orders integer, p_seed text default 'pruva')
returns integer language plpgsql as $$
declare
  k       text := p_seed || ':' || p_idx;
  v_store uuid := capgen.id(k || ':store');
begin
  insert into public.customers (id, store_id, email, first_name)
  select capgen.id(k || ':cust:' || g), v_store, 'cliente' || g || '@capgen.test', 'Cliente ' || g
    from generate_series(1, greatest(p_orders / 3, 1)) g;
  insert into public.orders (id, store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                             customer_id, requires_shipping, currency, prices_include_tax, tax_rate_bps,
                             tax_applies_to_shipping, subtotal, total, status, payment_status, fulfillment_status,
                             placed_at, paid_at, paid_total)
  select capgen.id(k || ':ord:' || g), v_store, g, '#' || (1000 + g), 'capgen-' || k || '-' || g,
         'cliente' || (1 + g % greatest(p_orders / 3, 1)) || '@capgen.test', 'Cliente ' || g,
         capgen.id(k || ':cust:' || (1 + g % greatest(p_orders / 3, 1))), false, 'MXN', true, 1600, false,
         34800, 34800, 'open', 'paid', 'unfulfilled',
         '2026-10-01T00:00:00Z'::timestamptz + make_interval(mins => g),
         '2026-10-01T00:03:00Z'::timestamptz + make_interval(mins => g), 34800
    from generate_series(1, p_orders) g;
  insert into public.order_items (id, store_id, order_id, product_title, product_type, requires_shipping,
                                  unit_price, quantity, line_total)
  select capgen.id(k || ':oi:' || g), v_store, capgen.id(k || ':ord:' || g), 'Artículo ' || g, 'physical', false,
         34800, 1, 34800
    from generate_series(1, p_orders) g;
  return p_orders;
end $$;
grant execute on all functions in schema capgen to authenticated, storefront_gateway, system_worker;
