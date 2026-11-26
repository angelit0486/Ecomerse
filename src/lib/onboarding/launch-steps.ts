/**
 * «Lanza tu tienda» (panel, 2026-11-26): la lista de pasos de una tienda nueva,
 * la misma para el Inicio y para Configurar tienda (antes cada pantalla contaba
 * distinto: «Le faltan 6 pasos» frente a «1 de 9 pasos listos»).
 *
 * Qué impide publicar lo decide la base (`stores_launch_checklist`, §14.3): aquí
 * solo se ordena y se explica. Un paso «necesario» bloquea la publicación; uno
 * «recomendado» no, pero hace que la tienda se vea y cobre bien.
 */
export interface LaunchIssue {
  code: string;
  message: string;
}

export interface LaunchInput {
  /** Pendientes de la base (`stores_launch_checklist`). */
  issues: readonly LaunchIssue[];
  launched: boolean;
  brandingSaved: boolean;
  hasLogo: boolean;
  /** Productos de ejemplo de la plantilla que siguen en el catálogo. */
  sampleCount: number;
  /** Zonas de envío con al menos una tarifa activa (la base solo las exige con productos físicos). */
  shippingZones: number;
  taxRateBps: number;
  pricesIncludeTax: boolean;
  currency: string;
  customDomain: boolean;
  /** `/admin/{handle}` */
  base: string;
}

export type StepGroup = "marca" | "catalogo" | "cobrar" | "reglas" | "abrir";

export const GROUP_LABEL: Record<StepGroup, string> = {
  marca: "Tu marca",
  catalogo: "Tu catálogo",
  cobrar: "Cobrar y entregar",
  reglas: "Reglas de la tienda",
  abrir: "Abrir la tienda",
};

export interface LaunchStep {
  key: string;
  group: StepGroup;
  title: string;
  /** Qué se hace en el paso. */
  detail: string;
  /** Por qué importa (se muestra en «Siguiente paso»). */
  why: string;
  href: string;
  done: boolean;
  /** Bloquea la publicación (lo exige la base). */
  required: boolean;
  /** No cuenta para el avance (dominio propio). */
  optional?: boolean;
}

const POLICY = /^policy_/;

