-- =============================================================================
-- Reversa de 20261119000100_order_whatsapp_handoff_flag.sql (ficha del pedido
-- por WhatsApp al confirmar, D-INT-04). 2026-11-19.
--
-- SIN PÉRDIDA: la migración no agregó tablas, columnas ni funciones; solo
-- insertó la bandera `order_whatsapp_handoff` (apagada) y subió la versión. Esto
-- deja public.app_schema_version() EXACTA a la de 20261117000600. El esquema
-- queda idéntico (pg_dump -s, con permisos) al de una base con las migraciones
-- hasta 20261117000600; lo prueba scripts/ops/reversa/comprobar-0400.sh.
--
-- La fila de la bandera y sus overrides se quedan: son datos de configuración y
-- el código anterior ignora las claves que no conoce. Para apagarla en todas las
-- tiendas sin borrar nada: kill_switch = true (ver la migración).
--
-- El código de esta rama espera esta versión (EXPECTED_SCHEMA_VERSION
-- 20261119000100, D-POR-06): con la base en 0600 la tienda mostraría
-- «mantenimiento». Orden:
--   1. desplegar el código que espera 20261117000600 (sin este cambio);
--   2. correr esto.
--
-- Uso (SOLO con autorización y en la ventana): psql -X -1 -v ON_ERROR_STOP=1 -f <este archivo>
-- =============================================================================

-- Candado: solo sobre una base exactamente en 20261119000100.
do $$
begin
  if coalesce(public.app_schema_version(), '') <> '20261119000100' then
    raise exception using errcode = 'P0001', message = 'reversa_bloqueada',
      detail = format('La base está en %s; esta reversa solo aplica a 20261119000100.',
                      coalesce(public.app_schema_version(), 'desconocida'));
  end if;
end
$$;

-- Versión del esquema (D-POR-06): idéntica a la de 20261117000600_manual_payment_hold.sql.
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261117000600'::text
$$;
