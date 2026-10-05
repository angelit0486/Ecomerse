/**
 * Decisión de enrutado de un host de tienda (GATE0 §21.1, pasos 4–8). Pura: el
 * proxy aporta la resolución (storefront.resolve_host) y el estado de la vista
 * previa; aquí no hay red ni base.
 */
export interface HostResolution {
  storeId: string;
  /** Estado efectivo: incluye 'suspended' si la organización está suspendida. */
  status: "draft" | "active" | "paused" | "suspended" | "closed";
  primaryHostname: string | null;
  isPrimary: boolean;
}

export type StorefrontDecision =
  | { type: "not_found" }
  | { type: "unavailable" }
  | { type: "redirect"; location: string }
  | { type: "rewrite"; pathname: string; preview: boolean };

export interface DecideInput {
  host: string;
  pathname: string;
  search: string;
  protocol: "http" | "https";
  resolution: HostResolution | null;
  /** Hay una cookie de vista previa válida para ESTA tienda. */
  previewStoreId: string | null;
}

export function decideStorefront(input: DecideInput): StorefrontDecision {
  const { resolution } = input;
  if (!resolution || resolution.status === "closed") return { type: "not_found" };
  if (resolution.status === "paused" || resolution.status === "suspended") {
    return { type: "unavailable" };
  }

  const preview = input.previewStoreId === resolution.storeId;
  // El canje del token ocurre en /_preview, que debe funcionar aunque la tienda
  // esté en borrador y sin cookie todavía.
  const isPreviewRedeem = input.pathname === "/_preview";
  if (resolution.status === "draft" && !preview && !isPreviewRedeem) return { type: "not_found" };

  if (
    !resolution.isPrimary &&
    resolution.primaryHostname &&
    resolution.primaryHostname !== input.host
  ) {
    return {
      type: "redirect",
      location: `${input.protocol}://${resolution.primaryHostname}${input.pathname}${input.search}`,
    };
  }

  const path = input.pathname === "/" ? "" : input.pathname;
  return { type: "rewrite", pathname: `/_store/${resolution.storeId}${path}`, preview };
}
