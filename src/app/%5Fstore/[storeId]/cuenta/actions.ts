"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";

import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { serverEnv } from "@/server/env";
import {
  buyerClient,
  buyerUserId,
  linkCustomer,
  recordLoginIntent,
  takeCodeAttempt,
} from "@/server/storefront/account";
import { getStorefront } from "@/server/storefront/context";

/**
 * Cuenta del comprador (F8-T01, GATE0 §7.4): código por email en el dominio de
 * la tienda, vinculación solo tras verificarlo. La tienda se verifica con la
 * firma del proxy en cada acción. Las respuestas no revelan si un email tiene
 * cuenta.
 */
export interface AccountState {
  ok?: boolean;
  message?: string;
  error?: string;
  values?: Record<string, string>;
}

const EMAIL_COOKIE = "buyer_login_email";
const emailSchema = z.email().max(254);
const codeSchema = z.string().regex(/^\d{6}$/);
const uuid = z.uuid();

const secure = () => ["production", "preview"].includes(serverEnv().APP_ENV);

export async function requestCode(
  storeId: string,
  _: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const { store } = await getStorefront(storeId);
  const raw = String(formData.get("email") ?? "");
  const email = emailSchema.safeParse(raw.trim().toLowerCase());
  if (!email.success) return { error: "Escribe un email válido.", values: { email: raw } };
  let nonce: string | null;
  try {
    nonce = await recordLoginIntent(store.id, email.data);
  } catch (error) {
    // La tienda aún no está publicada (vista previa del comerciante).
    const e = reportActionError("account", error);
    return {
      error:
        e.code === "not_found"
          ? "Las cuentas de clientes se activan cuando la tienda se publica."
          : "No pudimos enviar el código. Inténtalo de nuevo.",
      values: { email: raw },
    };
  }
  if (!nonce) {
    return {
      error: "Pediste demasiados códigos. Espera unos minutos e inténtalo de nuevo.",
      values: { email: raw },
    };
  }
  const supabase = await buyerClient();
  // Cualquier error se trata igual que un éxito: la respuesta no revela qué emails existen.
  // El nonce viaja en redirect_to hasta el Send Email Hook: solo así el código lleva la
  // marca de esta tienda (Gate F8). El redirect solo apunta a la plataforma.
  await supabase.auth.signInWithOtp({
    email: email.data,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${serverEnv().APP_URL}/?pruva_login=${nonce}`,
    },
  });
  (await cookies()).set(EMAIL_COOKIE, email.data, {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  redirect("/cuenta/codigo");
}

export async function verifyCode(
  storeId: string,
  _: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const { store } = await getStorefront(storeId);
  const cookieStore = await cookies();
  const email = cookieStore.get(EMAIL_COOKIE)?.value;
  if (!email) redirect("/cuenta");
  const code = codeSchema.safeParse(String(formData.get("code") ?? "").replace(/\s/g, ""));
  if (!code.success) return { error: "El código tiene 6 dígitos." };
  // Límite propio de intentos (APP-M4): no depende de los límites por IP de Auth,
  // que comparten todos los compradores detrás del servidor.
  if (!(await takeCodeAttempt(store.id, email))) {
    return { error: "Demasiados intentos. Espera unos minutos y pide un código nuevo." };
  }
  const supabase = await buyerClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token: code.data, type: "email" });
  if (error || !data.user) {
    return { error: "El código no es correcto o caducó. Pide uno nuevo si hace falta." };
  }
  try {
    await linkCustomer(supabase, store.id);
  } catch (cause) {
    reportActionError("account", cause);
    await supabase.auth.signOut({ scope: "local" });
    return {
      error: "No pudimos abrir tu cuenta en esta tienda. Escríbele a la tienda para ayudarte.",
    };
  }
  cookieStore.delete(EMAIL_COOKIE);
  redirect("/cuenta");
}

export async function signOut(storeId: string): Promise<void> {
  await getStorefront(storeId);
  const supabase = await buyerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/");
}

async function accountClient(storeId: string) {
  const { store } = await getStorefront(storeId);
  const supabase = await buyerClient();
  if (!(await buyerUserId(supabase))) redirect("/cuenta");
  return { supabase, storeId: store.id };
}

export async function saveProfile(
  storeId: string,
  _: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const values = Object.fromEntries(
    ["first_name", "last_name", "phone"].map((k) => [k, String(formData.get(k) ?? "")]),
  );
  const { supabase, storeId: id } = await accountClient(storeId);
  try {
    await callRpc(supabase, "account_update_profile", {
      p_store_id: id,
      p_first_name: values.first_name,
      p_last_name: values.last_name,
      p_phone: values.phone,
    });
  } catch (error) {
    const e = reportActionError("account", error);
    return {
      error: e.fields?.phone ? "Escribe un teléfono válido." : "Revisa tus datos.",
      values,
    };
  }
  refresh();
  return { ok: true, message: "Datos guardados." };
}

const ADDRESS_KEYS = [
  "recipient_name",
  "line1",
  "line2",
  "city",
  "region",
  "postal_code",
  "country",
  "phone",
] as const;

export async function saveAddress(
  storeId: string,
  _: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const values: Record<string, string> = {
    ...Object.fromEntries(ADDRESS_KEYS.map((k) => [k, String(formData.get(k) ?? "")])),
    is_default: formData.get("is_default") === "1" ? "1" : "",
  };
  const { supabase, storeId: id } = await accountClient(storeId);
  try {
    await callRpc(supabase, "account_save_address", {
      p_store_id: id,
      p_address_id: null,
      p_address: { ...values, is_default: values.is_default === "1" },
    });
  } catch (error) {
    const e = reportActionError("account", error);
    return {
      error:
        e.code === "limit_reached"
          ? "Puedes guardar hasta 10 direcciones."
          : "Revisa la dirección: nombre, calle, ciudad, estado, código postal y país.",
      values,
    };
  }
  refresh();
  return { ok: true, message: "Dirección guardada." };
}

export async function deleteAddress(
  storeId: string,
  addressId: string,
  _: AccountState,
): Promise<AccountState> {
  if (!uuid.safeParse(addressId).success) return { error: "Dirección no válida." };
  const { supabase, storeId: id } = await accountClient(storeId);
  try {
    await callRpc(supabase, "account_delete_address", { p_store_id: id, p_address_id: addressId });
  } catch (error) {
    return { error: reportActionError("account", error).message };
  }
  refresh();
  return { ok: true, message: "Dirección eliminada." };
}
