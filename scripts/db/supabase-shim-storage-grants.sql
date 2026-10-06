-- =============================================================================
-- SOLO LOCAL (stack y pruebas). Privilegios que Supabase concede en el esquema
-- `storage` a los roles de la API (en un proyecto real ya existen). Storage
-- aplica RLS sobre storage.objects con el JWT de cada petición; service_role
-- omite RLS.
-- =============================================================================
grant usage on schema storage to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
grant all on all sequences in schema storage to anon, authenticated, service_role;
grant all on all functions in schema storage to anon, authenticated, service_role;
