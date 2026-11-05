import { z } from "zod";

/**
 * «Salud de tu tienda» (auditoría global, paso 19): forma de
 * `public.store_health()` y qué decirle a la dueña de cada revisión. La base
 * decide los umbrales; aquí solo se explican y se apunta a dónde arreglarlo.
 */
export const storeHealthSchema = z.object({
  checked_at: z.string(),
  status: z.enum(["ok", "warning", "critical"]),
  checks: z.array(
    z.object({
      key: z.string(),
      status: z.enum(["ok", "warning", "critical"]),
      value: z.number(),
      limit: z.number().optional(),
      missing: z.array(z.string()).optional(),
    }),
  ),
});

export type StoreHealth = z.infer<typeof storeHealthSchema>;
export type HealthCheck = StoreHealth["checks"][number];

export interface CheckCopy {
  title: string;
  /** Qué pasa y por qué importa (solo si no está bien). */
  detail: string | null;
  /** Ruta del panel, relativa a /admin/[tienda]. */
  path: string;
  action: string;
}

const POLICY_LABEL: Record<string, string> = {
  policy_privacy: "aviso de privacidad",
  policy_returns: "devoluciones",
  policy_shipping: "envíos",
  policy_terms: "términos y condiciones",
};

const PLAN_LABEL: Record<string, string> = {
  plan_max_products: "productos",
  plan_max_staff: "personas del equipo",
  plan_storage_mb: "MB de fotos y archivos",
};

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export function describeCheck(c: HealthCheck): CheckCopy {
  const ok = c.status === "ok";
  switch (c.key) {
    case "notifications":
      return {
        title: ok ? "Recibes los avisos de pedidos" : "Nadie recibe los avisos de pedidos",
        detail: ok
          ? null
          : "Sin un correo de contacto ni destinatarios de avisos, no te enterarás de los pedidos nuevos.",
        path: "/ajustes/notificaciones",
        action: "Elegir quién recibe los avisos",
      };
    case "payments":
      return {
        title:
          c.status === "critical"
            ? "No tienes ninguna forma de pago activa"
            : c.status === "warning"
              ? "Solo aceptas pagos manuales"
              : "Tienes pagos en línea activos",
        detail:
          c.status === "critical"
            ? "Tus clientes no pueden terminar una compra."
            : c.status === "warning"
              ? "Conecta Mercado Pago para cobrar con tarjeta sin confirmar cada pago a mano."
              : null,
        path: "/ajustes/pagos",
        action: "Revisar pagos",
      };
    case "shipping":
      return {
        title: ok ? "Tienes tarifas de envío activas" : "No tienes tarifas de envío activas",
        detail: ok ? null : "Vendes productos que se envían y nadie podrá elegir cómo recibirlos.",
        path: "/envios",
        action: "Configurar envíos",
      };
    case "products_without_photo":
      return {
        title: ok
          ? "Todos tus productos tienen foto"
          : `${plural(c.value, "producto sin foto", "productos sin foto")}`,
        detail: ok ? null : "Un producto sin foto casi no se vende.",
        path: "/productos?pendiente=sin_foto",
        action: "Ver productos sin foto",
      };
    case "out_of_stock":
      return {
        title: ok
          ? "Todos tus productos se pueden comprar"
          : `${plural(c.value, "producto agotado", "productos agotados")}`,
        detail: ok
          ? null
          : "Siguen a la vista, pero nadie puede comprarlos hasta que tengan existencias.",
        path: "/productos?pendiente=agotados",
        action: "Ver productos agotados",
      };
    case "policies": {
      const missing = (c.missing ?? []).map((m) => POLICY_LABEL[m] ?? m);
      return {
        title: ok ? "Tus políticas están publicadas" : "Faltan políticas por publicar",
        detail: ok
          ? null
          : `Sin publicar: ${missing.join(", ")}.${
              c.status === "critical" ? " El aviso de privacidad es obligatorio por ley." : ""
            }`,
        path: "/contenido",
        action: "Publicar políticas",
      };
    }
    case "plan_max_products":
    case "plan_max_staff":
    case "plan_storage_mb": {
      const what = PLAN_LABEL[c.key]!;
      return {
        title: `Usas ${c.value} de ${c.limit ?? "?"} ${what} de tu plan`,
        detail:
          c.status === "critical"
            ? "Llegaste al límite: no podrás agregar más hasta cambiar de plan."
            : c.status === "warning"
              ? "Estás cerca del límite de tu plan."
              : null,
        path: "/ajustes/plan",
        action: "Ver tu plan",
      };
    }
    case "orders_waiting":
      return {
        title: ok
          ? "No hay pedidos pagados esperando más de 3 días"
          : `${plural(c.value, "pedido pagado lleva", "pedidos pagados llevan")} más de 3 días sin enviarse`,
        detail: ok ? null : "Los clientes esperan su paquete; envíalos o avísales.",
        path: "/pedidos?estado=por-surtir",
        action: "Ver pedidos por surtir",
      };
    case "orders_attention":
      return {
        title: ok
          ? "Ningún pedido requiere atención"
          : `${plural(c.value, "pedido requiere", "pedidos requieren")} atención`,
        detail: ok
          ? null
          : "Revisa cada uno: puede haber un pago con monto distinto o un contracargo.",
        path: "/pedidos?estado=atencion",
        action: "Ver pedidos en atención",
      };
    default:
      return { title: c.key, detail: null, path: "", action: "Revisar" };
  }
}

const ORDER = { critical: 0, warning: 1, ok: 2 } as const;

/** Primero lo urgente, luego los avisos y al final lo que está bien. */
export function sortChecks(checks: HealthCheck[]): HealthCheck[] {
  return [...checks].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
}
