-- =============================================================================
-- T06: matriz de aislamiento. Cada persona (3 tiendas × 5 roles) intenta leer,
-- modificar y borrar lo de las OTRAS dos tiendas por todas las tablas con
-- `store_id` u `organization_id`, y llamar todas las funciones públicas con ids
-- ajenos. Todo en una transacción que se revierte. Resultado esperado: 0 fugas.
--
--   psql -d pruva_cap -f scripts/capacity/t06-isolation.sql
-- =============================================================================
\set ON_ERROR_STOP 1
begin;

create or replace function capgen.isolation(p_stores integer[], p_seed text default 'pruva')
returns table (kind text, actor text, target text, object text, outcome text, detail text)
language plpgsql as $$
declare
  roles_   text[] := array['owner', 'store_admin', 'catalog_manager', 'order_manager', 'viewer'];
  a integer; b integer; r text; t record; f record;
  v_user uuid; v_sa uuid; v_sb uuid; v_oa uuid; v_ob uuid;
  v_n bigint; v_txt text; v_args text; v_msg text; v_det text; v_state text;
  procedure_ text;
begin
  foreach a in array p_stores loop
    v_sa := capgen.id(p_seed || ':' || a || ':store'); v_oa := capgen.id(p_seed || ':' || a || ':org');
    foreach r in array roles_ loop
      v_user := capgen.user_id(a, r, p_seed);
      foreach b in array p_stores loop
        continue when b = a;
        v_sb := capgen.id(p_seed || ':' || b || ':store'); v_ob := capgen.id(p_seed || ':' || b || ':org');
        perform capgen.login(v_user);

        -- 1. Tablas: leer, modificar y borrar filas de la otra tienda u organización.
        for t in
          select c.table_schema as s, c.table_name as n, c.column_name as col
            from information_schema.columns c
            join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
                                             and tb.table_type = 'BASE TABLE'
           where c.table_schema in ('public', 'audit', 'system', 'private', 'storage')
             and c.column_name in ('store_id', 'organization_id')
           order by 1, 2
        loop
          -- leer
          begin
            execute format('select count(*) from %I.%I where %I = %L', t.s, t.n, t.col,
                           case t.col when 'store_id' then v_sb else v_ob end) into v_n;
            kind := 'read'; actor := a || ':' || r; target := b::text; object := t.s || '.' || t.n;
            outcome := case when v_n = 0 then 'ok' else 'LEAK' end; detail := v_n || ' filas'; return next;
          exception when others then
            get stacked diagnostics v_msg = message_text;
            kind := 'read'; actor := a || ':' || r; target := b::text; object := t.s || '.' || t.n;
            outcome := 'ok'; detail := 'denegado: ' || left(v_msg, 60); return next;
          end;
          -- modificar
          begin
            execute format('with x as (update %I.%I set %I = %I where %I = %L returning 1) select count(*) from x',
                           t.s, t.n, t.col, t.col, t.col, case t.col when 'store_id' then v_sb else v_ob end) into v_n;
            kind := 'update'; actor := a || ':' || r; target := b::text; object := t.s || '.' || t.n;
            outcome := case when v_n = 0 then 'ok' else 'LEAK' end; detail := v_n || ' filas'; return next;
          exception when others then
            get stacked diagnostics v_msg = message_text;
            kind := 'update'; actor := a || ':' || r; target := b::text; object := t.s || '.' || t.n;
            outcome := 'ok'; detail := 'denegado: ' || left(v_msg, 60); return next;
          end;
          -- borrar
          begin
            execute format('with x as (delete from %I.%I where %I = %L returning 1) select count(*) from x',
                           t.s, t.n, t.col, case t.col when 'store_id' then v_sb else v_ob end) into v_n;
            kind := 'delete'; actor := a || ':' || r; target := b::text; object := t.s || '.' || t.n;
            outcome := case when v_n = 0 then 'ok' else 'LEAK' end; detail := v_n || ' filas'; return next;
          exception when others then
            get stacked diagnostics v_msg = message_text;
            kind := 'delete'; actor := a || ':' || r; target := b::text; object := t.s || '.' || t.n;
            outcome := 'ok'; detail := 'denegado: ' || left(v_msg, 60); return next;
          end;
        end loop;

        -- 2. Altas con la tienda ajena (incluye escalar privilegios en la otra tienda).
        for t in
          select * from (values
            ('public.products', format('insert into public.products (store_id, title, slug) values (%L, ''x'', ''x-ajeno'')', v_sb)),
            ('public.brands', format('insert into public.brands (store_id, name, slug) values (%L, ''x'', ''x-ajena'')', v_sb)),
            ('public.categories', format('insert into public.categories (store_id, name, slug) values (%L, ''x'', ''x-ajena'')', v_sb)),
            ('public.customers', format('insert into public.customers (store_id, email) values (%L, ''x@capgen.test'')', v_sb)),
            ('public.store_members', format('insert into public.store_members (store_id, user_id, role_id) select %L, %L, id from public.roles where key = ''store_admin'' and organization_id is null', v_sb, v_user)),
            ('public.organization_members', format('insert into public.organization_members (organization_id, user_id, role) values (%L, %L, ''org_owner'')', v_ob, v_user)),
            ('public.media', format('insert into public.media (store_id, owner_type, status, storage_path, mime_type, bytes) values (%L, ''store'', ''pending'', %L, ''image/webp'', 1)', v_sb, v_sb || '/store/x/original.webp')),
            ('storage.objects', format('insert into storage.objects (bucket_id, name) values (''media-uploads'', %L)', v_sb || '/product/x/y/original.webp')),
            ('storage.objects(leer)', format('select 1 / (1 - sign(count(*)))::int from storage.objects where name like %L', v_sb || '/%'))
          ) q(obj, sql)
        loop
          begin
            execute t.sql; get diagnostics v_n = row_count;
            kind := 'insert'; actor := a || ':' || r; target := b::text; object := t.obj;
            outcome := case when v_n = 0 or t.obj like '%(leer)' then 'ok' else 'LEAK' end; detail := v_n || ' filas'; return next;
          exception when others then
            get stacked diagnostics v_msg = message_text;
            kind := 'insert'; actor := a || ':' || r; target := b::text; object := t.obj;
            outcome := case when t.obj like '%(leer)' and v_msg = 'division by zero' then 'LEAK' else 'ok' end;
            detail := 'denegado: ' || left(v_msg, 60); return next;
          end;
        end loop;

        -- 3. Funciones públicas con ids de la otra tienda.
        for f in
          select p.oid, p.proname, p.pronargs, p.proargnames, p.proargtypes::oid[] as types, p.proretset
            from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
             and has_function_privilege('authenticated', p.oid, 'execute')
             and p.proargnames && array['p_store_id', 'p_org_id', 'p_organization_id']
           order by p.proname
        loop
          select string_agg(
                   case
                     when f.proargnames[i] = 'p_store_id' then quote_literal(v_sb)
                     when f.proargnames[i] in ('p_org_id', 'p_organization_id') then quote_literal(v_ob)
                     when f.proargnames[i] = 'p_product_id' then quote_literal(capgen.id(p_seed || ':' || b || ':p:1'))
                     when f.proargnames[i] = 'p_product_ids' then format('array[%L]::uuid[]', capgen.id(p_seed || ':' || b || ':p:1'))
                     when f.proargnames[i] = 'p_variant_id' then quote_literal(capgen.id(p_seed || ':' || b || ':v:1:0'))
                     when f.proargnames[i] = 'p_category_id' then quote_literal(capgen.id(p_seed || ':' || b || ':cat:1'))
                     when f.proargnames[i] = 'p_brand_id' then quote_literal(capgen.id(p_seed || ':' || b || ':brand:1'))
                     when f.proargnames[i] = 'p_order_id' then quote_literal(capgen.id(p_seed || ':' || b || ':ord:1'))
                     when f.proargnames[i] = 'p_customer_id' then quote_literal(capgen.id(p_seed || ':' || b || ':cust:1'))
                     when f.proargnames[i] = 'p_user_id' then quote_literal(v_user)
                     else 'null'
                   end || '::' || format_type(f.types[i - 1], null), ', ' order by i)
            into v_args
            from generate_series(1, f.pronargs) i;
          begin
            execute format('select count(*), left(string_agg(q::text, '' ''), 120) from (select * from public.%I(%s)) q',
                           f.proname, v_args) into v_n, v_txt;
            kind := 'function'; actor := a || ':' || r; target := b::text; object := f.proname;
            outcome := case when v_n = 0 or coalesce(v_txt, '') in ('', '()', '(f)', '([])', '({})', '(0)', '("[]")', '("{}")')
                            then 'ok' else 'REVIEW' end;
            detail := 'devolvió ' || v_n || ': ' || coalesce(v_txt, ''); return next;
          exception when others then
            get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail, v_state = returned_sqlstate;
            kind := 'function'; actor := a || ':' || r; target := b::text; object := f.proname;
            outcome := case when v_msg in ('forbidden', 'not_found', 'unauthenticated') or v_state = '42501' then 'ok'
                            else 'ok*' end;
            detail := v_state || ' ' || left(v_msg, 50) || coalesce('/' || nullif(v_det, ''), ''); return next;
          end;
        end loop;
        perform set_config('role', 'postgres', true);
      end loop;
    end loop;
  end loop;
end $$;

create temp table iso as select * from capgen.isolation(array[1, 2, 3]);
\pset format unaligned
\pset fieldsep '|'
\pset tuples_only on
select 'TOTAL', count(*) from iso;
select 'POR TIPO', kind, outcome, count(*) from iso group by 2, 3 order by 2, 3;
select 'FUGA', * from iso where outcome = 'LEAK' limit 50;
select 'REVISAR', object, count(*), min(detail) from iso where outcome = 'REVIEW' group by 2 order by 2;
select 'ANTES-DE-PERMISO', object, count(*), min(detail) from iso where outcome = 'ok*' group by 2 order by 2;
rollback;
