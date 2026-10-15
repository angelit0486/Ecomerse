import "server-only";

import { serverEnv } from "@/server/env";

import { createPreviewToken } from "./preview";

/**
 * Enlace de vista previa en el dominio de la tienda (CF-09). El token dura 15
 * minutos: se crea cuando la persona pide la vista previa (F9-DESIGN §13 M7),
 * no al cargar la página del panel.
 */
export function previewUrl(hostname: string, storeId: string): string {
  const env = serverEnv();
  const secure = env.APP_ENV === "production" || env.APP_ENV === "preview";
  const port = env.APP_HOSTNAME.split(":")[1];
  const origin = `${secure ? "https" : "http"}://${hostname}${!secure && port ? `:${port}` : ""}`;
  const token = createPreviewToken(env.PREVIEW_HMAC_SECRET, storeId, Math.floor(Date.now() / 1000));
  return `${origin}/_preview?token=${token}`;
}
