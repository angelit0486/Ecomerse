"use server";

import { z } from "zod";

import { reportActionError } from "@/server/actions/report";
import { isGuestTokenShape } from "@/server/payments/order-links";
import { dbDetail } from "@/server/storefront/cart";
import { getStorefront } from "@/server/storefront/context";
import { submitAccountReview, submitReview } from "@/server/storefront/reviews";

/**
 * Opinión del comprador (ADR-029). La tienda sale de la firma del proxy; el
 * navegador solo aporta pedido, token del enlace, producto, calificación y texto.
 */
export interface ReviewActionState {
  ok?: boolean;
  message?: string;
  error?: string;
  fields?: Record<string, string>;
}

const input = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(120),
  body: z.string().trim().min(10).max(2000),
});

const FIELD_ERRORS: Record<string, string> = {
  rating: "Elige de 1 a 5 estrellas.",
  title: "El título puede tener hasta 120 caracteres.",
  body: "Cuéntanos tu experiencia en al menos 10 caracteres (máximo 2000).",
};

type Review = z.infer<typeof input>;

function parse(formData: FormData): Review | ReviewActionState {
  const parsed = input.safeParse({
    rating: formData.get("rating") ?? "",
    title: formData.get("title") ?? "",
    body: formData.get("body") ?? "",
  });
  if (parsed.success) return parsed.data;
  const field = String(parsed.error.issues[0]?.path[0] ?? "body");
  const message = FIELD_ERRORS[field] ?? FIELD_ERRORS.body!;
  return { error: message, fields: { [field]: message } };
}

function failure(error: unknown): ReviewActionState {
  const e = reportActionError("storefront.review", error);
  const detail = dbDetail(e);
  if (e.code === "conflict" && detail === "already_reviewed") {
    return { error: "Ya enviaste tu opinión de este producto." };
  }
  if (e.code === "conflict") return { error: "Podrás opinar cuando recibas tu pedido." };
  if (e.code === "validation_failed" && detail && FIELD_ERRORS[detail]) {
    return { error: FIELD_ERRORS[detail], fields: { [detail]: FIELD_ERRORS[detail]! } };
  }
  return { error: e.message };
}

// Sin refrescar: el formulario se cambia por el agradecimiento (al volver a la
// página, el producto ya aparece como opinado).
const THANKS: ReviewActionState = {
  ok: true,
  message: "¡Gracias! Tu opinión se publicará cuando la tienda la revise.",
};

/** Desde «Mi cuenta»: la base exige la cuenta de la tienda y que el pedido sea suyo. */
export async function sendAccountReview(
  storeId: string,
  orderId: string,
  productId: string,
  _: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const { store } = await getStorefront(storeId);
  const uuid = z.uuid();
  if (!uuid.safeParse(orderId).success || !uuid.safeParse(productId).success) {
    return { error: "Pedido no válido." };
  }
  const review = parse(formData);
  if ("error" in review) return review;
  try {
    await submitAccountReview(store.id, orderId, productId, review as Review);
  } catch (error) {
    return failure(error);
  }
  return THANKS;
}

export async function sendReview(
  storeId: string,
  orderId: string,
  token: string,
  productId: string,
  _: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const { store } = await getStorefront(storeId);
  const uuid = z.uuid();
  if (
    !uuid.safeParse(orderId).success ||
    !uuid.safeParse(productId).success ||
    !isGuestTokenShape(token)
  ) {
    return { error: "Pedido no válido." };
  }
  const review = parse(formData);
  if ("error" in review) return review;
  try {
    await submitReview(store.id, orderId, token, productId, review as Review);
  } catch (error) {
    return failure(error);
  }
  return THANKS;
}
