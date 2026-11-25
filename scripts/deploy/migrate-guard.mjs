// =============================================================================
// ¿Debe este build aplicar migraciones? (T-10 / S-05, auditoría Orden 01)
//
// `pnpm build` corre migrate.mjs antes de `next build`. Sin esta guarda, si algún
// día se define MIGRATION_DATABASE_URL en el entorno Preview de Vercel (o en
// «todos los entornos»), CUALQUIER rama que se despliegue —un PR sin revisar o
// uno de Dependabot— aplicaría sus migraciones a la base de staging.
//
// Regla:
//   - Sin MIGRATION_DATABASE_URL: nunca (como siempre: local y CI).
//   - En Vercel: solo el despliegue de PRODUCCIÓN del proyecto (VERCEL_ENV =
//     production), que es la rama de despliegue. Las vistas previas nunca.
//   - Fuera de Vercel (`pnpm deploy:migrate` desde una máquina de confianza): sí,
//     como hasta hoy.
//
// Función pura para poder probarla sin base de datos.
// =============================================================================

/** Variables que Vercel define en sus builds; con cualquiera se asume Vercel. */
const VERCEL_MARKERS = ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_GIT_COMMIT_REF"];

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ run: boolean, reason: string }}
 */
export function migrationDecision(env) {
  if (!env.MIGRATION_DATABASE_URL) {
    return { run: false, reason: "Sin MIGRATION_DATABASE_URL: no se aplican migraciones." };
  }
  const onVercel = VERCEL_MARKERS.some((name) => Boolean(env[name]));
  if (!onVercel) {
    return { run: true, reason: "Fuera de Vercel: se aplican las migraciones pendientes." };
  }
  if (env.VERCEL_ENV === "production") {
    return { run: true, reason: "Despliegue de producción en Vercel: se aplican las migraciones." };
  }
  const branch = env.VERCEL_GIT_COMMIT_REF || "desconocida";
  const where = env.VERCEL_ENV || "sin VERCEL_ENV";
  return {
    run: false,
    reason:
      `Vista previa en Vercel (${where}, rama ${branch}): no se aplican migraciones. ` +
      "Solo el despliegue de producción del proyecto migra (T-10).",
  };
}
