import "server-only";

import { reportActionError } from "@/server/actions/report";
import { getStoreContext } from "@/server/auth/store-context";
import { createSupabaseServerClient } from "@/server/supabase/server";

/** Estado común de los formularios de ventas del panel (envíos, impuestos, descuentos, pedidos). */
export interface FormState {
  ok?: boolean;
  message?: string;
  error?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
}

export function failureFrom(scope: string, messages: Record<string, string>) {
  return (error: unknown, values?: Record<string, string>): FormState => {
    const e = reportActionError(scope, error);
    const fields = e.fields
      ? Object.fromEntries(
          Object.keys(e.fields).map((k) => [k, messages[k] ?? "Revisa este dato."]),
        )
      : undefined;
    const first = fields ? Object.values(fields)[0] : undefined;
    return {
      error: first ?? e.message,
      ...(fields ? { fields } : {}),
      ...(values ? { values } : {}),
    };
  };
}

/** Tienda de la URL (membresía verificada) y cliente con la sesión del usuario. */
export async function storeClient(storeHandle: string) {
  const ctx = await getStoreContext(storeHandle);
  return { ctx, supabase: await createSupabaseServerClient(), storeId: ctx.store.id };
}

export function formValues(formData: FormData, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, String(formData.get(k) ?? "").trim()]));
}
