"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { callRpc } from "@/server/db/rpc";
import { processQueueSoon } from "@/server/jobs/run-now";

import { failureFrom, storeClient, type FormState } from "../../_shared/action-state";

/** Dominio propio (E16). La base valida y el worker verifica; aquí solo se pide. */
export interface DomainState extends FormState {
  /** Código del TXT: se muestra una sola vez (la base guarda su hash). */
  token?: string;
  hostname?: string;
}

const MESSAGES: Record<string, string> = {
  hostname: "Escribe un dominio como www.tutienda.mx (sin https:// ni rutas).",
  platform_domain: "Ese dominio es de la plataforma. Usa uno tuyo.",
  too_many: "Puedes tener hasta 2 dominios propios. Quita uno para agregar otro.",
  taken: "Ese dominio ya está conectado a otra tienda.",
  not_active: "Primero debe estar activo.",
  domain: "Ese dominio ya no está en tu tienda.",
};
const failure = failureFrom("domains", MESSAGES);

function domainId(formData: FormData): string | null {
  const id = String(formData.get("domain_id") ?? "");
  return /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

function done(storeHandle: string, state: DomainState): DomainState {
  revalidatePath(`/admin/${storeHandle}/ajustes/dominio`);
  return state;
}

export async function addCustomDomain(
  storeHandle: string,
  _: DomainState,
  formData: FormData,
): Promise<DomainState> {
  const raw = String(formData.get("hostname") ?? "");
  // Lo que suelen pegar: https://, rutas y espacios.
  const hostname = raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/[/?#].*$/, "");
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    const result = await callRpc<{ hostname: string; token: string }>(
      supabase,
      "domains_add_custom",
      { p_store_id: storeId, p_hostname: hostname },
    );
    processQueueSoon("domains.verify");
    return done(storeHandle, {
      ok: true,
      message: "Dominio agregado. Agrega estos registros en tu registrador.",
      token: result.token,
      hostname: result.hostname,
    });
  } catch (error) {
    return failure(error, { hostname: raw });
  }
}

async function simple(
  storeHandle: string,
  formData: FormData,
  rpc: string,
  message: string,
): Promise<DomainState> {
  const id = domainId(formData);
  if (!id) return { error: "Recarga la página e inténtalo de nuevo." };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, rpc, { p_store_id: storeId, p_domain_id: id });
  } catch (error) {
    return failure(error);
  }
  return done(storeHandle, { ok: true, message });
}

export async function checkDomain(storeHandle: string, _: DomainState, formData: FormData) {
  const state = await simple(
    storeHandle,
    formData,
    "domains_request_check",
    "Revisando. Si acabas de cambiar el DNS, puede tardar unas horas; lo seguimos revisando solos.",
  );
  if (state.ok) processQueueSoon("domains.verify");
  return state;
}

/** Cambian lo que se ve (el botón desaparece): el aviso va en la página. */
async function andShow(
  storeHandle: string,
  formData: FormData,
  rpc: string,
  done: "principal" | "quitado",
): Promise<DomainState> {
  const state = await simple(storeHandle, formData, rpc, "");
  if (!state.ok) return state;
  redirect(`/admin/${encodeURIComponent(storeHandle)}/ajustes/dominio?hecho=${done}`);
}

export async function setPrimaryDomain(storeHandle: string, _: DomainState, formData: FormData) {
  return andShow(storeHandle, formData, "domains_set_primary", "principal");
}

export async function removeDomain(storeHandle: string, _: DomainState, formData: FormData) {
  return andShow(storeHandle, formData, "domains_remove", "quitado");
}

export async function rotateDomainToken(
  storeHandle: string,
  _: DomainState,
  formData: FormData,
): Promise<DomainState> {
  const id = domainId(formData);
  if (!id) return { error: "Recarga la página e inténtalo de nuevo." };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    const token = await callRpc<string>(supabase, "domains_rotate_token", {
      p_store_id: storeId,
      p_domain_id: id,
    });
    processQueueSoon("domains.verify");
    return done(storeHandle, {
      ok: true,
      message: "Código nuevo. Reemplaza el registro TXT en tu registrador; el anterior ya no vale.",
      token,
      hostname: String(formData.get("hostname") ?? ""),
    });
  } catch (error) {
    return failure(error);
  }
}
