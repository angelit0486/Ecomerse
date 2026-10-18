import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { getProductAttributeValues, listAttributes } from "@/server/catalog/attributes";
import { getProduct, listBrands, listCategories, validateProduct } from "@/server/catalog/queries";
import { getComplianceStatus, getRegulatoryInfo } from "@/server/compliance/queries";
import { callRpc } from "@/server/db/rpc";
import { storeOrigin } from "@/server/storefront/seo";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { ProductAttributesForm } from "../attribute-forms";
import { toEditorProduct } from "../editor-model";
import { publishIssueMessage, STATUS_LABELS } from "../messages";
import { ProductHistory, type HistoryEvent } from "../product-history";
import { SchedulePublish } from "../schedule-publish";
import { StockAdjust } from "../stock-adjust";
import { ProductEditor } from "../product-editor";
import { ProductImages } from "../product-images";
import { ProductStatusPanel } from "../product-status";
import { SalesList, ScheduleSaleForm, type SaleRow } from "../product-sales";
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
  // Existencias por presentación (solo con inventory.read): suma de las ubicaciones.
  const stock: Record<string, number> = {};
  // En mano en la ubicación principal: lo que fija el ajuste rápido.
  const onHandDefault: Record<string, number> = {};
  if (hasPermission(ctx, "inventory.read") && product.variants.length > 0) {
    const { data: levels, error: levelsError } = await supabase
      .from("inventory_levels")
      .select("variant_id, available, on_hand, inventory_locations(is_default)")
      .in(
        "variant_id",
        product.variants.map((v) => v.id),
      );
    if (levelsError) throw levelsError;
    for (const l of (levels ?? []) as unknown as {
      variant_id: string;
      available: number;
      on_hand: number;
      inventory_locations: { is_default: boolean } | null;
    }[]) {
      stock[l.variant_id] = (stock[l.variant_id] ?? 0) + Math.max(0, l.available);
      if (l.inventory_locations?.is_default) onHandDefault[l.variant_id] = l.on_hand;
    }
  }
  const canSeeHistory = hasPermission(ctx, "audit.read");
  const [history, domains, sales] = await Promise.all([
    canSeeHistory
      ? callRpc<HistoryEvent[]>(supabase, "catalog_product_history", {
          p_store_id: ctx.store.id,
          p_product_id: product.id,
          p_limit: 30,
        })
      : Promise.resolve([] as HistoryEvent[]),
    product.status === "active" && !product.deleted_at && ctx.store.status === "active"
      ? supabase
          .from("store_domains")
          .select("hostname, is_primary, type")
          .eq("store_id", ctx.store.id)
          .eq("status", "active")
      : Promise.resolve({ data: null }),
    callRpc<SaleRow[]>(supabase, "catalog_list_sales", {
      p_store_id: ctx.store.id,
      p_product_id: product.id,
      p_include_past: true,
      p_limit: 20,
    }),
  ]);
  // «Ver en la tienda»: solo un producto publicado de una tienda abierta.
  const domain =
    domains.data?.find((d) => d.is_primary) ??
    domains.data?.find((d) => d.type === "platform_subdomain");
  const publicUrl = domain
    ? `${storeOrigin({ primary_hostname: domain.hostname, handle: ctx.store.handle })}/productos/${product.slug}`
    : null;
  // Un borrador se ve en la vista previa privada de la tienda (ADR-032): la ruta
  // del panel crea el token y abre la ficha.
  const previewHref =
    product.status === "draft" && !product.deleted_at && hasPermission(ctx, "appearance.manage")
      ? `/admin/${ctx.store.handle}/apariencia/vista-previa?ruta=${encodeURIComponent(`/productos/${product.slug}`)}`
      : null;
  const canAdjustStock =
    hasPermission(ctx, "inventory.adjust") &&
    hasPermission(ctx, "inventory.read") &&
    !product.deleted_at;
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
          {publicUrl ? (
            <>
              {" · "}
              <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="underline">
                Ver en la tienda
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            </>
          ) : null}
          {previewHref ? (
            <>
              {" · "}
              <a href={previewHref} target="_blank" rel="noopener noreferrer" className="underline">
                Ver en la vista previa (solo tú)
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            </>
          ) : null}
        </p>
        {sp.creado === "1" ? (
          <p role="status" className="mt-2 text-sm text-success">
            Producto creado como borrador. Agrega imágenes y publícalo cuando esté listo.
          </p>
        ) : null}
        {sp.copiado === "1" ? (
          <p role="status" className="mt-2 text-sm text-success">
            Copia creada como borrador, con sus presentaciones, ficha y atributos. Las fotos se
            copian en segundo plano y aparecen al terminar; el SKU y el código de barras se dejan
            vacíos (son únicos).
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

      {product.status === "draft" &&
      !product.deleted_at &&
      hasPermission(ctx, "products.publish") ? (
        <SchedulePublish
          storeHandle={ctx.store.handle}
          productId={product.id}
          scheduledLabel={
            product.publish_at
              ? new Intl.DateTimeFormat("es-MX", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: ctx.store.timezone,
                }).format(new Date(product.publish_at))
              : null
          }
          timeZoneLabel={ctx.store.timezone.replace(/^America\//, "").replace(/_/g, " ")}
        />
      ) : null}

      {(canEdit && product.variants.length > 0) || sales.length > 0 ? (
        <section aria-labelledby="ofertas-titulo" className="space-y-3">
          <h2 id="ofertas-titulo" className="text-base font-semibold">
            Ofertas con fechas
          </h2>
          {canEdit && product.variants.length > 0 ? (
            <ScheduleSaleForm
              storeHandle={ctx.store.handle}
              productIds={[product.id]}
              variants={product.variants
                .filter((v) => v.status === "active")
                .map((v) => ({
                  id: v.id,
                  label:
                    (Object.values(v.options).join(" / ") || "Única") +
                    (v.sku ? ` (${v.sku})` : ""),
                }))}
              currency={ctx.store.currency}
              timeZone={ctx.store.timezone}
              timeZoneLabel={ctx.store.timezone.replace(/^America\//, "").replace(/_/g, " ")}
            />
          ) : null}
          <SalesList
            storeHandle={ctx.store.handle}
            sales={sales}
            currency={ctx.store.currency}
            timeZone={ctx.store.timezone}
            canEdit={canEdit}
          />
        </section>
      ) : null}

      <ProductImages
        storeHandle={ctx.store.handle}
        productId={product.id}
        images={product.media}
        canEdit={canEdit}
        variants={product.variants.map((v) => ({
          id: v.id,
          label: Object.values(v.options).join(" / ") || "Única",
          image_id: v.image_id,
        }))}
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
          stock={hasPermission(ctx, "inventory.read") ? stock : null}
          inventoryHref={
            hasPermission(ctx, "inventory.adjust") ? `/admin/${ctx.store.handle}/inventario` : null
          }
        />
      ) : null}

      {canAdjustStock && product.variants.some((v) => v.track_inventory) ? (
        <StockAdjust
          storeHandle={ctx.store.handle}
          rows={product.variants
            .filter((v) => v.track_inventory)
            .map((v) => ({
              id: v.id,
              label: Object.values(v.options).join(" / ") || v.sku || "Única",
              onHand: onHandDefault[v.id] ?? 0,
              available: stock[v.id] ?? 0,
              movementsHref: `/admin/${ctx.store.handle}/inventario/${v.id}`,
            }))}
        />
      ) : null}

      {canSeeHistory ? (
        <ProductHistory
          events={history}
          variantLabels={Object.fromEntries(
            product.variants.map((v) => [
              v.id,
              Object.values(v.options).join(" / ") || v.sku || "Única",
            ]),
          )}
          currency={ctx.store.currency}
          timeZone={ctx.store.timezone}
          activityHref={`/admin/${ctx.store.handle}/ajustes/actividad`}
        />
      ) : null}

      {canEdit ? null : (
        <p className="text-sm text-fg-muted">
          {product.deleted_at
            ? "Restaura el producto para editarlo."
            : "Puedes ver este producto, pero no editarlo con tu rol."}
        </p>
      )}
    </section>
  );
}
