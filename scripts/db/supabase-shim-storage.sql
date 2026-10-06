set client_min_messages = warning;
-- =============================================================================
-- SHIM DE SUPABASE STORAGE — SOLO PARA PRUEBAS pgTAP SOBRE POSTGRESQL ESTÁNDAR.
-- Subconjunto de columnas del esquema `storage` de Supabase Storage v1.79 (el
-- que usan nuestras migraciones y políticas). El stack de desarrollo NO usa este
-- archivo: allí el esquema lo crea el servidor real de Storage.
-- =============================================================================

create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null unique,
  owner              uuid,
  owner_id           text,
  public             boolean default false,
  avif_autodetection boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table if not exists storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets (id),
  name             text,
  owner            uuid,
  owner_id         text,
  metadata         jsonb,
  user_metadata    jsonb,
  version          text,
  path_tokens      text[] generated always as (string_to_array(name, '/')) stored,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_accessed_at timestamptz default now(),
  unique (bucket_id, name)
);

-- Como en Supabase: RLS habilitado (no forzado) en ambas tablas.
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end
$$;
