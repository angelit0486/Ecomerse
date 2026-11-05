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
  weekly_summary: {
    title: "Resumen semanal",
    description:
      "Cada lunes te llega un correo con las ventas de la semana contra la anterior, los pedidos por surtir o en atención, el stock bajo y los carritos abandonados.",
    where: "Tu correo (o el de los avisos de la tienda), cada lunes",
  },
  panel_help: {
    title: "Ayuda en el panel",
    description:
      "Agrega «Ayuda» arriba del panel: guías cortas, paso a paso, para pedidos, pagos, envíos, productos, reembolsos y más.",
    where: "Este panel, junto a «Avisos»",
  },
  returns: {
    title: "Devoluciones",
    description:
      "Tus clientes piden la devolución desde la página de su pedido; tú la apruebas, registras cuando llega y reembolsas o haces un cambio.",
    where: "Pedidos → Devoluciones, y la página del pedido de tu cliente",
  },
  store_health: {
    title: "Salud de tu tienda",
    description:
      "Una pantalla con lo que falta o está por fallar: avisos, pagos, envíos, productos sin foto o sin existencias, políticas, uso de tu plan y pedidos que esperan.",
    where: "Este panel, junto a «Avisos»",
  },
  email_texts: {
    title: "Correos con tu texto",
    description:
      "Cambia el asunto y agrega un mensaje tuyo a los correos que reciben tus clientes (pedido, pago, envío, entrega, cancelación y reembolso).",
    where: "Ajustes → Correos",
  },
  theme_personality: {
    title: "Personalidad del diseño",
    description:
      "Dale a tu tienda su propio estilo: tarjetas de producto con borde, planas o elevadas, fotos cuadradas o verticales, títulos en mayúsculas o con otro peso y tamaño, y un movimiento sutil al bajar por la portada.",
    where: "Apariencia → Personalidad",
  },
  payment_pending_email: {
    title: "Correo «pendiente de pago»",
    description:
      "Si un pago en OXXO, por transferencia o en cajero queda pendiente, le mandamos al cliente su pedido con las instrucciones. Por ahora Mercado Pago no ofrece esos pagos en tu tienda: caducarían antes de que el cliente pagara.",
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
