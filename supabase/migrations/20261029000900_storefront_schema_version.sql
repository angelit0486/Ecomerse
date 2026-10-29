-- La tienda pública también comprueba la versión del esquema al mostrarse: si
-- faltan migraciones enseña «Tienda en mantenimiento» en vez de una pantalla rota.
-- storefront_gateway solo ejecuta funciones storefront.* (GATE0 §44.4), así que
-- se expone la versión con esta función de solo lectura.
create function storefront.schema_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_schema_version()
$$;
revoke all on function storefront.schema_version() from public;
grant execute on function storefront.schema_version() to storefront_gateway;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261029000900'::text
$$;
