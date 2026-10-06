"use server";

import { revalidatePath } from "next/cache";

import { callRpc } from "@/server/db/rpc";
import { invalidateStore } from "@/server/storefront/cache";

import { failureFrom, storeClient, type FormState } from "../_shared/action-state";

const failure = failureFrom("taxes", { tax_rate_bps: "Escribe una tasa entre 0 y 100 %." });

/** Tasa en porcentaje con hasta dos decimales → puntos base (sin float: «16.5» → 1650). */
function percentToBps(input: string): number | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= 10000 ? bps : null;
}

export async function saveTaxes(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const rate = String(formData.get("rate") ?? "");
  const bps = percentToBps(rate);
  if (bps === null)
    return {
      error: "Escribe una tasa entre 0 y 100 %.",
      fields: { rate: "Escribe una tasa entre 0 y 100 %." },
    };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "taxes_update", {
      p_store_id: storeId,
      p_prices_include_tax: formData.get("prices_include_tax") === "1",
      p_tax_rate_bps: bps,
      p_tax_applies_to_shipping: formData.get("tax_applies_to_shipping") === "1",
    });
    invalidateStore(storeId);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/admin/${storeHandle}/impuestos`);
  return { ok: true, message: "Impuestos guardados. Se aplican a los carritos desde ahora." };
}
