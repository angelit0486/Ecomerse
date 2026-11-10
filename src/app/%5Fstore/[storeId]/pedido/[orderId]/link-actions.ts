"use server";

import { z } from "zod";

import { reportActionError } from "@/server/actions/report";
import { isGuestTokenShape } from "@/server/payments/order-links";
import { renewGuestLink } from "@/server/storefront/checkout";
import { getStorefront } from "@/server/storefront/context";

/**
 * «Mandarme un enlace nuevo» (ADR-062). La tienda sale de la firma del proxy; el
 * navegador solo aporta el pedido y el token del enlace vencido. El enlace nuevo
 * va al correo del pedido: aquí no se muestra nada del pedido ni del correo.
 */
export interface LinkActionState {
  ok?: boolean;
  message?: string;
  error?: string;
}

export async function requestNewLink(
  storeId: string,
  orderId: string,
  token: string,
): Promise<LinkActionState> {
  const { store } = await getStorefront(storeId);
  if (!z.uuid().safeParse(orderId).success || !isGuestTokenShape(token)) {
    return { error: "Este enlace no es válido." };
  }
  try {
    const result = await renewGuestLink(store.id, orderId, token);
    if (result === "sent") {
      return {
        ok: true,
        message:
          "Listo. Te enviamos un enlace nuevo al correo con el que hiciste el pedido. Puede tardar unos minutos.",
      };
    }
    if (result === "too_soon") {
      return {
        ok: true,
        message:
          "Ya te enviamos un enlace nuevo en la última hora. Revisa tu correo, también la carpeta de spam.",
      };
    }
    if (result === "ok")
      return { ok: true, message: "Tu enlace sigue vigente. Recarga la página." };
    return { error: "No pudimos enviar el enlace. Escríbele a la tienda para que te ayude." };
  } catch (error) {
    reportActionError("storefront.guest_link_renew", error);
    return { error: "No pudimos enviar el enlace. Inténtalo de nuevo en unos minutos." };
  }
}
