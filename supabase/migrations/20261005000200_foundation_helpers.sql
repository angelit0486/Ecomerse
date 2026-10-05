-- =============================================================================
-- Fase 1 — Foundation · Funciones auxiliares genéricas
-- Contrato: GATE0 §9.1 (UUIDv7, updated_at, store_id inmutable), §29.3 (append-only)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- app.uuid_v7(): UUID versión 7 (prefijo de tiempo en ms → localidad de índice).
-- Solo usa funciones nativas (gen_random_uuid, PG13+): sin extensiones.
-- Toma un UUIDv4 aleatorio, reemplaza los 48 bits iniciales por el tiempo Unix
-- en milisegundos y cambia el nibble de versión de 4 (0100) a 7 (0111)
-- encendiendo los bits 52 y 53. El variante (10xx) del v4 se conserva.
-- -----------------------------------------------------------------------------
create or replace function app.uuid_v7()
returns uuid
language sql
volatile
parallel safe
set search_path = ''
as $$
  select encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
          from 1 for 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid
$$;

comment on function app.uuid_v7() is
  'UUIDv7 (RFC 9562) generado con funciones nativas. PK por defecto de todas las tablas.';

-- -----------------------------------------------------------------------------
-- app.set_updated_at(): trigger BEFORE UPDATE que mantiene updated_at.
-- -----------------------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- -----------------------------------------------------------------------------
-- app.prevent_tenant_change(): trigger BEFORE UPDATE que impide modificar
-- store_id u organization_id (regla L5 §11.2). Genérico: funciona en cualquier
-- tabla que tenga una o ambas columnas.
-- -----------------------------------------------------------------------------
create or replace function app.prevent_tenant_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  if (v_old ? 'store_id') and (v_old -> 'store_id') is distinct from (v_new -> 'store_id') then
    raise exception using
      errcode = '42501',
      message = 'tenant_immutable',
      detail  = format('store_id es inmutable en %I.%I', tg_table_schema, tg_table_name);
  end if;
  if (v_old ? 'organization_id') and (v_old -> 'organization_id') is distinct from (v_new -> 'organization_id') then
    raise exception using
      errcode = '42501',
      message = 'tenant_immutable',
      detail  = format('organization_id es inmutable en %I.%I', tg_table_schema, tg_table_name);
  end if;
  return new;
end
$$;

-- -----------------------------------------------------------------------------
-- app.forbid_mutation(): trigger BEFORE UPDATE OR DELETE para tablas
-- append-only (ledger de inventario, auditoría, historial de pedidos, etc.).
-- -----------------------------------------------------------------------------
create or replace function app.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'append_only',
    detail  = format('%I.%I no admite %s', tg_table_schema, tg_table_name, tg_op);
end
$$;

revoke all on function app.uuid_v7() from public;
revoke all on function app.set_updated_at() from public;
revoke all on function app.prevent_tenant_change() from public;
revoke all on function app.forbid_mutation() from public;
