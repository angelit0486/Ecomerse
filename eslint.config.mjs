import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * Reglas de límites de seguridad (GATE0 §37, §44):
 *  - El cliente Postgres (`postgres`) solo se usa en src/server/db/** (clientes de
 *    roles de mínimo privilegio) y en las pruebas de integración.
 *  - src/server/privileged/** (service role, lista blanca de 2 usos) solo se
 *    importa desde los servicios autorizados (se agregan en su fase).
 *  - dangerouslySetInnerHTML prohibido (solo SafeHtml, Fase 3+).
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
    ],
    rules: {
      "no-restricted-imports": ["error", { patterns: restrictedImports.patterns }],
    },
  },
]);
