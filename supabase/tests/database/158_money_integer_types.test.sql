-- =============================================================================
-- Dinero solo en enteros (centavos), nunca con decimales flotantes (GATE0 §44.14).
-- Auditoría del 26 nov 2026 (backlog B-12): hoy ninguna columna de dinero usa
-- numeric/real/double, pero ningún metatest lo exigía. Genérico: cubre toda
-- columna nueva cuyo nombre indique dinero en los esquemas propios.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

-- 1. Ninguna columna de dinero con tipo decimal, flotante o money.
select is_empty(
  $$ select n.nspname || '.' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and n.nspname in ('public', 'app', 'audit', 'private', 'storefront', 'system')
        and a.attnum > 0 and not a.attisdropped
        and a.attname ~ '(^|_)(price|total|amount|cost|subtotal|spent|fee|refund|discount|balance)(_|$)'
        and a.atttypid in ('numeric'::regtype, 'real'::regtype, 'double precision'::regtype, 'money'::regtype) $$,
  'ninguna columna de dinero usa numeric, real, double precision ni money'
);

-- 2 y 3. Anclas: el precio de la variante y el total del pedido son bigint.
select col_type_is('public', 'product_variants', 'price', 'bigint',
  'product_variants.price es bigint (centavos)');
select col_type_is('public', 'orders', 'total', 'bigint',
  'orders.total es bigint (centavos)');

select * from finish();
rollback;
