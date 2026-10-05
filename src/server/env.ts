import "server-only";

import { parseServerEnv, type ServerEnv } from "@/config/env";

let cached: ServerEnv | undefined;

/** Entorno del servidor validado (se valida una vez por proceso). */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
