// =============================================================================
// SOLO DESARROLLO LOCAL. Claves JWT HS256 del stack local (scripts/dev/stack.sh).
// El secreto es el valor público y conocido que usa la CLI de Supabase en local;
// no protege nada y nunca se usa fuera de 127.0.0.1.
// =============================================================================
import { createHmac } from "node:crypto";

export const DEV_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

const b64url = (value) => Buffer.from(value).toString("base64url");

export function signDevJwt(payload, secret = DEV_JWT_SECRET) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

// Válidas 10 años, como las de la CLI de Supabase.
const iat = 1_790_000_000;
const exp = iat + 10 * 365 * 24 * 3600;
export const DEV_ANON_KEY = signDevJwt({ iss: "supabase-demo", role: "anon", iat, exp });
export const DEV_SERVICE_ROLE_KEY = signDevJwt({
  iss: "supabase-demo",
  role: "service_role",
  iat,
  exp,
});

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(
    [
      `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${DEV_ANON_KEY}`,
      `SUPABASE_SERVICE_ROLE_KEY=${DEV_SERVICE_ROLE_KEY}`,
      `SUPABASE_JWT_SECRET=${DEV_JWT_SECRET}`,
      "",
    ].join("\n"),
  );
}
