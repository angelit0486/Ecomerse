"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { preferredRate } from "@/lib/checkout/shipping";
import { formatMoney } from "@/lib/money/format";
import { reportActionError } from "@/server/actions/report";
import { toAppError } from "@/server/db/errors";
import { AppError } from "@/server/errors";
import { serverEnv } from "@/server/env";
import { isGuestTokenShape, verifyFakePaymentSignature } from "@/server/payments/order-links";
import {
  addToCart,
  dbDetail,
  discountGuard,
  setCartDetails,
  setCartQuantity,
} from "@/server/storefront/cart";
import {
  fakePaymentResult,
  placeOrder,
  retryPayment,
  type PlaceOrderInput,
} from "@/server/storefront/checkout";
import { getStorefront } from "@/server/storefront/context";

/**
 * Acciones del carrito y el checkout (GATE0 §17.2). La tienda se verifica con la
 * firma del proxy en cada acción; el navegador solo aporta variante, cantidad,
 * datos de contacto, dirección, tarifa, código, total esperado y clave.
 */
export interface CartActionState {
  ok?: boolean;
  message?: string;
  error?: string;
  fields?: Record<string, string>;
  count?: number;
}

const uuid = z.uuid();
const quantity = z.coerce.number().int().min(0).max(999);

const ERRORS: Record<string, string> = {
  quantity: "Elige una cantidad entre 1 y 999.",
  cart_lines: "Tu carrito ya tiene el máximo de 50 productos distintos.",
  email: "Escribe un email válido.",
  customer_name: "Escribe tu nombre.",
  phone: "Escribe un teléfono válido.",
  shipping_address: "Revisa la dirección de envío.",
  shipping_rate_id: "Elige una forma de envío disponible para tu dirección.",
  payment_account_id: "Elige una forma de pago.",
  customer_note: "La nota puede tener hasta 1000 caracteres.",
};

const DISCOUNT_ERRORS: Record<string, string> = {
  not_found: "Ese código no existe.",
  inactive: "Ese código no está activo.",
  not_started: "Ese código todavía no es válido.",
  expired: "Ese código ya venció.",
  min_subtotal: "Tu compra no alcanza el mínimo para ese código.",
  exhausted: "Ese código ya no tiene usos disponibles.",
  customer_limit: "Ya usaste ese código.",
  not_applicable: "Ese código es de envío gratis y tu pedido no requiere envío.",
};

const CART_ERRORS: Record<string, string> = {
  empty: "Tu carrito está vacío.",
  unavailable: "Algunos productos ya no están disponibles. Quítalos para continuar.",
  zero_total: "No podemos procesar un pedido con total de cero.",
  cart: "Tu carrito expiró. Vuelve a agregar los productos.",
};

async function store(storeId: string) {
  return (await getStorefront(storeId)).store;
}

function failure(error: unknown): CartActionState {
  const e = reportActionError("storefront", error);
  const detail = dbDetail(e);
  if (e.code === "validation_failed" && detail && ERRORS[detail]) {
    return { error: ERRORS[detail], fields: { [detail]: ERRORS[detail]! } };
  }
  if (e.code === "discount_invalid") {
    const message = DISCOUNT_ERRORS[detail ?? ""] ?? DISCOUNT_ERRORS.not_found!;
    return { error: message, fields: { discount_code: message } };
  }
  if (e.code === "cart_invalid") return { error: CART_ERRORS[detail ?? ""] ?? e.message };
  if (e.code === "insufficient_stock") {
    return {
      error: "Uno de los productos ya no tiene existencias suficientes. Ajusta las cantidades.",
    };
  }
  if (e.code === "not_found") return { error: "Ese producto ya no está disponible." };
  if (e.code === "rate_limited") return { error: "Demasiados intentos. Espera unos minutos." };
  return {
    error:
      e.code === "internal" ? "No pudimos completar la acción. Inténtalo de nuevo." : e.message,
  };
}

export async function addItem(
  storeId: string,
  _: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const s = await store(storeId);
  const variant = uuid.safeParse(formData.get("variant_id"));
  const qty = quantity.safeParse(formData.get("quantity") ?? 1);
  if (!variant.success || !qty.success || qty.data < 1) return { error: ERRORS.quantity };
  let count: number;
  try {
    count = (await addToCart(s.id, variant.data, qty.data)).item_count;
  } catch (error) {
    return failure(error);
  }
  // «Comprar ahora» (F9-T03): mismo carrito, directo al pago (compra en ≤ 3 clics).
  if (formData.get("intent") === "buy") redirect("/checkout");
  refresh();
  return { ok: true, message: "Agregado al carrito.", count };
}

