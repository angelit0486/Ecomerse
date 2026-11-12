-- =============================================================================
-- Candados de la importación (Orden 06, escalón C, hallazgo CAP-11, S1).
--
-- `app.enforce_variant_limit` tomaba un candado de aviso por producto
-- (`pg_advisory_xact_lock`) y lo conservaba hasta el final de la transacción.
-- Una importación de 5,000 productos ocupaba 5,001 lugares de la tabla de
-- candados de PostgreSQL, que es compartida por TODAS las conexiones y tiene
-- tamaño fijo (`max_locks_per_transaction` × `max_connections`: 6,400 en
-- local, 3,840 en el staging actual). Medido en local: tres importaciones de
-- 5,000 a la vez en tiendas distintas → una falla con «out of shared memory»;
-- mientras la tabla está llena, cualquier otra operación puede fallar igual.
--
-- Arreglo: el mismo efecto (una alta de variante a la vez por producto, para
-- contar bien el límite) bloqueando la fila del producto. Los bloqueos de fila
-- se guardan en la fila, no en la tabla compartida. La transacción ya tomaba
-- ese bloqueo un instante después (el «touch» del producto): no cambia el
-- orden de bloqueos. Solo la función. Reversa: la definición anterior está en
-- 20261009000100_catalog_tables.sql.
-- =============================================================================

create or replace function app.enforce_variant_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid := (select s.organization_id from public.stores s where s.id = new.store_id);
  v_limit integer;
  v_used  integer;
begin
  if tg_op = 'UPDATE' and not (old.deleted_at is not null and new.deleted_at is null) then
    return new;
  end if;
  -- Una alta de variante a la vez por producto: se bloquea la FILA del producto.
  -- (Antes: un candado de aviso por producto, que ocupa la tabla de candados
  -- compartida hasta el final de la transacción.)
  perform 1 from public.products p where p.id = new.product_id for no key update;
  v_limit := coalesce(
    (select o.value_int from public.organization_entitlement_overrides o
      where o.organization_id = v_org and o.key = 'max_variants_per_product'
        and (o.expires_at is null or o.expires_at > now())),
    (select e.value_int from public.subscriptions s
       join public.plan_entitlements e on e.plan_id = s.plan_id and e.key = 'max_variants_per_product'
      where s.organization_id = v_org and s.status <> 'cancelled'),
    100);
  select count(*) into v_used from public.product_variants pv
   where pv.product_id = new.product_id and pv.deleted_at is null and pv.id <> new.id;
  if v_used + 1 > v_limit then
    raise exception using errcode = 'P0001', message = 'limit_reached',
      detail = json_build_object('key', 'max_variants_per_product', 'limit', v_limit, 'used', v_used)::text;
  end if;
  return new;
end
$$;

-- Versión del esquema (D-POR-06).
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261111000400'::text
$$;
