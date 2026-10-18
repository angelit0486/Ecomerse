import type { ComponentProps } from "react";

import { getCardVariants, getRatingSummaries } from "@/server/storefront/catalog";

import { ProductGrid as Grid } from "./product-card";

type Props = Omit<ComponentProps<typeof Grid>, "ratings" | "store" | "quickAdd"> & {
  store: ComponentProps<typeof Grid>["store"] & { id: string };
};

/**
 * La rejilla de productos con su calificación real (ADR-029) y la variante que
 * «Agregar» manda al carrito (rediseño A+B): una consulta de cada una por rejilla.
 */
export async function ProductGrid(props: Props) {
  const ids = props.products.map((p) => p.id);
  const [ratings, quickAdd] = await Promise.all([
    getRatingSummaries(props.store.id, ids),
    getCardVariants(props.store.id, ids),
  ]);
  return <Grid {...props} ratings={ratings} quickAdd={quickAdd} />;
}
