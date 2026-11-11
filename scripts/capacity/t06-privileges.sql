-- T06 (2.ª parte): acciones privilegiadas dentro de la PROPIA tienda por rol,
-- las 4 funciones que validan la entrada antes del permiso (con datos válidos y
-- tienda ajena) y el rol `anon`. Se revierte todo.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset fieldsep '|'
\pset tuples_only on
begin;
create or replace function capgen.try(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_det text; v_n bigint;
-- Siempre revierte lo que hizo (subtransacción) y dice cuántas filas tocó.
begin
  execute p_sql; get diagnostics v_n = row_count;
  raise exception using errcode = 'P0001', message = 'capgen_done', detail = v_n::text;
exception when others then
  get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail;
  if v_msg = 'capgen_done' then return 'permitido(' || v_det || ')'; end if;
  return left(v_msg, 40) || coalesce('/' || nullif(v_det, ''), '');
end $$;
grant execute on function capgen.try(text) to authenticated, anon;

create temp table priv (role text, action text, needs text, result text);
grant all on priv to authenticated;
do $$
declare
  r text; a record; s uuid := capgen.id('pruva:2:store'); o uuid := capgen.id('pruva:2:org');
  p uuid := capgen.id('pruva:2:p:1'); v uuid := capgen.id('pruva:2:v:1:0'); v_res text;
begin
  foreach r in array array['owner', 'store_admin', 'catalog_manager', 'order_manager', 'viewer'] loop
    for a in select * from (values
      ('archivar producto', 'products.update', format('select public.catalog_set_product_status(%L, %L, ''archived'')', s, p)),
      ('borrar producto', 'products.delete', format('select public.catalog_soft_delete_product(%L, %L)', s, p)),
      ('etiquetas en bloque', 'products.update', format('select public.catalog_bulk_tags(%L, array[%L]::uuid[], ''x'', ''add'')', s, p)),
      ('ajustar existencias', 'inventory.adjust', format('select public.inventory_adjust(%L, %L, ''adjustment'', 1, ''conteo'')', s, v)),
      ('ver costos (tabla)', 'products.cost.read', format('select 1 from public.variant_costs where store_id = %L', s)),
      ('ver bitácora', 'audit.read', format('select * from public.audit_list(%L, null, null, 10)', s)),
      ('cambiar una función', 'store.update', format('select public.store_set_feature(%L, ''returns'', true)', s)),
      ('cancelar pedido', 'orders.cancel', format('select public.orders_cancel(%L, %L, ''other'', ''prueba'', ''capgen-1'')', s, capgen.id('pruva:2:ord:1'))),
      ('ver contacto del pedido', 'customers.pii.read', format('select public.orders_get_contact(%L, %L)', s, capgen.id('pruva:2:ord:1'))),
      ('invitar persona', 'staff.manage', format('select public.access_invite_member(%L, ''nueva@capgen.test'', null, %L, ''viewer'')', o, s)),
      ('hacerse admin (tabla)', 'nadie', format('update public.store_members set role_id = (select id from public.roles where key = ''store_admin'' and organization_id is null) where store_id = %L and user_id = %L', s, capgen.user_id(2, r))),
      ('crear otra tienda', 'dueña', format('select public.org_create_store(%L, ''Otra'', ''otra-cap'')', o)),
      ('alta directa de producto (tabla)', 'nadie', format('insert into public.products (store_id, title, slug) values (%L, ''x'', ''directo'')', s)),
      ('cambiar precio (tabla)', 'nadie', format('update public.product_variants set price = 1 where id = %L', v))
    ) q(action, needs, sql) loop
      perform capgen.login(capgen.user_id(2, r));
      v_res := capgen.try(a.sql);
      perform set_config('role', 'postgres', true);
      insert into priv values (r, a.action, a.needs, v_res);
    end loop;
  end loop;
end $$;
select 'PRIV', action, needs, string_agg(role || '=' || result, ' ; ' order by role) from priv group by 2, 3 order by 2;

-- Las 4 que validan antes: con datos válidos, la tienda ajena debe negarse.
select capgen.login(capgen.user_id(1, 'owner'));
select 'AJENA', 'access_invite_member', capgen.try(format('select public.access_invite_member(%L, ''x@capgen.test'', null, %L, ''viewer'')', capgen.id('pruva:2:org'), capgen.id('pruva:2:store')));
select 'AJENA', 'catalog_upsert_product', capgen.try(format('select public.catalog_upsert_product(%L, ''{"title":"x","variants":[{"price":100}]}'')', capgen.id('pruva:2:store')));
select 'AJENA', 'media_create_upload', capgen.try(format('select public.media_create_upload(%L, ''product'', null, ''image/webp'', 10)', capgen.id('pruva:2:store')));
select 'AJENA', 'store_copy_structure', capgen.try(format('select public.store_copy_structure(%L, %L, array[''categories''])', capgen.id('pruva:2:store'), capgen.id('pruva:1:store')));
select 'AJENA', 'store_copy_structure(inversa)', capgen.try(format('select public.store_copy_structure(%L, %L, array[''categories''])', capgen.id('pruva:1:store'), capgen.id('pruva:2:store')));
reset role;

-- anon: ninguna tabla ni función pública.
select 'ANON', 'tablas legibles', count(*) from information_schema.tables t
 where table_schema in ('public', 'audit', 'system', 'private', 'storefront', 'app')
   and has_table_privilege('anon', format('%I.%I', table_schema, table_name), 'select,insert,update,delete');
select 'ANON', 'funciones ejecutables', count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'app', 'system', 'storefront', 'private', 'audit') and has_function_privilege('anon', p.oid, 'execute');
select 'GATEWAY', 'tablas con permiso', count(*) from information_schema.tables t
 where table_schema in ('public', 'audit', 'system', 'private', 'app')
   and (has_table_privilege('storefront_gateway', format('%I.%I', table_schema, table_name), 'select,insert,update,delete')
     or has_table_privilege('system_worker', format('%I.%I', table_schema, table_name), 'select,insert,update,delete'));
rollback;
