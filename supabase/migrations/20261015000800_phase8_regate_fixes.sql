-- =============================================================================
-- Gate F8 · Segunda revisión adversarial (PHASE-08-REPORT §5): correcciones de
-- G-H1, G-H2, G-M1..G-M4 y G-L1..G-L3 sobre 20261015000700.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. G-H1: la cuenta del comprador solo responde a una sesión que entró con un
--    código por email. GoTrue une un alta con contraseña y un código posterior al
--    mismo usuario: quien registró antes el email ajeno con una contraseña llegaba
--    a la cuenta ya vinculada (pedidos, direcciones, perfil). Ningún flujo de la
--    plataforma usa contraseñas (compradores con código; staff con código + TOTP).
-- -----------------------------------------------------------------------------
create or replace function app.session_from_email_code()
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from jsonb_array_elements(
                    case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) a
     where a ->> 'method' in ('otp', 'magiclink', 'email/signup'))
$$;
revoke all on function app.session_from_email_code() from public;
-- Se evalúa en las políticas de customers (con los privilegios de quien consulta).
grant execute on function app.session_from_email_code() to authenticated;

create or replace function app.account_customer(p_store_id uuid)
returns public.customers
language sql
stable
security definer
set search_path = ''
as $$
  select c.* from public.customers c
    join public.stores s on s.id = c.store_id and s.status = 'active'
    join auth.users u on u.id = c.user_id
   where c.store_id = p_store_id and c.user_id = auth.uid() and auth.uid() is not null
     and c.email = lower(u.email)
     and c.anonymized_at is null and c.deleted_at is null
     and app.session_from_email_code()
$$;
revoke all on function app.account_customer(uuid) from public;

-- La matriz §12.3 se conserva (el comprador lee y edita su contacto), solo que
-- ahora exige la misma sesión que la cuenta.
alter policy customers_select_self on public.customers
  using (user_id = (select auth.uid()) and (select app.session_from_email_code()));
alter policy customers_update_self on public.customers
  using (user_id = (select auth.uid()) and (select app.session_from_email_code()))
  with check (user_id = (select auth.uid()) and (select app.session_from_email_code()));

-- -----------------------------------------------------------------------------
-- 2. G-H2 y G-L1: un CHECK NOT VALID se vuelve a comprobar en CUALQUIER UPDATE de
--    la fila. Un teléfono anterior a la regla bloqueaba el checkout (upsert del
--    cliente) y la confirmación del pago (contador de pedidos); un nombre de
--    categoría anterior impedía borrarla. Ahora un trigger valida el valor solo
--    cuando se escribe o cambia: los datos viejos no estorban y no se pierden.
-- -----------------------------------------------------------------------------
alter table public.customers drop constraint customers_phone_format;

create or replace function app.customers_phone_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.phone is not null and (tg_op = 'INSERT' or new.phone is distinct from old.phone)
     and new.phone !~ '^\+?[0-9 ()-]{7,20}$' then
    raise exception using errcode = '23514', message = 'customers_phone_format',
                          detail = 'Teléfono con el formato del checkout (7 a 20 dígitos, espacios, +, guiones o paréntesis).';
  end if;
  return new;
end
$$;
revoke all on function app.customers_phone_guard() from public;
-- Después de customers_anonymized_guard (orden alfabético): un anonimizado ya llega con NULL.
create trigger customers_phone_guard before insert or update of phone on public.customers
  for each row execute function app.customers_phone_guard();

alter table public.categories drop constraint categories_name_no_separators;

create or replace function app.categories_name_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.name is distinct from old.name) and new.name ~ '[|>]' then
    raise exception using errcode = '23514', message = 'categories_name_no_separators';
  end if;
  return new;
end
$$;
revoke all on function app.categories_name_guard() from public;
create trigger categories_name_guard before insert or update of name on public.categories
  for each row execute function app.categories_name_guard();

