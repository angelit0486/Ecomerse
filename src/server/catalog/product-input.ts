import { z } from "zod";

import { MAX_OPTIONS } from "@/lib/catalog/variants";

/**
 * Contrato del payload de catalog_upsert_product (supabase/migrations/
 * 20261009000200_catalog_rpc.sql). Validación previa en el servidor para dar
 * errores de campo claros; la base vuelve a validar todo (es la autoridad).
 * Dinero en centavos (bigint en la base; enteros seguros en JS).
 */
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const variantInputSchema = z.object({
  id: z.uuid().optional(),
  options: z.record(z.string(), z.string().min(1).max(60)).default({}),
  sku: z.string().trim().max(64).optional().nullable(),
  barcode: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{4,32}$/)
    .optional()
    .nullable(),
  price: cents,
  compare_at_price: cents.optional().nullable(),
  cost: cents.optional().nullable(),
  weight_g: z.number().int().min(0).optional().nullable(),
  status: z.enum(["active", "inactive"]).default("active"),
  track_inventory: z.boolean().default(true),
  inventory_policy: z.enum(["deny", "continue"]).default("deny"),
  requires_shipping: z.boolean().default(true),
  position: z.number().int().min(0).default(0),
});

export const productInputSchema = z
  .object({
    id: z.uuid().optional(),
    title: z.string().trim().min(1).max(200),
    slug: z.string().trim().max(120).optional(),
    description_html: z.string().max(102400).optional().nullable(),
    brand_id: z.uuid().optional().nullable(),
    tags: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
    seo_title: z.string().max(70).optional().nullable(),
    seo_description: z.string().max(320).optional().nullable(),
    options: z
      .array(
        z.object({
          name: z
            .string()
            .trim()
            .min(1)
            .max(60)
            .regex(/^[^=|]+$/),
          values: z
            .array(
              z
                .string()
                .trim()
                .min(1)
                .max(60)
                .regex(/^[^=|]+$/),
            )
            .min(1)
            .max(100),
        }),
      )
      .max(MAX_OPTIONS)
      .default([]),
    variants: z.array(variantInputSchema).min(1).max(100),
    categories: z
      .array(z.object({ id: z.uuid(), is_primary: z.boolean().default(false) }))
      .optional(),
  })
  .superRefine((p, ctx) => {
    for (const [i, v] of p.variants.entries()) {
      if (v.compare_at_price != null && v.compare_at_price <= v.price) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", i, "compare_at_price"],
          message: "mayor_que_precio",
        });
      }
    }
    if ((p.categories ?? []).filter((c) => c.is_primary).length > 1) {
      ctx.addIssue({ code: "custom", path: ["categories"], message: "una_principal" });
    }
  });

export type ProductInput = z.infer<typeof productInputSchema>;
