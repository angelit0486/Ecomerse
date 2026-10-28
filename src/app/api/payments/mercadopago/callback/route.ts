import { NextResponse, type NextRequest } from "next/server";

import { reportActionError } from "@/server/actions/report";
import { getStoreContext } from "@/server/auth/store-context";
import { callRpc } from "@/server/db/rpc";
import { serverEnv } from "@/server/env";
import { AppError } from "@/server/errors";
import { MercadoPagoApi } from "@/server/payments/mercadopago";
import { connectWithCode } from "@/server/payments/mercadopago-credentials";
import {
  OAUTH_CALLBACK_PATH,
  OAUTH_COOKIE,
  OAUTH_STATE_PURPOSE,
  verifyPending,
  type OAuthPending,
} from "@/server/payments/mercadopago-oauth";
import {
  mercadoPagoCredentialDeps,
  mercadoPagoMode,
  mercadoPagoOAuth,
} from "@/server/payments/registry";
import { deriveKey, parseKey } from "@/server/security/secret-box";
import { invalidateStore } from "@/server/storefront/cache";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * Regreso de Mercado Pago tras autorizar (ADR-041). Nada de la URL decide por sí
 * solo: la cookie firmada (tienda, usuario, PKCE, 10 min) debe coincidir con el
 * `state`, la sesión debe ser del mismo usuario y la base vuelve a exigir
 * payments.manage. El resultado se muestra en Ajustes → Pagos con texto fijo.
 */
export async function GET(request: NextRequest) {
  const env = serverEnv();
  const url = request.nextUrl;
  const raw = request.cookies.get(OAUTH_COOKIE)?.value;
  let pending: OAuthPending | null = null;
  let result = "error";
  try {
    const oauth = mercadoPagoOAuth();
    const deps = mercadoPagoCredentialDeps();
    if (!oauth || !deps || !env.PAYMENT_CREDENTIALS_KEY || !env.MERCADOPAGO_ACCESS_TOKEN) {
      throw new AppError("provider_error");
    }
    // La tienda sale de la cookie (firmada), nunca de la URL.
    const key = deriveKey(parseKey(env.PAYMENT_CREDENTIALS_KEY), OAUTH_STATE_PURPOSE);
    const unverified = raw ? safeHandle(raw) : null;
    if (unverified) {
      const ctx = await getStoreContext(unverified);
      pending = verifyPending(key, raw, {
        state: url.searchParams.get("state"),
        userId: ctx.userId,
      });
      if (pending && pending.storeId === ctx.store.id) {
        const supabase = await createSupabaseServerClient();
        await callRpc(supabase, "payments_get_mercadopago", { p_store_id: pending.storeId });
        const code = url.searchParams.get("code");
        if (!code) {
          result = "cancelado"; // La dueña no autorizó en Mercado Pago.
        } else {
          const r = await connectWithCode(
            {
              ...deps,
              oauth,
              mode: mercadoPagoMode(),
              api: new MercadoPagoApi({
                accessToken: env.MERCADOPAGO_ACCESS_TOKEN,
                webhookSecret: "",
                ...(env.MERCADOPAGO_API_BASE ? { apiBase: env.MERCADOPAGO_API_BASE } : {}),
              }),
            },
            { storeId: pending.storeId, code, verifier: pending.verifier },
          );
          result = r.ok ? "conectado" : r.reason;
          if (r.ok) invalidateStore(pending.storeId);
        }
      } else {
        pending = null;
      }
    }
  } catch (error) {
    const e = reportActionError("payments", error);
    result = e.code === "conflict" ? "en_uso" : "error";
  }
  const target = pending
    ? new URL(`/admin/${encodeURIComponent(pending.storeHandle)}/ajustes/pagos`, env.APP_URL)
    : new URL("/admin", env.APP_URL);
  if (pending) target.searchParams.set("mp", result);
  const response = NextResponse.redirect(target, 303);
  // De un solo uso: la cookie se borra pase lo que pase.
  response.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_CALLBACK_PATH, maxAge: 0 });
  return response;
}

/** Lee la tienda de la cookie SIN confiar aún en ella (la firma se verifica después). */
function safeHandle(cookie: string): string | null {
  try {
    const body = cookie.split(".")[0] ?? "";
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      storeHandle?: unknown;
    };
    return typeof parsed.storeHandle === "string" && /^[a-z0-9-]{1,63}$/.test(parsed.storeHandle)
      ? parsed.storeHandle
      : null;
  } catch {
    return null;
  }
}
