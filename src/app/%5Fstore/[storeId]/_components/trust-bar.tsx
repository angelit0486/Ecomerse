import type { ReactNode } from "react";

import type { PaymentMethod } from "@/lib/theme/schema";
import type { ShippingPromo } from "@/server/storefront/catalog";

import { money } from "./format";
import { PAYMENT_LABELS } from "./header";

/**
 * Franja de confianza (pulido visual, F9-DESIGN §15): solo datos que la tienda
 * configuró — la regla real de envío gratis y su tiempo, las formas de pago
 * declaradas y el WhatsApp. Sin sellos, cifras ni promesas que no existan; si
 * no hay nada configurado, no se muestra.
 */
export function TrustBar({
  shipping,
  payments,
  whatsapp,
  store,
}: {
  shipping: ShippingPromo | null;
  payments: PaymentMethod[];
  whatsapp: string | undefined;
  store: { currency: string; locale: string };
}) {
  const items: { key: string; icon: ReactNode; title: string; text: string }[] = [];
  if (shipping) {
    items.push({
      key: "envio",
      icon: <TruckIcon />,
      title: `Envío gratis desde ${money(shipping.free_over, store)}`,
      text:
        (shipping.conditional ? "Según destino. " : "") +
        (shipping.price > 0 ? `Si no, ${money(shipping.price, store)}.` : ""),
    });
    if (shipping.est_days_min != null && shipping.est_days_max != null) {
      const days =
        shipping.est_days_min === shipping.est_days_max
          ? `${shipping.est_days_min} ${shipping.est_days_min === 1 ? "día" : "días"}`
          : `${shipping.est_days_min}–${shipping.est_days_max} días`;
      items.push({
        key: "entrega",
        icon: <ClockIcon />,
        title: `Llega en ${days}`,
        text: "Te decimos la fecha estimada al confirmar.",
      });
    }
  }
  if (payments.length > 0) {
    items.push({
      key: "pago",
      icon: <CardIcon />,
      title: "Formas de pago",
      text: payments.map((m) => PAYMENT_LABELS[m]).join(", "),
    });
  }
  if (whatsapp) {
    items.push({
      key: "whatsapp",
      icon: <ChatIcon />,
      title: "¿Dudas? Escríbenos",
      text: `WhatsApp ${whatsapp}`,
    });
  }
  if (items.length === 0) return null;
  // Panel gris de anaquel con los datos en rejilla de 2 (rediseño A+B). Texto en el
  // color de texto del tema: sobre la superficie gris, el gris tenue podría bajar de 4.5:1.
  return (
    <section
      aria-label="Compra con confianza"
      className="rounded-[var(--sf-radius-card)] bg-[var(--sf-surface)] px-4 py-5 sm:px-6"
    >
      <ul className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-2.5">
            <span aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--sf-link)]">
              {item.icon}
            </span>
            <span className="min-w-0 text-[0.8125rem] leading-snug sm:text-sm">
              <span className="block font-bold">{item.title}</span>
              {item.text ? <span className="block">{item.text}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const ICON = {
  viewBox: "0 0 24 24",
  className: "h-6 w-6",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function TruckIcon() {
  return (
    <svg {...ICON}>
      <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg {...ICON}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg {...ICON}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M7 15h3" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg {...ICON}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
    </svg>
  );
}
