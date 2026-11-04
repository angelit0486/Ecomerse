-- =============================================================================
-- Escalabilidad del panel con mucho historial (docs/audit/escalabilidad-2026-11.md).
-- Medido con una tienda de 200 000 pedidos: los avisos («por surtir»,
-- «requieren atención»), sus listas, los indicadores del inicio (ventas por
-- rango de pago) y la búsqueda por número recorrían la tabla completa.
--
-- Solo agrega índices: no cambia datos, funciones, permisos ni RLS. Compuestos
-- normales (no parciales) para las listas del panel, porque PostgREST manda los
-- filtros como parámetros y un índice parcial puede no aplicarse con ellos.
--
-- Reversa: drop index public.orders_store_status_fulfillment_idx,
--   public.orders_store_attention_idx, public.orders_store_paid_idx,
--   public.orders_number_trgm_idx;
-- En una base con millones de pedidos, crearlos con CREATE INDEX CONCURRENTLY
-- fuera de transacción (hoy las tablas son pequeñas y se crean en milisegundos).
-- =============================================================================

-- «Por surtir», «Pagados», «Cancelados»: estado + surtido, en orden de fecha.
create index if not exists orders_store_status_fulfillment_idx
  on public.orders (store_id, status, fulfillment_status, placed_at, id);

-- «Requieren atención»: lista (más reciente primero) y conteo de avisos.
create index if not exists orders_store_attention_idx
  on public.orders (store_id, needs_attention, placed_at desc, id desc);

-- Indicadores del inicio: ventas y serie por día según la fecha de pago.
create index if not exists orders_store_paid_idx
  on public.orders (store_id, paid_at) include (total)
  where paid_at is not null;

-- Búsqueda del panel por número de pedido (fragmento, como «1500»).
create index if not exists orders_number_trgm_idx
  on public.orders using gin (store_id, display_number extensions.gin_trgm_ops);

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261104000500'::text
$$;
