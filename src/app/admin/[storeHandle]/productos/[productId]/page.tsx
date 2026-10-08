import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { getProductAttributeValues, listAttributes } from "@/server/catalog/attributes";
import { getProduct, listBrands, listCategories, validateProduct } from "@/server/catalog/queries";
import { getComplianceStatus, getRegulatoryInfo } from "@/server/compliance/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { ProductAttributesForm } from "../attribute-forms";
import { toEditorProduct } from "../editor-model";
import { publishIssueMessage, STATUS_LABELS } from "../messages";
import { ProductEditor } from "../product-editor";
import { ProductImages } from "../product-images";
import { ProductStatusPanel } from "../product-status";
import { RegulatoryForm, type RegulatoryInitial } from "../regulatory-form";

export const metadata: Metadata = { title: "Producto" };

type Props = {
  params: Promise<{ storeHandle: string; productId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProductPage({ params, searchParams }: Props) {
  const { storeHandle, productId } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "products.read") || !/^[0-9a-f-]{36}$/.test(productId)) notFound();
  const sp = await searchParams;

  const supabase = await createSupabaseServerClient();
  const canReadCost = hasPermission(ctx, "products.cost.read");
  const product = await getProduct(supabase, ctx.store.id, productId, canReadCost);
  if (!product) notFound();
  const canEdit = hasPermission(ctx, "products.update") && !product.deleted_at;
  const [brands, categories, issues, compliance, regulatory, attributes, attributeValues] =
    await Promise.all([
      listBrands(supabase, ctx.store.id),
      listCategories(supabase, ctx.store.id),
      product.deleted_at
        ? Promise.resolve([])
        : validateProduct(supabase, ctx.store.id, product.id),
      canEdit ? getComplianceStatus(supabase, ctx.store.id) : Promise.resolve(null),
      canEdit ? getRegulatoryInfo(supabase, ctx.store.id, product.id) : Promise.resolve(null),
      canEdit ? listAttributes(supabase, ctx.store.id) : Promise.resolve([]),
      canEdit ? getProductAttributeValues(supabase, ctx.store.id, product.id) : Promise.resolve([]),
    ]);
  // La ficha sanitaria aparece cuando la tienda declaró una categoría regulada (ADR-021).
  const declared = compliance?.categories.filter((c) => c.declared) ?? [];
  const regulatoryInitial: RegulatoryInitial = {
    classification: regulatory ? (regulatory.category_key ?? "none") : undefined,
    data: Object.fromEntries(
      Object.entries(regulatory?.data ?? {})
        .filter(([key]) => key !== "nutrition")
        .map(([key, v]) => [key, String(v)]),
    ),
    nutrition: (regulatory?.data.nutrition ?? []).map((r) => ({
      name: r.name,
      amount: r.amount,
      unit: r.unit ?? "",
      dv: r.dv ?? "",
    })),
  };

  return (
    <section className="space-y-6">
      <header>
        <Link href={`/admin/${ctx.store.handle}/productos`} className="text-sm underline">
          ← Productos
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{product.title}</h1>
        <p className="text-sm text-fg-muted">
          {product.deleted_at ? "Eliminado" : (STATUS_LABELS[product.status] ?? product.status)}
        </p>
        {sp.creado === "1" ? (
          <p role="status" className="mt-2 text-sm text-success">
            Producto creado como borrador. Agrega imágenes y publícalo cuando esté listo.
          </p>
        ) : null}
        {sp.copiado === "1" ? (
          <p role="status" className="mt-2 text-sm text-success">
            Copia creada como borrador (sin imágenes, SKU ni código de barras).
          </p>
        ) : null}
      </header>

      <ProductStatusPanel
        storeHandle={ctx.store.handle}
        productId={product.id}
        status={product.status}
        deleted={Boolean(product.deleted_at)}
        can={{
          publish: hasPermission(ctx, "products.publish"),
          delete: hasPermission(ctx, "products.delete"),
          create: hasPermission(ctx, "products.create"),
        }}
        warnings={issues
          .filter((i) => i.level === "warning")
          .map((i) => publishIssueMessage(i.code))}
      />

      <ProductImages
        storeHandle={ctx.store.handle}
        productId={product.id}
        images={product.media}
        canEdit={canEdit}
      />

      {canEdit && (declared.length > 0 || regulatory) ? (
        <RegulatoryForm
          storeHandle={ctx.store.handle}
          productId={product.id}
          categories={declared.map((c) => ({
            key: c.key,
            name: c.name,
            profileStatus: c.profile.status,
            requiredFields: c.required_fields,
            legends: c.legends,
          }))}
          initial={regulatoryInitial}
        />
      ) : null}

      {canEdit && attributes.length > 0 ? (
        <ProductAttributesForm
          storeHandle={ctx.store.handle}
          productId={product.id}
          attributes={attributes.map((a) => ({
            id: a.id,
            name: a.name,
            values: a.values.map((v) => ({ id: v.id, label: v.label })),
          }))}
          selected={attributeValues}
        />
      ) : canEdit && hasPermission(ctx, "categories.manage") ? (
        <p className="text-sm text-fg-muted">
          Para filtrar en la tienda por objetivo, sabor u otra característica, crea tus{" "}
          <Link href={`/admin/${ctx.store.handle}/productos/atributos`} className="underline">
            atributos
          </Link>
          .
        </p>
      ) : null}

      {canEdit ? (
        <ProductEditor
          storeHandle={ctx.store.handle}
          initial={toEditorProduct(product)}
          brands={brands}
          categories={categories}
          canReadCost={canReadCost}
          currency={ctx.store.currency}
        />
      ) : (
        <p className="text-sm text-fg-muted">
          {product.deleted_at
            ? "Restaura el producto para editarlo."
            : "Puedes ver este producto, pero no editarlo con tu rol."}
        </p>
      )}
    </section>
  );
}