-- -----------------------------------------------------------------------------
-- 3. G-M1: la vista previa valida el conjunto final de variantes (lo que el
--    archivo trae combinado con lo que se conserva).
-- -----------------------------------------------------------------------------
create or replace function app.import_resolve(p_store_id uuid, p_mode text, p_n jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_handle    text := p_n ->> 'handle';
  v_prod      jsonb := coalesce(p_n -> 'product', '{}'::jsonb);
  v_existing  public.products;
  v_errors    jsonb := '[]'::jsonb;
  v_ex_opts   jsonb := '[]'::jsonb;
  v_ex_vars   jsonb := '[]'::jsonb;
  v_names     text[];
  v_has_opts  boolean;
  v_used      jsonb := '{}'::jsonb;  -- {variant_id: fila}
  v_out       jsonb := '[]'::jsonb;
  v_targets   jsonb := '[]'::jsonb;
  v_var       jsonb;
  v_match     jsonb;
  v_outv      jsonb;
  v_opts      jsonb;
  v_row       integer;
  v_first     integer;
  v_sku       text;
  v_next_pos  integer := 0;
  v_count     integer;
  v_payload   jsonb;
  v_opt_out   jsonb;
  v_qty       jsonb;
  v_touches   boolean := false;  -- ¿cambia algo del catálogo (no solo existencias)?
begin
  if jsonb_typeof(p_n -> 'variants') is distinct from 'array' or jsonb_array_length(p_n -> 'variants') = 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rows';
  end if;
  v_count := jsonb_array_length(p_n -> 'variants');
  v_first := (p_n -> 'variants' -> 0 ->> 'row_number')::integer;
  if v_count > 100 then
    v_errors := v_errors || jsonb_build_object('row', v_first, 'message', 'un producto puede tener hasta 100 variantes');
  end if;
  if p_n ? 'status' and coalesce(p_n ->> 'status', '') not in ('draft', 'active', 'archived') then
    v_errors := v_errors || jsonb_build_object('row', v_first, 'message', 'status: usa draft, active o archived');
  end if;
  if p_n ? 'brand' and (jsonb_typeof(p_n -> 'brand') not in ('string', 'null') or char_length(p_n ->> 'brand') > 120) then
    v_errors := v_errors || jsonb_build_object('row', v_first, 'message', 'brand: hasta 120 caracteres');
  end if;
  if p_n ? 'categories' and (jsonb_array_length(p_n -> 'categories') > 20 or exists (
       select 1 from jsonb_array_elements(p_n -> 'categories') c
        where jsonb_typeof(c) <> 'string' or nullif(btrim(c #>> '{}'), '') is null or char_length(c #>> '{}') > 300)) then
    v_errors := v_errors || jsonb_build_object('row', v_first, 'message', 'categories: hasta 20 rutas de categoría');
  end if;
  v_touches := v_prod <> '{}'::jsonb or p_n ? 'brand' or p_n ? 'categories';

  select * into v_existing from public.products p
   where p.store_id = p_store_id and p.slug = v_handle and p.deleted_at is null;
  if v_existing.id is null and p_mode = 'update_existing' then
    v_errors := v_errors || jsonb_build_object('row', v_first, 'message', 'handle: no existe un producto con ese handle');
  elsif v_existing.id is not null and p_mode = 'create_only' then
    v_errors := v_errors || jsonb_build_object('row', v_first, 'message', 'handle: ya existe un producto con ese handle');
  end if;
  if v_existing.id is null and nullif(btrim(v_prod ->> 'title'), '') is null then
    v_errors := v_errors || jsonb_build_object('row', v_first, 'message', 'title: es obligatorio para crear el producto');
  end if;

  -- Opciones del archivo para este producto (null = el archivo no trae columnas de opciones).
  if jsonb_typeof(p_n -> 'option_names') = 'array' then
    select coalesce(array_agg(btrim(x) order by o), '{}') into v_names
      from jsonb_array_elements_text(p_n -> 'option_names') with ordinality t(x, o)
     where btrim(x) <> '';
  end if;
  v_has_opts := coalesce(cardinality(v_names), 0) > 0;
  if v_existing.id is null and not v_has_opts and v_count > 1 then
    v_errors := v_errors || jsonb_build_object('row', v_first, 'message',
      'option1_name: para crear un producto con varias variantes incluye las columnas de opciones');
  end if;

  if v_existing.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', o.name,
             'values', (select coalesce(jsonb_agg(ov.value order by ov.position, ov.value), '[]'::jsonb)
                          from public.product_option_values ov where ov.option_id = o.id))
           order by o.position, o.name), '[]'::jsonb)
      into v_ex_opts
      from public.product_options o where o.product_id = v_existing.id;
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', pv.id, 'sku', pv.sku, 'barcode', pv.barcode, 'price', pv.price,
             'compare_at_price', pv.compare_at_price, 'status', pv.status, 'position', pv.position,
             'options', (select coalesce(jsonb_object_agg(o.name, ov.value), '{}'::jsonb)
                           from public.variant_option_values vov
                           join public.product_option_values ov on ov.id = vov.option_value_id
                           join public.product_options o on o.id = vov.option_id
                          where vov.variant_id = pv.id))
           order by pv.position, pv.id), '[]'::jsonb)
      into v_ex_vars
      from public.product_variants pv where pv.product_id = v_existing.id and pv.deleted_at is null;
    select coalesce(max((x ->> 'position')::integer) + 1, 0) into v_next_pos from jsonb_array_elements(v_ex_vars) x;

    if v_has_opts then
      if jsonb_array_length(v_ex_opts) = 0 then
        v_errors := v_errors || jsonb_build_object('row', v_first, 'message',
          'option1_name: el producto no tiene opciones; agrégalas desde el panel antes de importar variantes');
      elsif (select array_agg(lower(x ->> 'name') order by lower(x ->> 'name')) from jsonb_array_elements(v_ex_opts) x)
            is distinct from (select array_agg(lower(n) order by lower(n)) from unnest(v_names) n) then
        v_errors := v_errors || jsonb_build_object('row', v_first, 'message',
          format('option1_name: usa las opciones del producto (%s)',
                 (select string_agg(x ->> 'name', ', ') from jsonb_array_elements(v_ex_opts) x)));
      end if;
    end if;
    -- Con un producto existente se usan sus nombres de opción (y su orden).
    select coalesce(array_agg(x ->> 'name'), '{}') into v_names from jsonb_array_elements(v_ex_opts) x;
  else
    v_names := coalesce(v_names, '{}');
  end if;

  for v_var in select x from jsonb_array_elements(p_n -> 'variants') x loop
    v_row := (v_var ->> 'row_number')::integer;
    v_sku := upper(nullif(btrim(v_var ->> 'sku'), ''));
    v_opts := case when v_has_opts then app.import_options_as(v_var -> 'options', v_names) else null end;
    v_match := null;

    if v_var ? 'price' and jsonb_typeof(v_var -> 'price') <> 'number' then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'price: escribe un importe como 199.50');
    end if;
    v_qty := v_var -> 'quantity';
    if v_qty is not null and (jsonb_typeof(v_qty) <> 'number' or (v_qty #>> '{}')::numeric
                                not between 0 and 1000000 or (v_qty #>> '{}')::numeric % 1 <> 0) then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'inventory_quantity: usa un entero entre 0 y 1000000');
      v_qty := null;
    end if;
    if v_sku is not null and exists (
         select 1 from public.product_variants pv
          where pv.store_id = p_store_id and pv.sku = v_sku and pv.deleted_at is null
            and pv.product_id is distinct from v_existing.id) then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', format('sku: %s ya pertenece a otro producto', v_sku));
    end if;
    if nullif(btrim(v_var ->> 'barcode'), '') is not null and exists (
         select 1 from public.product_variants pv
          where pv.store_id = p_store_id and pv.barcode = btrim(v_var ->> 'barcode') and pv.deleted_at is null
            and pv.product_id is distinct from v_existing.id) then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'barcode: ya pertenece a otro producto');
    end if;

    if v_existing.id is not null then
      -- 1) por SKU; 2) por combinación de opciones; 3) producto simple de una sola fila.
      if v_sku is not null then
        select x into v_match from jsonb_array_elements(v_ex_vars) x where upper(x ->> 'sku') = v_sku;
      end if;
      if v_match is null and v_has_opts then
        select x into v_match from jsonb_array_elements(v_ex_vars) x
         where app.import_options_key(x -> 'options') = app.import_options_key(v_opts);
      end if;
      if v_match is null and jsonb_array_length(v_ex_opts) = 0 and jsonb_array_length(v_ex_vars) = 1 and v_count = 1 then
        v_match := v_ex_vars -> 0;
      end if;
    end if;

    if v_match is not null and v_used ? (v_match ->> 'id') then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message',
        format('variante repetida: es la misma de la fila %s', v_used ->> (v_match ->> 'id')));
      continue;
    end if;

    if v_match is not null then
      v_used := v_used || jsonb_build_object(v_match ->> 'id', v_row);
      -- Solo existencias (y la identificación de la variante) no tocan el catálogo.
      if exists (select 1 from jsonb_object_keys(v_var) k where k not in ('row_number', 'quantity', 'sku', 'options'))
         or (v_var ? 'sku' and v_sku is distinct from upper(v_match ->> 'sku'))
         or (v_has_opts and app.import_options_key(v_opts) <> app.import_options_key(v_match -> 'options')) then
        v_touches := true;
      end if;
      -- Lo que el archivo no trae se conserva (pesos y medidas: catalog_upsert_product
      -- conserva las claves ausentes; el resto se copia de la variante actual).
      v_outv := jsonb_build_object(
        '_row', v_row,
        'id', v_match -> 'id',
        'options', coalesce(v_opts, v_match -> 'options'),
        'sku', case when v_var ? 'sku' then to_jsonb(v_sku) else v_match -> 'sku' end,
        'barcode', case when v_var ? 'barcode' then to_jsonb(nullif(btrim(v_var ->> 'barcode'), '')) else v_match -> 'barcode' end,
        'price', coalesce(v_var -> 'price', v_match -> 'price'),
        'compare_at_price', case when v_var ? 'compare_at_price' then v_var -> 'compare_at_price'
                                 else v_match -> 'compare_at_price' end,
        'status', coalesce(v_var -> 'status', v_match -> 'status'),
        'position', v_match -> 'position');
    else
      if v_existing.id is not null and jsonb_array_length(v_ex_opts) > 0 and not v_has_opts then
        v_errors := v_errors || jsonb_build_object('row', v_row, 'message',
          'sku: no coincide con ninguna variante del producto; para agregar variantes incluye las columnas de opciones');
      elsif v_existing.id is not null and jsonb_array_length(v_ex_opts) = 0 then
        v_errors := v_errors || jsonb_build_object('row', v_row, 'message',
          'el producto no tiene opciones: solo puede tener una variante (indica su SKU)');
      elsif not (v_var ? 'price') then
        v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'price: es obligatorio para una variante nueva');
      end if;
      v_touches := true;
      v_outv := jsonb_build_object(
        '_row', v_row,
        'options', coalesce(v_opts, '{}'::jsonb),
        'sku', to_jsonb(v_sku),
        'barcode', to_jsonb(nullif(btrim(v_var ->> 'barcode'), '')),
        'price', v_var -> 'price',
        'compare_at_price', v_var -> 'compare_at_price',
        'status', coalesce(v_var -> 'status', to_jsonb('active'::text)),
        'position', v_next_pos);
      v_next_pos := v_next_pos + 1;
    end if;
    v_outv := v_outv || (select coalesce(jsonb_object_agg(k, v_var -> k), '{}'::jsonb)
                           from unnest(array['weight_g', 'length_mm', 'width_mm', 'height_mm',
                                             'requires_shipping', 'inventory_policy']) k
                          where v_var ? k);
    v_out := v_out || v_outv;
    if v_qty is not null then
      v_targets := v_targets || jsonb_build_object('row_number', v_row, 'quantity', v_qty, 'id', v_outv -> 'id',
                                                   'sku', to_jsonb(v_outv ->> 'sku'), 'options', v_outv -> 'options');
    end if;
  end loop;

  -- Las variantes que el archivo no menciona se conservan tal cual.
  v_out := v_out || (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', x -> 'id', 'options', x -> 'options', 'sku', x -> 'sku', 'barcode', x -> 'barcode',
                        'price', x -> 'price', 'compare_at_price', x -> 'compare_at_price', 'status', x -> 'status',
                        'position', x -> 'position')), '[]'::jsonb)
                       from jsonb_array_elements(v_ex_vars) x where not v_used ? (x ->> 'id'));

  -- G-M1 (segunda revisión del gate): lo que solo se ve al combinar el archivo con lo
  -- actual. Sin esto la vista previa salía limpia y la confirmación fallaba entera con
  -- un mensaje genérico (los índices únicos se comprueban fila por fila, así que un
  -- intercambio entre dos variantes tampoco se puede aplicar en una sola importación).
  v_errors := v_errors || coalesce((
    with f as (
      select t.x, (t.x ->> '_row')::integer as r, t.o
        from jsonb_array_elements(v_out) with ordinality t(x, o)
    )
    select jsonb_agg(jsonb_build_object('row', e.r, 'message', e.m) order by e.r, e.m)
      from (
        select f.r, 'compare_at_price: debe ser mayor que price (con el precio que conserva la variante)' as m
          from f
         where f.r is not null and jsonb_typeof(f.x -> 'price') = 'number'
           and jsonb_typeof(f.x -> 'compare_at_price') = 'number'
           and (f.x ->> 'compare_at_price')::numeric <= (f.x ->> 'price')::numeric
        union all
        select f.r, format('sku: %s ya lo tiene otra variante del producto (para intercambiarlos, usa dos importaciones)',
                           f.x ->> 'sku')
          from f
         where f.r is not null and nullif(f.x ->> 'sku', '') is not null
           and (exists (select 1 from jsonb_array_elements(v_ex_vars) e
                         where (e ->> 'id') is distinct from (f.x ->> 'id') and upper(e ->> 'sku') = upper(f.x ->> 'sku'))
                or exists (select 1 from f g
                            where g.o < f.o and g.r is not null and upper(g.x ->> 'sku') = upper(f.x ->> 'sku')))
        union all
        select f.r, 'barcode: ya lo tiene otra variante del producto (para intercambiarlos, usa dos importaciones)'
          from f
         where f.r is not null and nullif(f.x ->> 'barcode', '') is not null
           and (exists (select 1 from jsonb_array_elements(v_ex_vars) e
                         where (e ->> 'id') is distinct from (f.x ->> 'id') and e ->> 'barcode' = f.x ->> 'barcode')
                or exists (select 1 from f g
                            where g.o < f.o and g.r is not null and g.x ->> 'barcode' = f.x ->> 'barcode'))
        union all
        select f.r, 'opciones: esa combinación ya la tiene otra variante del producto'
          from f
         where f.r is not null and coalesce(cardinality(v_names), 0) > 0
           and (exists (select 1 from jsonb_array_elements(v_ex_vars) e
                         where (e ->> 'id') is distinct from (f.x ->> 'id')
                           and app.import_options_key(e -> 'options') = app.import_options_key(f.x -> 'options'))
                or exists (select 1 from f g
                            where g.o < f.o and g.r is not null
                              and app.import_options_key(g.x -> 'options') = app.import_options_key(f.x -> 'options')))
      ) e), '[]'::jsonb);

  -- Valores de opción: los actuales (nunca se borran) + los nuevos del archivo, en orden de aparición.
  select coalesce(jsonb_agg(jsonb_build_object('name', n.name, 'values', coalesce((
           select jsonb_agg(d.val order by d.seq)
             from (select distinct on (lower(btrim(u.val))) btrim(u.val) as val, u.seq
                     from (select e.val, e.seq from jsonb_array_elements_text(n.ex_values) with ordinality e(val, seq)
                           union all
                           select x -> 'options' ->> n.name, 100000 + o
                             from jsonb_array_elements(v_out) with ordinality t(x, o)
                            where nullif(btrim(x -> 'options' ->> n.name), '') is not null) u
                    order by lower(btrim(u.val)), u.seq) d), '[]'::jsonb))
         order by n.ord), '[]'::jsonb)
    into v_opt_out
    from (select nm as name, ord,
                 coalesce((select y -> 'values' from jsonb_array_elements(v_ex_opts) y where y ->> 'name' = nm),
                          '[]'::jsonb) as ex_values
            from unnest(v_names) with ordinality q(nm, ord)) n;

  v_payload := jsonb_build_object(
    'title', coalesce(nullif(btrim(v_prod ->> 'title'), ''), v_existing.title),
    'slug', v_handle,
    'description_html', case when v_prod ? 'description_html' then v_prod -> 'description_html'
                             else to_jsonb(v_existing.description_html) end,
    'tags', case when v_prod ? 'tags' then coalesce(v_prod -> 'tags', '[]'::jsonb)
                 else to_jsonb(coalesce(v_existing.tags, '{}'::text[])) end,
    'seo_title', case when v_prod ? 'seo_title' then v_prod -> 'seo_title' else to_jsonb(v_existing.seo_title) end,
    'seo_description', case when v_prod ? 'seo_description' then v_prod -> 'seo_description'
                            else to_jsonb(v_existing.seo_description) end,
    'options', v_opt_out,
    'variants', (select coalesce(jsonb_agg(t.x - '_row' order by t.o), '[]'::jsonb)
                   from jsonb_array_elements(v_out) with ordinality t(x, o)));
  if v_existing.id is not null then
    v_payload := v_payload || jsonb_build_object('id', v_existing.id, 'brand_id', v_existing.brand_id);
  end if;

  return jsonb_build_object('action', case when v_existing.id is null then 'create' else 'update' end,
                            'product_id', v_existing.id, 'status', v_existing.status, 'first_row', v_first,
                            'touches_catalog', v_existing.id is null or v_touches,
                            'errors', v_errors, 'payload', v_payload, 'targets', v_targets);
