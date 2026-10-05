import type { SupabaseClient } from "@supabase/supabase-js";

import { toAppError } from "./errors";

/**
 * Llama a una RPC de `public` con el cliente del usuario y devuelve sus datos o
 * lanza un `AppError` (mapeo en ./errors). La autorización ocurre en la base.
 */
export async function callRpc<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw toAppError(error);
  return data as T;
}
