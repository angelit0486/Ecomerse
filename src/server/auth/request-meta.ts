import "server-only";

import { headers } from "next/headers";

import { REQUEST_ID_HEADER } from "@/server/observability/request-id";

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

const IP_RE = /^[0-9a-f:.]{2,45}$/i;

/** IP (primer salto de x-forwarded-for, que en Vercel fija la plataforma), UA y request_id. */
export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  return {
    ip: forwarded && IP_RE.test(forwarded) ? forwarded : null,
    userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
    requestId: h.get(REQUEST_ID_HEADER),
  };
}
