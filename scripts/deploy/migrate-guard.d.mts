/** Tipos de migrate-guard.mjs (T-10) para las pruebas en TypeScript. */
export function migrationDecision(env: Record<string, string | undefined>): {
  run: boolean;
  reason: string;
};