export async function updateLine(
  storeId: string,
  _: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const s = await store(storeId);
  const variant = uuid.safeParse(formData.get("variant_id"));
  const qty = quantity.safeParse(formData.get("remove") ? 0 : formData.get("quantity"));
  if (!variant.success || !qty.success) return { error: ERRORS.quantity };
  try {
    await setCartQuantity(s.id, variant.data, qty.data);
    refresh();
    return { ok: true, message: qty.data === 0 ? "Producto quitado." : "Cantidad actualizada." };
  } catch (error) {
    return failure(error);
  }
}

export async function applyDiscount(
  storeId: string,
  _: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const s = await store(storeId);
  const code = String(formData.get("discount_code") ?? "")
    .trim()
    .slice(0, 40);
  if (code && !formData.get("remove") && !(await discountGuard(s.id))) {
    return { error: "Demasiados intentos con códigos. Espera un momento." };
  }
  try {
    const cart = await setCartDetails(s.id, {
      discount_code: formData.get("remove") ? null : code || null,
    });
    refresh();
    if (cart.discount && cart.discount.status !== "ok") {
      const message = DISCOUNT_ERRORS[cart.discount.status] ?? DISCOUNT_ERRORS.not_found!;
      return { error: message, fields: { discount_code: message } };
    }
    return { ok: true, message: cart.discount ? "Código aplicado." : "Código quitado." };
  } catch (error) {
    return failure(error);
  }
}

const text = (fd: FormData, key: string, max = 200) =>
  String(fd.get(key) ?? "")
    .trim()
    .slice(0, max);

