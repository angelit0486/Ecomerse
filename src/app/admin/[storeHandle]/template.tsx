import { headers } from "next/headers";
import type { ReactNode } from "react";

import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { createLogger } from "@/server/observability/logger";
import { createSupabaseServerClient } from "@/server/supabase/server";

const log = createLogger();

/**
 * A diferencia del layout, el template se vuelve a renderizar en cada navegación:
 * aquí se audita cada página que abre el soporte (GATE0 §7.7). La ruta la fija el
 * proxy (el cliente no puede enviar x-pathname); los prefetch no cuentan. Los
 * templates no reciben params: la tienda sale de esa misma ruta.
 */
export default async function StoreTemplate({ children }: { children: ReactNode }) {
  const h = await headers();
  const path = h.get("x-pathname");
  const handle = path?.match(/^\/admin\/([a-z0-9-]+)(?:\/|$)/)?.[1];
  if (handle && !h.has("next-router-prefetch")) {
    const ctx = await getStoreContextForPage(handle);
    if (ctx.supportGrantId) {
      const supabase = await createSupabaseServerClient();
      await callRpc(supabase, "support_log_page_view", {
        p_grant_id: ctx.supportGrantId,
        p_path: path,
      }).catch((error: unknown) => log.error("support.page_view_failed", { err: error }));
    }
  }
  return children;
}