end
$$;
revoke all on function app.import_resolve(uuid, text, jsonb) from public;

-- -----------------------------------------------------------------------------
-- 4. G-M2, G-M3 y G-M4: límite de productos en la importación.
--    * G-M3: la marca de lote ya no es un GUC (cualquier sesión puede fijarlo): es
--      una fila de esta tabla, que solo escriben funciones privilegiadas, ligada a
--      la transacción y a la tienda.
--    * G-M2: un lote que no crea productos no consulta el límite (una organización
--      por encima de su plan sigue operando lo que ya tiene, como en el panel).
--    * G-M4: el candado de la organización se toma al final y no durante todo el
--      lote: el panel de las otras tiendas de la organización sigue trabajando.
-- -----------------------------------------------------------------------------
create table system.product_limit_bulk (
  txid     bigint not null,
  store_id uuid not null references public.stores (id) on delete cascade,
  primary key (txid, store_id)
);
alter table system.product_limit_bulk enable row level security;
alter table system.product_limit_bulk force row level security;
revoke all on table system.product_limit_bulk from public, anon, authenticated, service_role, storefront_gateway,
  system_worker;
create trigger product_limit_bulk_prevent_tenant_change before update on system.product_limit_bulk
  for each row execute function app.prevent_tenant_change();

create or replace function app.enforce_product_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or (old.deleted_at is not null and new.deleted_at is null) then
    -- system.import_commit comprueba el lote completo (al empezar y, con el candado
    -- de la organización, al terminar): un conteo por producto lo hacía cuadrático.
    if exists (select 1 from system.product_limit_bulk b
                where b.txid = pg_catalog.txid_current() and b.store_id = new.store_id) then
      return new;
    end if;
    perform app.assert_within_limit((select s.organization_id from public.stores s where s.id = new.store_id),
                                    'max_products');
  end if;
  return new;