export function launchSteps(input: LaunchInput): LaunchStep[] {
  const has = (code: string) => input.issues.some((i) => i.code === code);
  const { base } = input;
  const steps: LaunchStep[] = [
    {
      key: "template",
      group: "marca",
      title: "Plantilla y estilo",
      detail: "Giro, colores y portada",
      why: "Tu tienda arranca con un diseño de tu giro; luego lo ajustas a tu marca.",
      href: "#paso-plantilla",
      done: input.brandingSaved,
      required: false,
    },
    {
      key: "profile",
      group: "marca",
      title: "Datos de la tienda",
      detail: `Nombre, correo de contacto y zona horaria · ${input.currency}`,
      why: "Tus compradores necesitan un correo para escribirte; sin él no se puede publicar.",
      href: "#paso-datos",
      done: !has("contact"),
      required: true,
    },
    {
      key: "logo",
      group: "marca",
      title: "Logo",
      detail: "La imagen de tu marca",
      why: "Con tu logo, la tienda se reconoce y da confianza desde el primer vistazo.",
      href: "#paso-logo",
      done: input.hasLogo,
      required: false,
    },
    {
      key: "products",
      group: "catalogo",
      title: "Productos",
      detail:
        input.sampleCount > 0
          ? `Quita los ${input.sampleCount} de ejemplo y sube los tuyos`
          : "Agrega o importa tu catálogo",
      why:
        input.sampleCount > 0
          ? "Los productos de ejemplo de la plantilla no se pueden vender: bórralos antes de publicar."
          : "Publica al menos un producto con precio para que se pueda comprar algo.",
      href: input.sampleCount > 0 ? "#paso-plantilla" : `${base}/productos`,
      done: !has("active_product") && !has("sample_products") && input.sampleCount === 0,
      required: true,
    },
    {
      key: "payments",
      group: "cobrar",
      title: "Pagos",
      detail: "Transferencia, Mercado Pago o tarjeta",
      why: "Sin un método de pago activo, nadie puede terminar una compra.",
      href: "#paso-pagos",
      done: !has("payment_method"),
      required: true,
    },
    {
      key: "shipping",
      group: "cobrar",
      title: "Envíos",
      detail: "Zonas y tarifas para todo México",
      why: "Define a dónde envías y cuánto cuesta; el comprador ve el costo antes de pagar.",
      href: `${base}/envios`,
      // Listo solo con una zona real: «sin productos físicos aún» no es «listo».
      // Necesario solo cuando la base lo exige (hay productos que se envían).
      done: !has("shipping_zone") && input.shippingZones > 0,
      required: has("shipping_zone"),
    },
    {
      key: "taxes",
      group: "cobrar",
      title: "Impuestos",
      detail:
        input.taxRateBps > 0
          ? `IVA ${input.taxRateBps / 100} % ${input.pricesIncludeTax ? "incluido en los precios" : "se suma al precio"}`
          : "Revisa la tasa con tu contador",
      why: "Así tus precios y tus tickets muestran el IVA correcto.",
      href: `${base}/impuestos`,
      done: input.taxRateBps > 0,
      required: false,
    },
    {
      key: "policies",
      group: "reglas",
      title: "Políticas",
      detail: "Privacidad, términos, devoluciones y envíos",
      why: "La ley y tus compradores las piden: la plantilla trae el texto, solo completa tus datos.",
      href: `${base}/contenido`,
      done: !input.issues.some((i) => POLICY.test(i.code)),
      required: true,
    },
  ];
  if (has("compliance_profile")) {
    steps.push({
      key: "compliance",
      group: "reglas",
      title: "Cumplimiento sanitario",
      detail: "Reglas de tus categorías reguladas",
      why: "Algunas categorías tienen reglas sanitarias que deben quedar revisadas antes de vender.",
      href: `${base}/ajustes/cumplimiento`,
      done: false,
      required: true,
    });
  }
  steps.push(
    {
      key: "publish",
      group: "abrir",
      title: "Publicar",
      detail: "Abre tu tienda a los compradores",
      why: "Todo lo necesario está listo: publica y comparte tu enlace.",
      href: "#paso-publicar",
      done: input.launched,
      required: true,
    },
    {
      key: "domain",
      group: "abrir",
      title: "Dominio propio",
      detail: "Tu dirección .com o .mx",
      why: "Con tu propio dominio la tienda se ve más profesional y es más fácil de recordar.",
      href: `${base}/ajustes/dominio`,
      done: input.customDomain,
      required: false,
      optional: true,
    },
  );
  return steps;
}

export interface LaunchProgress {
  done: number;
  total: number;
  /** 0–100, redondeado hacia abajo (nunca «100 %» con algo pendiente). */
  percent: number;
  /** Lo que conviene hacer ahora: el primer necesario pendiente, luego el resto. */
  next: LaunchStep | null;
  /** Necesarios pendientes antes de poder publicar (sin contar «Publicar»). */
  blocking: number;
}

export function launchProgress(steps: readonly LaunchStep[]): LaunchProgress {
  const counted = steps.filter((s) => !s.optional);
  const done = counted.filter((s) => s.done).length;
  const pending = (s: LaunchStep) => !s.done && s.key !== "publish";
  const blocking = counted.filter((s) => s.required && pending(s)).length;
  const next =
    counted.find((s) => s.required && pending(s)) ??
    counted.find((s) => !s.done && s.key !== "publish") ??
    counted.find((s) => !s.done) ??
    steps.find((s) => !s.done) ??
    null;
  return {
    done,
    total: counted.length,
    percent: counted.length === 0 ? 100 : Math.floor((done / counted.length) * 100),
    next,
    blocking,
  };
}

/** Texto de la tarjeta del Inicio (misma cuenta que la guía). */
export function launchSummary(p: LaunchProgress): string {
  if (p.blocking === 0) return "Ya tiene todo lo necesario para publicar.";
  return p.blocking === 1
    ? "Le falta 1 paso necesario para publicar."
    : `Le faltan ${p.blocking} pasos necesarios para publicar.`;
}
