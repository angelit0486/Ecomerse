-- =============================================================================
-- ADR-025 paso 2 · Disponibilidad del proveedor por CSV.
--
-- La lista que manda el proveedor (SKU, disponibilidad, cantidad, costo) se carga
-- de una vez en Productos → Proveedores → (proveedor). Todo o nada: primero se
-- valida cada fila (SKU de la tienda, sin repetidos, valores válidos); si alguna
-- falla no se aplica ninguna. Cada fila aplicada es exactamente lo mismo que la
-- captura manual (mismas existencias por app.apply_inventory_movement §44.10,
-- mismo respeto de lo reservado), con origen `csv`.
--
-- Cambio compatible en suppliers_set_variant: una clave ausente en p_data
-- (supplier_sku, unit_cost) conserva el valor guardado; `null` lo borra.
-- Mismos permisos: products.update + products.cost.read + inventory.adjust.
-- =============================================================================

-- Núcleo compartido (sin permisos: los exige cada RPC pública).
create or replace function app.supplier_apply_variant(p_store_id uuid, p_supplier_id uuid, p_variant_id uuid,
                                                      p_data jsonb, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier public.suppliers;
  v_current  public.supplier_variants;
  v_avail    text := coalesce(nullif(p_data ->> 'availability', ''), 'unknown');
  v_sku      text;
  v_cost     bigint;
  v_qty      integer;
  v_target   integer;
  v_level    public.inventory_levels;
  v_clamped  boolean := false;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'data';
  end if;
  if p_source not in ('manual', 'csv', 'adapter') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'source';
  end if;
  select * into v_supplier from public.suppliers s where s.store_id = p_store_id and s.id = p_supplier_id;
  if v_supplier.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'supplier';
  end if;
  if not exists (select 1 from public.product_variants v
                  where v.store_id = p_store_id and v.id = p_variant_id and v.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'variant';
  end if;
  select * into v_current from public.supplier_variants sv
   where sv.store_id = p_store_id and sv.supplier_id = p_supplier_id and sv.variant_id = p_variant_id;

  if v_avail not in ('available', 'limited', 'unavailable', 'unknown') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'availability';
  end if;
  v_sku := case when p_data ? 'supplier_sku' then nullif(btrim(coalesce(p_data ->> 'supplier_sku', '')), '')
                else v_current.supplier_sku end;
  if v_sku is not null and (char_length(v_sku) > 100 or v_sku ~ '[[:cntrl:]]') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'supplier_sku';
  end if;
  if p_data ? 'unit_cost' and jsonb_typeof(p_data -> 'unit_cost') not in ('number', 'null') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'unit_cost';
  end if;
  begin
    v_cost := case when not (p_data ? 'unit_cost') then v_current.unit_cost
                   when jsonb_typeof(p_data -> 'unit_cost') = 'number' then (p_data ->> 'unit_cost')::bigint end;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'unit_cost';
  end;
  if v_cost is not null and v_cost < 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'unit_cost';
  end if;
  begin
    v_qty := case when jsonb_typeof(p_data -> 'quantity') = 'number' then (p_data ->> 'quantity')::integer end;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'quantity';
  end;
  if v_avail in ('available', 'limited') and (v_qty is null or v_qty not between 0 and 1000000) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'quantity';
  end if;
  v_target := case when v_avail in ('available', 'limited') then v_qty else 0 end;

  insert into public.supplier_variants (store_id, supplier_id, variant_id, supplier_sku, unit_cost, availability,
                                        reported_quantity, last_synced_at, sync_source)
  values (p_store_id, p_supplier_id, p_variant_id, v_sku, v_cost, v_avail,
          case when v_avail in ('available', 'limited') then v_qty end, now(), p_source)
  on conflict (store_id, supplier_id, variant_id) do update
    set supplier_sku = excluded.supplier_sku, unit_cost = excluded.unit_cost, availability = excluded.availability,
        reported_quantity = excluded.reported_quantity, last_synced_at = excluded.last_synced_at,
        sync_source = excluded.sync_source;

  insert into public.inventory_levels (store_id, variant_id, location_id)
  values (p_store_id, p_variant_id, v_supplier.location_id)
  on conflict (variant_id, location_id) do nothing;
  select * into v_level from public.inventory_levels l
   where l.store_id = p_store_id and l.variant_id = p_variant_id and l.location_id = v_supplier.location_id
     for update;
  if v_target < v_level.reserved then
    v_target := v_level.reserved;  -- lo ya reservado sigue cubierto (el proveedor lo confirmará o se cancela)
    v_clamped := true;
  end if;
  if v_target <> v_level.on_hand then
    perform app.apply_inventory_movement(p_store_id, v_level.id, 'adjustment', v_target - v_level.on_hand, 0,
                                         'Disponibilidad informada por el proveedor ' || v_supplier.name,
                                         'manual', p_supplier_id, null, null);
  end if;
  return jsonb_build_object('on_hand', v_target, 'clamped_to_reserved', v_clamped, 'before', v_level.on_hand);
end
$$;
revoke all on function app.supplier_apply_variant(uuid, uuid, uuid, jsonb, text) from public;

-- Mismo contrato que 20261018000700 (captura manual).
create or replace function public.suppliers_set_variant(p_store_id uuid, p_supplier_id uuid, p_variant_id uuid,
                                                        p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform app.require_store_permission(p_store_id, 'products.update');
  perform app.require_store_permission(p_store_id, 'products.cost.read');
  perform app.require_store_permission(p_store_id, 'inventory.adjust');
  v_result := app.supplier_apply_variant(p_store_id, p_supplier_id, p_variant_id, p_data, 'manual');
  perform audit.record('supplier.variant_synced', 'supplier', p_supplier_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('on_hand', (v_result ->> 'before')::integer),
                       jsonb_build_object('variant_id', p_variant_id,
                                          'availability', coalesce(nullif(p_data ->> 'availability', ''), 'unknown'),
                                          'on_hand', (v_result ->> 'on_hand')::integer));
  return v_result - 'before';
end
$$;
revoke all on function public.suppliers_set_variant(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.suppliers_set_variant(uuid, uuid, uuid, jsonb) to authenticated;

-- p_rows: [{row, sku, availability, quantity?, supplier_sku?, unit_cost?}] (máx. 5 000).
-- Devuelve {applied, errors:[{row, field}], updated, clamped}. Con errores no aplica nada.
create or replace function public.suppliers_import_variants(p_store_id uuid, p_supplier_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_errors  jsonb := '[]'::jsonb;
  v_row     record;
  v_result  jsonb;
  v_updated integer := 0;
  v_clamped integer := 0;
begin
  perform app.require_store_permission(p_store_id, 'products.update');
  perform app.require_store_permission(p_store_id, 'products.cost.read');
  perform app.require_store_permission(p_store_id, 'inventory.adjust');
  if not exists (select 1 from public.suppliers s where s.store_id = p_store_id and s.id = p_supplier_id) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'supplier';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0
     or jsonb_array_length(p_rows) > 5000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rows';
  end if;

  create temporary table if not exists pg_temp.supplier_import_rows (
    n integer, sku text, data jsonb, variant_id uuid
  ) on commit drop;
  truncate pg_temp.supplier_import_rows;
  insert into pg_temp.supplier_import_rows (n, sku, data, variant_id)
  select coalesce((case when jsonb_typeof(r -> 'row') = 'number' then (r ->> 'row')::integer end), o::integer + 1),
         upper(btrim(coalesce(r ->> 'sku', ''))), r - 'row' - 'sku', v.id
    from jsonb_array_elements(p_rows) with ordinality as x(r, o)
    left join public.product_variants v
      on v.store_id = p_store_id and v.deleted_at is null and v.sku = upper(btrim(coalesce(x.r ->> 'sku', '')));

  -- Validación completa antes de escribir.
  select coalesce(jsonb_agg(e order by (e ->> 'row')::integer, e ->> 'field'), '[]'::jsonb) into v_errors
    from (
      select jsonb_build_object('row', t.n, 'field', 'sku') as e
        from pg_temp.supplier_import_rows t where t.variant_id is null
      union all
      select jsonb_build_object('row', t.n, 'field', 'duplicate')
        from pg_temp.supplier_import_rows t
       where t.variant_id is not null
         and exists (select 1 from pg_temp.supplier_import_rows u
                      where u.variant_id = t.variant_id and u.n < t.n)
      union all
      select jsonb_build_object('row', t.n, 'field', 'availability')
        from pg_temp.supplier_import_rows t
       where coalesce(t.data ->> 'availability', '') not in ('available', 'limited', 'unavailable', 'unknown')
      union all
      select jsonb_build_object('row', t.n, 'field', 'quantity')
        from pg_temp.supplier_import_rows t
       where t.data ->> 'availability' in ('available', 'limited')
         and not coalesce(jsonb_typeof(t.data -> 'quantity') = 'number'
                          and (t.data ->> 'quantity') ~ '^[0-9]{1,7}$'
                          and (t.data ->> 'quantity')::integer <= 1000000, false)
      union all
      select jsonb_build_object('row', t.n, 'field', 'unit_cost')
        from pg_temp.supplier_import_rows t
       where t.data ? 'unit_cost' and not coalesce(jsonb_typeof(t.data -> 'unit_cost') = 'null'
                                                   or (jsonb_typeof(t.data -> 'unit_cost') = 'number'
                                                       and (t.data ->> 'unit_cost') ~ '^[0-9]{1,12}$'), false)
      union all
      select jsonb_build_object('row', t.n, 'field', 'supplier_sku')
        from pg_temp.supplier_import_rows t
       where t.data ? 'supplier_sku' and (jsonb_typeof(t.data -> 'supplier_sku') not in ('string', 'null')
                                          or char_length(btrim(coalesce(t.data ->> 'supplier_sku', ''))) > 100
                                          or coalesce(t.data ->> 'supplier_sku', '') ~ '[[:cntrl:]]')
    ) x;
  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('applied', false, 'errors', v_errors, 'updated', 0, 'clamped', 0);
  end if;

  -- Variantes en orden de id: el mismo orden de bloqueo que otras escrituras de inventario.
  for v_row in select * from pg_temp.supplier_import_rows order by variant_id loop
    v_result := app.supplier_apply_variant(p_store_id, p_supplier_id, v_row.variant_id,
                                           v_row.data - 'row' - 'sku', 'csv');
    v_updated := v_updated + 1;
    if (v_result ->> 'clamped_to_reserved')::boolean then
      v_clamped := v_clamped + 1;
    end if;
  end loop;
  perform audit.record('supplier.variants_imported', 'supplier', p_supplier_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('rows', v_updated, 'clamped', v_clamped));
  return jsonb_build_object('applied', true, 'errors', '[]'::jsonb, 'updated', v_updated, 'clamped', v_clamped);
end
$$;
revoke all on function public.suppliers_import_variants(uuid, uuid, jsonb) from public;
grant execute on function public.suppliers_import_variants(uuid, uuid, jsonb) to authenticated;
