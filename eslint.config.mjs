import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * Reglas de límites de seguridad (GATE0 §37, §44):
 *  - El cliente Postgres (`postgres`) solo se usa en src/server/db/** (clientes de
 *    roles de mínimo privilegio) y en las pruebas de integración.
 *  - src/server/privileged/** (service role, lista blanca de 2 usos) solo se
 *    importa desde los servicios autorizados: src/server/team/mfa-reset.ts (SR-1)
 *    y el registro de jobs, que inyecta Storage Admin al worker de medios (SR-2).
 *  - dangerouslySetInnerHTML prohibido salvo en src/ui/safe-html.tsx (SafeHtml).
 */
const restrictedImports = {
  paths: [
    {
      name: "postgres",
      message: "Usa los clientes de @/server/db/role-clients (roles de mínimo privilegio).",
    },
  ],
  patterns: [
    {
      group: ["@/server/privileged/*", "**/server/privileged/*"],
      message: "El service role solo se usa desde los servicios de la lista blanca (GATE0 §11.5).",
    },
  ],
};

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "coverage/**",
    "next-env.d.ts",
    "supabase/.temp/**",
    ".stack/**",
  ]),
  {
    rules: {
      "no-restricted-imports": ["error", restrictedImports],
      "react/no-danger": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: [
      "src/server/db/**",
      "src/server/jobs/store.ts",
      "tests/integration/**",
      "tests/stack/**",
      "tests/e2e/**",
      // Datos de demostración del stack local (F9-T05): como los E2E, preparan
      // datos con el superusuario local y el script se niega a correr fuera de localhost.
      "scripts/dev/demo-seed.mjs",
      // Migraciones en el build de la vista previa (D-F9-17): conexión de dueño del esquema.
      "scripts/deploy/migrate.mjs",
    ],
    rules: {
      "no-restricted-imports": ["error", { patterns: restrictedImports.patterns }],
    },
  },
  {
    // Lista blanca del service role (GATE0 §11.5): uso #1, reset de MFA (Auth Admin).
    // Uso #2, Storage Admin del worker de medios (SR-2), inyectado desde el registro de jobs.
    files: ["src/server/team/mfa-reset.ts", "src/server/jobs/registry.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: restrictedImports.paths }],
    },
  },
  {
    // Única excepción a react/no-danger: sanitiza siempre al renderizar (T-06).
    files: ["src/ui/safe-html.tsx"],
    rules: { "react/no-danger": "off" },
  },
]);
