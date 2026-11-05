/**
 * Funciones que la tienda enciende o apaga en Ajustes → Funciones
 * (`feature_flags.store_toggle`). El texto vive aquí; la base decide cuáles se
 * pueden cambiar y su estado. Una clave sin texto no se muestra.
 */
export interface StoreFeatureCopy {
  title: string;
  description: string;
  /** Dónde se nota, para que la dueña lo encuentre. */
  where: string;
}

export const STORE_FEATURES: Record<string, StoreFeatureCopy> = {
  hero_image_carousel: {
    title: "Portada de imágenes",
    description:
      "Una portada solo con imágenes, sin texto encima, que avanzan solas y se deslizan con el dedo.",
    where: "Apariencia → Portada → «Portada de imágenes»",
  },
  storefront_nav_scroll_fix: {
    title: "Barra de categorías sin cortes",
    description:
      "En el celular, la barra de categorías se desliza sin cortar palabras y muestra la categoría actual.",
    where: "La tienda, debajo del encabezado",
  },
  checkout_shipping_messages: {
    title: "Mensajes claros de envío",
    description:
      "Si no envías a la dirección del cliente, le decimos qué falta (por ejemplo, el estado). Con una sola forma de envío, queda elegida sola.",
    where: "La tienda, al pagar",
  },
  mobile_input_size: {
    title: "Campos cómodos en el celular",
    description:
      "Los campos para escribir se ven más grandes en el celular y el iPhone no acerca la página al tocarlos.",
    where: "La tienda y este panel, en el celular",
  },
  order_printing: {
    title: "Notas de empaque",
    description:
      "Imprime la nota de empaque de un pedido, o las de todos los pedidos por surtir, cada una en su hoja: productos, cantidades y dirección.",
    where: "Pedidos → un pedido o «Por surtir» → «Imprimir»",
  },
  payment_pending_email: {
    title: "Correo «pendiente de pago»",
    description:
      "Si el cliente elige pagar en OXXO, por transferencia o en cajero con Mercado Pago, le mandamos su pedido con las instrucciones mientras paga.",
    where: "Correo al cliente",
  },
};

export interface StoreFeatureRow {
  key: string;
  enabled: boolean;
  locked: boolean;
}

/** Solo las que tienen texto, en el orden de la lista de arriba. */
export function visibleFeatures(rows: readonly StoreFeatureRow[]) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return Object.entries(STORE_FEATURES).flatMap(([key, copy]) => {
    const row = byKey.get(key);
    return row ? [{ ...row, ...copy }] : [];
  });
}
