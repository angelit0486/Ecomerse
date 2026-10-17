import { centsToInput } from "@/lib/money/format";

/** Modelo del editor (strings para los inputs; el dinero se captura como texto y se convierte a centavos al enviar). */
export interface EditorProduct {
  id: string | null;
  title: string;
  slug: string;
  description_html: string;
  brand_id: string;
  tags: string;
  seo_title: string;
  seo_description: string;
  options: { name: string; values: string[] }[];
  variants: {
    id?: string;
    options: Record<string, string>;
    sku: string;
    barcode: string;
    price: string;
    compare_at_price: string;
    cost: string;
    active: boolean;
    net_content: string;
    servings: string;
  }[];
  categories: { id: string; is_primary: boolean }[];
}

export function toEditorProduct(
  product: {
    id: string;
    title: string;
    slug: string;
    description_html: string | null;
    brand_id: string | null;
    tags: string[];
    seo_title: string | null;
    seo_description: string | null;
    options: { name: string; values: string[] }[];
    variants: {
      id: string;
      options: Record<string, string>;
      sku: string | null;
      barcode: string | null;
      price: number;
      compare_at_price: number | null;
      cost: number | null;
      status: string;
      net_content?: string | null;
      servings_per_container?: number | null;
    }[];
    categories: { id: string; is_primary: boolean }[];
  } | null,
): EditorProduct {
  if (!product) {
    return {
      id: null,
      title: "",
      slug: "",
      description_html: "",
      brand_id: "",
      tags: "",
      seo_title: "",
      seo_description: "",
      options: [],
      variants: [],
      categories: [],
    };
  }
  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    description_html: product.description_html ?? "",
    brand_id: product.brand_id ?? "",
    tags: product.tags.join(", "),
    seo_title: product.seo_title ?? "",
    seo_description: product.seo_description ?? "",
    options: product.options,
    variants: product.variants.map((v) => ({
      id: v.id,
      options: v.options,
      sku: v.sku ?? "",
      barcode: v.barcode ?? "",
      price: centsToInput(v.price),
      compare_at_price: centsToInput(v.compare_at_price),
      cost: centsToInput(v.cost),
      active: v.status === "active",
      net_content: v.net_content ?? "",
      servings: v.servings_per_container == null ? "" : String(v.servings_per_container),
    })),
    categories: product.categories,
  };
}
