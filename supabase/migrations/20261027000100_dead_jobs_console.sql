-- =============================================================================
-- Trabajos fallidos en la consola de la plataforma (auditoría OPS, paso 17 del
-- plan «panel y tienda profesionales»). Un job `dead` (agotó sus intentos o
-- falló de forma permanente) se veía solo con SQL; ahora el staff de la
-- plataforma lo lista y, con rol de dueño o administrador, lo vuelve a la cola.
--
-- - Lectura: platform_owner, platform_admin y platform_support. Nunca el
--   payload (puede llevar datos de pedidos); solo tipo, tienda, intentos y el
--   último error recortado.
-- - Reintento: platform_owner y platform_admin, solo jobs `dead`, con auditoría.
--   Los handlers son idempotentes (GATE0 §43, Job): repetir no duplica efectos.
-- =============================================================================

create or replace function public.platform_list_dead_jobs(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin', 'platform_support']);
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.finished_at desc)
      from (
        select j.id, j.type, j.store_id, s.name as store_name, j.attempts, j.max_attempts,
               left(j.last_error, 300) as last_error, j.created_at, j.finished_at
          from system.jobs j
          left join public.stores s on s.id = j.store_id
         where j.status = 'dead'
         order by j.finished_at desc
         limit least(greatest(coalesce(p_limit, 50), 1), 200)
      ) x
  ), '[]'::jsonb);
end
$$;
revoke all on function public.platform_list_dead_jobs(integer) from public;
grant execute on function public.platform_list_dead_jobs(integer) to authenticated;

create or replace function public.platform_retry_dead_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job system.jobs;
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin']);
  update system.jobs j
     set status = 'queued', attempts = 0, run_after = now(), finished_at = null,
         locked_at = null, locked_by = null
   where j.id = p_job_id and j.status = 'dead'
  returning * into v_job;
  if v_job.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'dead_job';
  end if;
  perform audit.record('job.retried', 'job', v_job.id,
                       (select s.organization_id from public.stores s where s.id = v_job.store_id),
                       v_job.store_id, null, null, null,
                       jsonb_build_object('type', v_job.type, 'last_error', left(v_job.last_error, 300)));
end
$$;
revoke all on function public.platform_retry_dead_job(uuid) from public;
grant execute on function public.platform_retry_dead_job(uuid) to authenticated;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261027000100'::text
$$;
