-- =============================================================================
-- SOLO LOCAL / CI. Habilita LOGIN en los roles de mínimo privilegio con
-- contraseñas de desarrollo. En entornos reales se hace con el runbook
-- docs/runbooks/database-roles.md y contraseñas del gestor de secretos.
-- =============================================================================
alter role system_worker with login password 'system_worker_dev_password';
alter role storefront_gateway with login password 'storefront_gateway_dev_password';
