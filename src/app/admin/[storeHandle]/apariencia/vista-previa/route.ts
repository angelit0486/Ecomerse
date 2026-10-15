import { NextResponse, type NextRequest } from "next/server";

import { hasPermission } from "@/server/auth/context";
import { previewUrl } from "@/server/storefront/preview-url";

import { storeClient } from "../../_shared/action-state";

/**
 * Vista previa del borrador (F9-DESIGN §5 y §13 M7): crea el token al pedirla y
 * lleva a la tienda, que lo canjea por la cookie de vista previa de ESA tienda.
 * Es un GET (un enlace que abre otra pestaña): la CSP `form-action 'self'` del
 * panel bloquearía la redirección de un formulario a otro dominio. Sin riesgo
 * de CSRF: quien lo dispare solo lleva a la propia persona a la vista previa de
 * su tienda, y el token nunca le llega al sitio que lo provocó.
 */
type Params = { params: Promise<{ storeHandle: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { storeHandle } = await params;
  const { ctx, supabase, storeId } = await storeClient(storeHandle);
  if (!hasPermission(ctx, "appearance.manage")) return new NextResponse(null, { status: 403 });
  const { data: domains } = await supabase
    .from("store_domains")
    .select("hostname, is_primary, type, status")
    .eq("store_id", storeId)
    .eq("status", "active");
  const domain =
    domains?.find((d) => d.is_primary) ?? domains?.find((d) => d.type === "platform_subdomain");
  if (!domain) return new NextResponse(null, { status: 404 });
  const response = NextResponse.redirect(previewUrl(domain.hostname, storeId), 303);
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}
