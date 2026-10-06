"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { parseMoneyToCents } from "@/lib/money/format";
import { callRpc } from "@/server/db/rpc";

import { failureFrom, formValues, storeClient, type FormState } from "../_shared/action-state";

const MESSAGES = {
  code: "De 3 a 32 letras, números, guiones o guiones bajos.",
  code_taken: "Ya existe otro descuento con ese código.",
  code_locked: "Este código ya se usó: no se puede cambiar.",
  value: "Revisa el valor: porcentaje de 0.01 a 100, o un monto mayor que 0.",
  discount: "Revisa los datos del descuento.",
  status: "Estado no válido.",
};
const failure = failureFrom("discounts", MESSAGES);
const base = (h: string) => `/admin/${h}/descuentos`;

function percentToBps(input: string): number | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps >= 1 && bps <= 10000 ? bps : null;
}
const optInt = (v: string) =>
  v === "" ? null : /^\d{1,7}$/.test(v) && Number(v) > 0 ? Number(v) : NaN;
const optDate = (v: string) => (v ? new Date(`${v}T00:00:00`).toISOString() : null);

export async function saveDiscount(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const keys = [
    "id",
    "code",
    "type",
    "value",
    "min_subtotal",
    "starts_at",
    "ends_at",
    "usage_limit",
    "usage_limit_per_customer",
  ];
  const values = formValues(formData, keys);
  const type = values.type;
  const value =
    type === "percentage"
      ? percentToBps(values.value ?? "")
      : type === "fixed_amount"
        ? parseMoneyToCents(values.value ?? "")
        : 0;
  const min = values.min_subtotal ? parseMoneyToCents(values.min_subtotal) : 0;
  const limits = [optInt(values.usage_limit ?? ""), optInt(values.usage_limit_per_customer ?? "")];
  if (value === null || (type === "fixed_amount" && value <= 0)) {
    return { error: MESSAGES.value, fields: { value: MESSAGES.value }, values };
  }
  if (min === null || limits.some((l) => Number.isNaN(l))) {
    return { error: MESSAGES.discount, fields: { discount: MESSAGES.discount }, values };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "discounts_upsert", {
      p_store_id: storeId,
      p_discount: {
        ...(values.id ? { id: values.id } : {}),
        code: values.code,
        type,
        value,
        min_subtotal: min,
        starts_at: optDate(values.starts_at ?? ""),
        ends_at: optDate(values.ends_at ?? ""),
        usage_limit: limits[0],
        usage_limit_per_customer: limits[1],
      },
    });
  } catch (error) {
    return failure(error, values);
  }
  revalidatePath(base(storeHandle));
  return { ok: true, message: values.id ? "Descuento guardado." : "Descuento creado." };
}

const statusSchema = z.object({ id: z.uuid(), status: z.enum(["active", "disabled", "archived"]) });

export async function setDiscountStatus(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = statusSchema.safeParse({ id: formData.get("id"), status: formData.get("status") });
  if (!parsed.success) return { error: MESSAGES.status };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "discounts_set_status", {
      p_store_id: storeId,
      p_discount_id: parsed.data.id,
      p_status: parsed.data.status,
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(base(storeHandle));
  return { ok: true, message: "Estado actualizado." };
}
