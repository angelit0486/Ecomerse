"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { parseMoneyToCents } from "@/lib/money/format";
import { isMexicoOnly, normalizeMxRegions } from "@/lib/shipping/regions";
import { callRpc } from "@/server/db/rpc";
import { invalidateStore } from "@/server/storefront/cache";

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
  const countries = list(values.countries ?? "");
  // Estados elegidos en la lista (zona de México) o regiones escritas (otros países).
  const picked = formData.getAll("region").map(String);
  let regions = picked.length > 0 ? picked : list(values.regions ?? "");
  if (isMexicoOnly(countries) && regions.length > 0) {
    const { regions: names, unknown } = normalizeMxRegions(regions);
    if (unknown.length > 0) {
      const message = `No reconocemos ${unknown.map((u) => `«${u}»`).join(", ")} como estado de México: elígelo de la lista.`;
      return { error: message, fields: { regions: message }, values };
    }
    regions = names;
  }
  values.regions = regions.join(", ");
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "shipping_upsert_zone", {
      p_store_id: storeId,
      p_zone: {
        ...(values.id ? { id: values.id } : {}),
        name: values.name,
        countries,
        ...(regions.length > 0 ? { regions } : {}),
      },
    });
    // La ficha muestra el umbral de envío gratis (F9-T03): se invalida su caché.
    invalidateStore(storeId);
  } catch (error) {
    return failure(error, values);
  }
  revalidatePath(base(storeHandle));
  return { ok: true, message: "Zona guardada." };
}

/**
 * «Envío a todo México» en un paso (panel, 2026-11-26): la zona «Todo México»
 * con su tarifa estándar y, si se indica, envío gratis desde un monto. Las
 * mismas funciones que el formulario detallado (`shipping_upsert_*`).
 */
export async function quickNationalShipping(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, [
    "price",
    "free_over_subtotal",
    "est_days_min",
    "est_days_max",
  ]);
  const price = parseMoneyToCents(values.price ?? "");
  const freeOver = values.free_over_subtotal ? parseMoneyToCents(values.free_over_subtotal) : null;
  const days = [optInt(values.est_days_min ?? ""), optInt(values.est_days_max ?? "")];
  const fields: Record<string, string> = {};
  if (price === null) fields.price = "Escribe el costo del envío (puede ser 0).";
  if (values.free_over_subtotal && (freeOver === null || freeOver <= 0)) {
    fields.free_over_subtotal = "Escribe un monto mayor que 0 o déjalo vacío.";
  }
  if (
    days.some((d) => Number.isNaN(d)) ||
    (days[0] !== null && days[1] !== null && days[0]! > days[1]!)
  ) {
    fields.days = "Revisa los días: números enteros y el mínimo no mayor que el máximo.";
  }
  if (Object.keys(fields).length > 0) {
    return { error: Object.values(fields)[0], fields, values };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    // Si un intento anterior dejó la zona sin tarifa, se reutiliza (no se duplica).
    const { data: existing, error: findError } = await supabase
      .from("shipping_zones")
      .select("id, shipping_rates(id)")
      .eq("store_id", storeId)
      .eq("name", "Todo México")
      .limit(1)
      .maybeSingle();
    if (findError) throw findError;
    if (existing && existing.shipping_rates.length > 0) {
      return { error: "Ya tienes la zona «Todo México»: ajusta sus tarifas abajo." };
    }
    const zoneId =
      existing?.id ??
      (await callRpc<string>(supabase, "shipping_upsert_zone", {
        p_store_id: storeId,
        p_zone: { name: "Todo México", countries: ["MX"] },
      }));
    await callRpc(supabase, "shipping_upsert_rate", {
      p_store_id: storeId,
      p_rate: {
        zone_id: zoneId,
        name: "Envío estándar",
        type: "flat",
        price,
        est_days_min: days[0],
        est_days_max: days[1],
        is_active: true,
      },
    });
    if (freeOver !== null) {
      await callRpc(supabase, "shipping_upsert_rate", {
        p_store_id: storeId,
        p_rate: {
          zone_id: zoneId,
          name: "Envío gratis",
          type: "free_over",
          price: 0,
          free_over_subtotal: freeOver,
          est_days_min: days[0],
          est_days_max: days[1],
          is_active: true,
        },
      });
    }
    invalidateStore(storeId);
  } catch (error) {
    revalidatePath(base(storeHandle));
    return failure(error, values);
  }
  revalidatePath(base(storeHandle));
  return { ok: true, message: "Listo: ya envías a todo México." };
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
    invalidateStore(storeId);
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
  // La casilla va después de su campo oculto «0»: `get` devolvía siempre el
  // «0» y toda tarifa del panel quedaba inactiva (hallazgo del ensayo O10-01).
  const isActive = formData.getAll("is_active").includes("1");
  values.is_active = isActive ? "1" : "0";
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
        is_active: isActive,
      },
    });
    invalidateStore(storeId);
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
    invalidateStore(storeId);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(base(storeHandle));
  return { ok: true, message: "Tarifa eliminada." };
}