end
$$;
revoke all on function app.enforce_product_limit() from public;

create or replace function system.import_commit(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job      public.import_jobs;
  v_org      uuid;
  v_uid      uuid;
  v_row      record;
  v_n        jsonb;
  v_res      jsonb;
  v_payload  jsonb;
  v_product  uuid;
  v_brand    uuid;
  v_t        jsonb;
  v_variant  uuid;
  v_level    uuid;
  v_on_hand  integer;
  v_status   text;
  v_need     text;
  v_creates  integer;
  v_created  integer := 0;
  v_updated  integer := 0;
  v_rownum   integer;
  v_msg      text;
  v_detail   text;
  v_hint     text;
  v_error    text;
  v_done     integer := 0;
  v_cold     boolean;
begin
  select * into v_job from public.import_jobs j where j.id = p_job_id for update;
  if v_job.id is null then
    return jsonb_build_object('status', 'missing');
  end if;
  if v_job.status <> 'committing' then
    return jsonb_build_object('status', v_job.status, 'replayed', true);
  end if;
  select s.organization_id into v_org from public.stores s where s.id = v_job.store_id;
  v_uid := v_job.commit_requested_by;

  -- CF-10: quien confirmó debe CONSERVAR ahora los permisos que exige este lote.
  select n into v_need from unnest(array['imports.run'] || v_job.needs) with ordinality q(n, o)
   where not coalesce(system.user_has_store_permission(v_uid, v_job.store_id, n), false)
   order by o limit 1;
  if v_need is not null then
    perform app.import_mark_failed(v_job.id, format('Quien confirmó ya no tiene el permiso necesario (%s).', v_need));
    return jsonb_build_object('status', 'failed', 'error', 'forbidden', 'permission', v_need);
  end if;

  -- Las RPC del catálogo actúan como el solicitante: comprueban otra vez sus
  -- permisos y lo registran como autor. Solo dura esta transacción del worker.
  perform set_config('request.jwt.claims',
                     jsonb_build_object('sub', v_uid, 'role', 'authenticated', 'aal', 'aal2',
                                        'pruva_job', 'import.commit')::text, true);
  select count(*) into v_creates from public.import_job_rows r where r.import_job_id = v_job.id and r.action = 'create';
  -- Plataforma recién creada: sin estadísticas, el planificador recorre tablas
  -- enteras en cada búsqueda mientras el lote las hace crecer (cuadrático).
  v_cold := not exists (select 1 from pg_catalog.pg_stats st
                         where st.schemaname = 'public' and st.tablename = 'products' and st.attname = 'store_id')
         or not exists (select 1 from pg_catalog.pg_stats st
                         where st.schemaname = 'public' and st.tablename = 'inventory_levels' and st.attname = 'variant_id');

  begin
    -- Límite del plan (G-M2, G-M4): solo si el lote crea productos. Aviso temprano sin
    -- candado; la comprobación que cuenta va al final, con el candado de la
    -- organización, para no frenar su catálogo durante todo el lote. La marca de lote
    -- (G-M3) vive en una tabla del sistema que solo escriben funciones privilegiadas.
    if v_creates > 0 then
      if app.current_usage(v_org, 'max_products') + v_creates > app.effective_limit(v_org, 'max_products') then
        raise exception using errcode = 'P0001', message = 'limit_reached', detail = 'max_products';
      end if;
      insert into system.product_limit_bulk (txid, store_id) values (pg_catalog.txid_current(), v_job.store_id)
      on conflict do nothing;
    end if;

    for v_row in
      select r.id, r.row_number, r.normalized from public.import_job_rows r
       where r.import_job_id = v_job.id and r.normalized is not null
       order by r.row_number
    loop
      v_rownum := v_row.row_number;
      v_n := v_row.normalized;
      -- Se resuelve con los datos de AHORA (algo pudo cambiar desde la vista previa).
      v_res := app.import_resolve(v_job.store_id, v_job.mode, v_n);
      if jsonb_array_length(v_res -> 'errors') > 0 then
        v_rownum := coalesce((v_res -> 'errors' -> 0 ->> 'row')::integer, v_rownum);
        raise exception using errcode = 'P0001', message = 'import_row', detail = v_res -> 'errors' -> 0 ->> 'message';
      end if;
      v_payload := v_res -> 'payload';

      if v_n ? 'brand' then
        v_brand := null;
        if nullif(btrim(v_n ->> 'brand'), '') is not null then
          select b.id into v_brand from public.brands b
           where b.store_id = v_job.store_id and b.deleted_at is null and lower(b.name) = lower(btrim(v_n ->> 'brand'))
           limit 1;
          if v_brand is null then
            v_brand := public.catalog_upsert_brand(v_job.store_id, jsonb_build_object('name', btrim(v_n ->> 'brand')));
          end if;
        end if;
        v_payload := v_payload || jsonb_build_object('brand_id', v_brand);
      end if;
      if v_n ? 'categories' then
        v_payload := v_payload || jsonb_build_object('categories', coalesce((
          select jsonb_agg(jsonb_build_object('id', app.category_by_path(v_job.store_id, c), 'is_primary', ord = 1)
                           order by ord)
            from jsonb_array_elements_text(v_n -> 'categories') with ordinality as t(c, ord)), '[]'::jsonb));
      end if;

      if (v_res ->> 'touches_catalog')::boolean then
        v_product := (public.catalog_upsert_product(v_job.store_id, v_payload) ->> 'id')::uuid;
      else
        v_product := (v_res ->> 'product_id')::uuid;  -- solo existencias: el catálogo no cambia
      end if;
      if v_res ->> 'action' = 'create' then v_created := v_created + 1; else v_updated := v_updated + 1; end if;

      -- Existencias físicas absolutas en la ubicación principal (§26.1 paso 7).
      for v_t in select * from jsonb_array_elements(v_res -> 'targets') loop
        v_variant := coalesce(nullif(v_t ->> 'id', '')::uuid,
                              app.import_find_variant(v_product, v_t ->> 'sku', v_t -> 'options'));
        v_level := app.default_level(v_job.store_id, v_variant);
        if v_level is null then
          raise exception using errcode = 'P0001', message = 'not_found', detail = 'inventory_level';
        end if;
        select l.on_hand into v_on_hand from public.inventory_levels l where l.id = v_level for update;
        if v_on_hand is distinct from (v_t ->> 'quantity')::integer then
          perform app.apply_inventory_movement(v_job.store_id, v_level, 'adjustment',
                                               (v_t ->> 'quantity')::integer - v_on_hand, 0,
                                               'Importación ' || v_job.file_name, 'import', v_job.id,
                                               'import:' || v_job.id || ':' || (v_t ->> 'row_number'), 'user');
        end if;
      end loop;

      if v_n ? 'status' then
        select p.status into v_status from public.products p where p.id = v_product;
        if v_n ->> 'status' = 'active' and v_status <> 'active' then
          perform public.catalog_publish_product(v_job.store_id, v_product);
        elsif v_n ->> 'status' in ('draft', 'archived') and v_status <> v_n ->> 'status' then
          perform public.catalog_set_product_status(v_job.store_id, v_product, v_n ->> 'status');
        end if;
      end if;
      update public.import_job_rows set entity_id = v_product where id = v_row.id;
      v_done := v_done + 1;
      if v_cold and v_done = 200 then
        -- Una sola vez: ANALYZE ve las filas de esta transacción y los planes siguientes
        -- usan los índices únicos. Solo ocurre en una base sin estadísticas.
        analyze public.products, public.product_variants, public.product_options, public.product_option_values,
                public.variant_option_values, public.inventory_levels, public.inventory_movements,
                public.product_categories, public.brands;
        v_cold := false;
      end if;
    end loop;

    -- Comprobación final del límite con todo lo creado, ahora con el candado de la
    -- organización (lo suelta el commit, un instante después).
    v_rownum := null;
    if v_creates > 0 then
      delete from system.product_limit_bulk where txid = pg_catalog.txid_current() and store_id = v_job.store_id;
      perform app.assert_within_limit(v_org, 'max_products', 0);
    end if;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
    v_error := case
      when v_msg = 'import_row' then v_detail
      when v_msg = 'validation_failed' and v_detail = 'publish'
        then 'no se puede publicar (' || coalesce(v_hint, 'revisa precio y variantes') || ')'
      when v_msg = 'validation_failed' then 'dato no válido en ' || coalesce(v_detail, 'el producto')
      when v_msg = 'insufficient_stock' then 'no puedes dejar menos existencias que las reservadas por pedidos'
      when v_msg in ('forbidden', 'mfa_required', 'unauthenticated') then 'tu rol no permite esta operación'
      when v_msg = 'limit_reached' then 'se alcanzaría el límite de productos de tu plan'
      else 'no se pudo aplicar este producto' end;
    perform app.import_mark_failed(v_job.id,
      case when v_rownum is null then initcap(left(v_error, 1)) || substr(v_error, 2)
           else format('Fila %s: %s', v_rownum, v_error) end);
    perform set_config('request.jwt.claims', '', true);
    return jsonb_build_object('status', 'failed', 'row_number', v_rownum, 'error', v_msg, 'detail', v_detail,
                              'hint', v_hint);
  end;

  update public.import_jobs
     set status = 'completed', committed_at = now(),
         totals = totals || jsonb_build_object('created', v_created, 'updated', v_updated)
   where id = v_job.id;
  perform audit.record('import.committed', 'import_job', v_job.id, v_org, v_job.store_id,
                       null, jsonb_build_object('created', v_created, 'updated', v_updated, 'file', v_job.file_name));
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('status', 'completed', 'created', v_created, 'updated', v_updated);
end
$$;
revoke all on function system.import_commit(uuid) from public;
grant execute on function system.import_commit(uuid) to system_worker;

-- -----------------------------------------------------------------------------
-- 5. G-L2: la columna aceptaba menos columnas ajenas que la RPC (≤ 50 × 100
--    caracteres): el archivo terminaba en un error de permisos engañoso.
-- -----------------------------------------------------------------------------
alter table public.import_jobs drop constraint import_jobs_ignored_columns_check;
alter table public.import_jobs add constraint import_jobs_ignored_columns_check
  check (cardinality(ignored_columns) <= 50
         and coalesce(char_length(array_to_string(ignored_columns, ',')), 0) <= 5049);

-- -----------------------------------------------------------------------------
-- 6. G-L3: un job devuelto a la cola conserva su turno (run_after original).
-- -----------------------------------------------------------------------------
create or replace function system.release_job(p_job_id uuid, p_worker_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update system.jobs j
     set status = 'queued', attempts = greatest(j.attempts - 1, 0), locked_at = null, locked_by = null
   where j.id = p_job_id and j.status = 'running' and j.locked_by = p_worker_id;
  return found;
end
$$;
revoke all on function system.release_job(uuid, text) from public;
grant execute on function system.release_job(uuid, text) to system_worker;