function addressFrom(fd: FormData) {
  const address: Record<string, string> = {
    recipient_name: text(fd, "customer_name", 120),
    line1: text(fd, "line1"),
    city: text(fd, "city", 120),
    region: text(fd, "region", 120),
    postal_code: text(fd, "postal_code", 12),
    country: text(fd, "country", 2).toUpperCase(),
  };
  const line2 = text(fd, "line2");
  if (line2) address.line2 = line2;
  const phone = text(fd, "phone", 20);
  if (phone) address.phone = phone;
  return address;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Campos obligatorios vacíos o inválidos al confirmar (mensajes por campo). */
function missingFields(fd: FormData, email: string, requiresShipping: boolean) {
  const fields: Record<string, string> = {};
  if (!EMAIL_RE.test(email)) fields.email = ERRORS.email!;
  if (!text(fd, "customer_name", 160)) fields.customer_name = ERRORS.customer_name!;
  if (requiresShipping) {
    const required: [string, string][] = [
      ["line1", "Escribe la calle y el número."],
      ["city", "Escribe la ciudad."],
      ["region", "Escribe el estado."],
      ["postal_code", "Escribe el código postal."],
    ];
    for (const [name, message] of required) if (!text(fd, name)) fields[name] = message;
    // Las paqueterías de México piden colonia y teléfono.
    if (text(fd, "country", 2).toUpperCase() === "MX" && !text(fd, "line2")) {
      fields.line2 = "Escribe la colonia.";
    }
    if (!text(fd, "phone", 20)) fields.phone = "Escribe un teléfono para la paquetería.";
  }
  return fields;
}

/**
 * Un solo formulario: «Calcular envío» guarda contacto y dirección para mostrar
 * las tarifas; «Confirmar pedido» llama a place_order con el total que vio el
 * comprador (si cambió, `price_changed` y se muestra el nuevo).
 */
export async function checkout(
  storeId: string,
  _: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const s = await store(storeId);
  const intent = formData.get("intent") === "place" ? "place" : "quote";
  const requiresShipping = formData.get("requires_shipping") === "1";
  const email = text(formData, "email", 254).toLowerCase();
  const rate = text(formData, "shipping_rate_id", 40) || undefined;
  // Confirmar: todos los datos que faltan a la vez, cada uno en su campo (Gate F9).
  if (intent === "place") {
    const missing = missingFields(formData, email, requiresShipping);
    if (Object.keys(missing).length > 0) {
      return {
        error: `Faltan ${Object.keys(missing).length} datos. Revisa los campos marcados.`,
        fields: missing,
      };
    }
  }
  let preselected: string | null = null;
  try {
    const cart = await setCartDetails(s.id, {
      email: email || null,
      ...(requiresShipping ? { shipping_address: addressFrom(formData) } : {}),
      ...(rate ? { shipping_rate_id: rate } : {}),
    });
    // Sin tarifa elegida se preselecciona la de menor costo efectivo para este
    // carrito (F9-T03, Gate F9: «gratis desde» cuenta como gratis si ya se
    // alcanzó; recoger en tienda solo si no hay otra). La elige el servidor
    // entre las opciones de la base; el total lo vuelve a calcular la base.
    if (!rate && cart.shipping.status === "rate_required") {
      const best = preferredRate(cart.shipping_options, cart);
      if (best) {
        await setCartDetails(s.id, { shipping_rate_id: best.rate_id });
        preselected = best.name;
      }
    }
  } catch (error) {
    return failure(error);
  }
  refresh();
  if (intent === "quote") return { ok: true, message: "Formas de envío actualizadas." };
  // Confirmó sin que se hubiera cotizado (clic directo): el comprador ve primero
  // el total con envío y confirma otra vez.
  if (preselected) {
    return {
      error: `Elegimos «${preselected}» para tu dirección. Revisa el total y confirma tu pedido.`,
    };
  }

  const account = uuid.safeParse(formData.get("payment_account_id"));
  if (!account.success)
    return {
      error: ERRORS.payment_account_id,
      fields: { payment_account_id: ERRORS.payment_account_id! },
    };
  const expected = Number(formData.get("expected_total"));
  const key = String(formData.get("idempotency_key") ?? "");
  const input: PlaceOrderInput = {
    email,
    customer_name: text(formData, "customer_name", 160),
    payment_account_id: account.data,
    ...(text(formData, "phone", 20) ? { phone: text(formData, "phone", 20) } : {}),
    ...(requiresShipping ? { shipping_address: addressFrom(formData) } : {}),
    ...(rate ? { shipping_rate_id: rate } : {}),
    ...(text(formData, "customer_note", 1000)
      ? { customer_note: text(formData, "customer_note", 1000) }
      : {}),
    accepts_marketing: formData.get("accepts_marketing") === "1",
  };
  let target: string;
  try {
    if (!Number.isSafeInteger(expected) || expected < 0) throw new AppError("price_changed");
    target = await placeOrder(s.id, input, expected, key);
  } catch (error) {
    const e = toAppError(error);
    if (e.code === "price_changed") {
      const total = Number(dbDetail(e));
      return {
        error: Number.isFinite(total)
          ? `El total cambió a ${formatMoney(total, s.currency, s.locale)}. Revísalo y confirma de nuevo.`
          : "El total cambió. Revísalo y confirma de nuevo.",
      };
    }
    return failure(e);
  }
  redirect(target);
}

export async function retry(
  storeId: string,
  orderId: string,
  token: string,
): Promise<CartActionState> {
  const s = await store(storeId);
  if (!uuid.safeParse(orderId).success || !isGuestTokenShape(token))
    return { error: "Pedido no válido." };
  let target: string;
  try {
    target = await retryPayment(s.id, orderId, token);
  } catch (error) {
    const e = toAppError(error);
    if (e.code === "conflict")
      return { error: "Este pedido ya no se puede pagar. Haz un pedido nuevo." };
    return failure(e);
  }
  redirect(target);
}

/** Página del pago simulado (solo fuera de producción, D-F6-06). */
export async function simulatePayment(
  storeId: string,
  paymentId: string,
  returnPath: string,
  signature: string,
  outcome: "succeeded" | "failed",
): Promise<CartActionState> {
  const s = await store(storeId);
  if (
    !verifyFakePaymentSignature(serverEnv().ORDER_LINK_SECRET, paymentId, returnPath, signature)
  ) {
    return { error: "Enlace de pago no válido." };
  }
  try {
    await fakePaymentResult(s.id, paymentId, outcome);
  } catch (error) {
    const e = toAppError(error);
    if (e.code === "conflict") return { error: "Este pedido ya no se puede pagar." };
    return failure(e);
  }
  redirect(returnPath);
}
