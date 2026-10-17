import type { ComponentProps } from "react";

import { getRatingSummaries } from "@/server/storefront/catalog";

import { ProductGrid as Grid } from "./product-card";

type Props = Omit<ComponentProps<typeof Grid>, "ratings" | "store"> & {
  store: ComponentProps<typeof Grid>["store"] & { id: string };
};

/** La rejilla de productos con su calificación real (una consulta por rejilla, ADR-029). */
export async function ProductGrid(props: Props) {
  const ratings = await getRatingSummaries(
    props.store.id,
    props.products.map((p) => p.id),
  );
  return <Grid {...props} ratings={ratings} />;
}
