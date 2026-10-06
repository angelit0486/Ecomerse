"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { parseMoneyToCents } from "@/lib/money/format";
import { callRpc } from "@/server/db/rpc";

import { failureFrom, formValues, storeClient, type FormState } from "../_shared/action-state";

const failure = failureFrom("shipping", {
  countries: "Escribe códigos de país de dos letras separados por comas (p. ej. MX).",
  regions: "Revisa las regiones.",
  name: "Escribe un nombre de hasta 80 caracteres.",
  rate: "Revisa la tarifa: precio, monto para envío gratis, pesos y días.",
  zone: "Esa zona ya no existe.",
});

const list = (v: string) =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const optInt = (v: string) => (v === "" ? null : /^\d{1,7}$/.test(v) ? Number(v) : NaN);
const base = (h: string) => `/admin/${h}/envios`;
const uuid = z.uuid();

export async function saveZone(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["id", "name", "countries", "regions"]);
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "shipping_upsert_zone", {
      p_store_id: storeId,
      p_zone: {
        ...(values.id ? { id: values.id } : {}),
        name: values.name,
        countries: list(values.countries ?? ""),
        ...(values.regions ? { regions: list(values.regions) } : {}),
      },
    });
  } catch (error) {
    return failure(error, values);
  }
  revalidatePath(base(storeHandle));
  return { ok: true, message: "Zona guardada." };
}

export async function deleteZone(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Zona no válida." };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "shipping_delete_zone", { p_store_id: storeId, p_zone_id: id.data });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(base(storeHandle));
  return { ok: true, message: "Zona eliminada." };
}

export async function saveRate(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, [
    "id",
    "zone_id",
    "name",
    "type",
    "price",
    "free_over_subtotal",
    "est_days_min",
    "est_days_max",
  ]);
  const price = values.type === "pickup" ? 0 : parseMoneyToCents(values.price ?? "");
  const freeOver =
    values.type === "free_over" ? parseMoneyToCents(values.free_over_subtotal ?? "") : null;
  const days = [optInt(values.est_days_min ?? ""), optInt(values.est_days_max ?? "")];
  if (
    price === null ||
    (values.type === "free_over" && freeOver === null) ||
    days.some((d) => Number.isNaN(d))
  ) {
    const message = "Revisa los montos y los días (números enteros).";
    return { error: message, fields: { rate: message }, values };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "shipping_upsert_rate", {
      p_store_id: storeId,
      p_rate: {
        ...(values.id ? { id: values.id } : {}),
        zone_id: values.zone_id,
        name: values.name,
        type: values.type,
        price,
        free_over_subtotal: freeOver,
        est_days_min: days[0],
        est_days_max: days[1],
        is_active: formData.get("is_active") !== "0",
      },
    });
  } catch (error) {
    return failure(error, values);
  }
  revalidatePath(base(storeHandle));
  return { ok: true, message: "Tarifa guardada." };
}

export async function deleteRate(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Tarifa no válida." };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "shipping_delete_rate", { p_store_id: storeId, p_rate_id: id.data });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(base(storeHandle));
  return { ok: true, message: "Tarifa eliminada." };
}
