import { z } from "zod";

/**
 * Alertas accionables de Inicio (Orden 10, O10-02). La base cuenta
 * (`public.store_alerts`) con el mismo criterio que el filtro «Pendientes» de
 * la lista de productos; aquí se decide qué decirle a la dueña, qué tan urgente
 * es y a qué lista llevarla. Solo productos publicados (estado activo).
 */
export const storeAlertsSchema = z.object({
  out_of_stock: z.number().int().nonnegative().nullable(),
  low_stock: z.number().int().nonnegative().nullable(),
  without_photo: z.number().int().nonnegative(),
  without_category: z.number().int().nonnegative(),
});
export type StoreAlertCounts = z.infer<typeof storeAlertsSchema>;

export type AlertLevel = "alta" | "media" | "baja";

export interface StoreAlert {
  key: "agotados" | "sin_foto" | "pocas_existencias" | "sin_categoria";
  level: AlertLevel;
  count: number;
  title: string;
  description: string;
  action: string;
  /** Lista de productos filtrada, relativa al panel de la tienda. */
  href: string;
}

const LEVEL_ORDER: Record<AlertLevel, number> = { alta: 0, media: 1, baja: 2 };

export const LEVEL_LABEL: Record<AlertLevel, string> = {
  alta: "Urgente",
  media: "Importante",
  baja: "Cuando puedas",
};

const products = (n: number) =>
  n === 1 ? "1 producto publicado" : `${n.toLocaleString("es-MX")} productos publicados`;

/** Alertas con algo que atender (conteo > 0), de la más urgente a la menos. */
export function buildStoreAlerts(counts: StoreAlertCounts, base: string): StoreAlert[] {
  const list = (issue: StoreAlert["key"]) => `${base}/productos?estado=active&pendiente=${issue}`;
  const alerts: StoreAlert[] = [];
  if (counts.out_of_stock) {
    alerts.push({
      key: "agotados",
      level: "alta",
      count: counts.out_of_stock,
      title: "Presentaciones agotadas",
      description: `${products(counts.out_of_stock)} con al menos una talla, color o presentación sin existencias: tus clientes no la pueden comprar.`,
      action: "Surte o ajusta existencias, o permite vender sin existencias.",
      href: list("agotados"),
    });
  }
  if (counts.without_photo) {
    alerts.push({
      key: "sin_foto",
      level: "media",
      count: counts.without_photo,
      title: "Sin foto",
      description: `${products(counts.without_photo)} se ven en tu tienda sin imagen: se venden menos.`,
      action: "Sube sus fotos (puedes subirlas todas juntas en Importar → Imágenes).",
      href: list("sin_foto"),
    });
  }
  if (counts.low_stock) {
    alerts.push({
      key: "pocas_existencias",
      level: "media",
      count: counts.low_stock,
      title: "Pocas existencias",
      description: `${products(counts.low_stock)} en su mínimo de existencias o por debajo.`,
      action: "Pide a tu proveedor antes de que se agoten.",
      href: list("pocas_existencias"),
    });
  }
  if (counts.without_category) {
    alerts.push({
      key: "sin_categoria",
      level: "baja",
      count: counts.without_category,
      title: "Sin categoría",
      description: `${products(counts.without_category)} no aparecen al navegar tu tienda por categorías.`,
      action: "Asígnales categoría (en la lista puedes elegir varios y hacerlo en bloque).",
      href: list("sin_categoria"),
    });
  }
  return alerts.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}
