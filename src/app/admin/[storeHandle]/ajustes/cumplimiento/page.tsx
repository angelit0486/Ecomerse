import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PLACEMENT_LABELS, supplementFieldLabel } from "@/lib/compliance/labels";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { getComplianceStatus, type ComplianceCategoryStatus } from "@/server/compliance/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { ClassifyPublishedForm, DeclareCategoryForm } from "./compliance-forms";

export const metadata: Metadata = { title: "Cumplimiento sanitario" };

type Props = { params: Promise<{ storeHandle: string }> };

/**
 * Ajustes → Cumplimiento (R-T02, ADR-021): qué categorías reguladas vende la tienda
 * y qué exigen las reglas de su país. Los textos de las leyendas los define la
 * plataforma con su asesor regulatorio; la tienda solo los ve.
 */
export default async function CompliancePage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "store.read")) notFound();
  const supabase = await createSupabaseServerClient();
  const status = await getComplianceStatus(supabase, ctx.store.id);
  const canDeclare = hasPermission(ctx, "store.update");
  const canClassify = hasPermission(ctx, "products.update");
  const date = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
    timeZone: ctx.store.timezone,
  });

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Cumplimiento sanitario</h1>
        <p className="max-w-2xl text-sm text-fg-muted">
          Si vendes productos regulados, decláralo aquí. Mientras una categoría esté declarada, cada
          producto necesita su ficha sanitaria (o marcarse como no regulado) para publicarse, y la
          tienda muestra las leyendas que exigen las reglas de tu país.
        </p>
      </header>

      {status.categories.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-sm">
          Por ahora no hay categorías reguladas para el país de tu tienda ({status.country}).
        </p>
      ) : (
        status.categories.map((category) => (
          <CategoryCard
            key={category.key}
            category={category}
            storeHandle={ctx.store.handle}
            canDeclare={canDeclare}
            formatDate={(iso) => date.format(new Date(iso))}
          />
        ))
      )}

      <section
        aria-labelledby="sin-clasificar"
        className="space-y-2 rounded-md border border-border p-4"
      >
        <h2 id="sin-clasificar" className="font-semibold">
          Productos publicados sin clasificar
        </h2>
        {status.unclassified_active === 0 ? (
          <p className="text-sm text-fg-muted">
            Todos tus productos publicados están clasificados.
          </p>
        ) : (
          <>
            <p className="text-sm">
              {status.unclassified_active === 1
                ? "Tienes 1 producto publicado sin clasificar."
                : `Tienes ${status.unclassified_active} productos publicados sin clasificar.`}{" "}
              Para declarar una categoría, cada uno necesita su ficha sanitaria o marcarse como no
              regulado. Si alguno es un suplemento, completa su ficha desde el producto.
            </p>
            {canClassify ? (
              <ClassifyPublishedForm
                storeHandle={ctx.store.handle}
                count={status.unclassified_active}
              />
            ) : (
              <p className="text-sm text-fg-muted">Tu rol no permite clasificar productos.</p>
            )}
          </>
        )}
      </section>
    </section>
  );
}

function CategoryCard({
  category,
  storeHandle,
  canDeclare,
  formatDate,
}: {
  category: ComplianceCategoryStatus;
  storeHandle: string;
  canDeclare: boolean;
  formatDate: (iso: string) => string;
}) {
  const { profile } = category;
  const headingId = `categoria-${category.key}`;
  return (
    <section aria-labelledby={headingId} className="space-y-4 rounded-md border border-border p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={headingId} className="font-semibold">
          {category.name}
        </h2>
        <p className="text-sm">
          {category.declared
            ? `Declarada · ${category.products === 1 ? "1 producto" : `${category.products} productos`}`
            : "No declarada"}
        </p>
      </header>

      {profile.status === "active" && profile.reviewed_by && profile.reviewed_at ? (
        <p className="text-sm">
          Reglas revisadas por {profile.reviewed_by} el {formatDate(profile.reviewed_at)} (versión{" "}
          {profile.version}).
        </p>
      ) : (
        <p role="status" className="rounded-md border border-warning p-3 text-sm">
          {profile.status === "suspended"
            ? "Las reglas de esta categoría están suspendidas: sus productos no se pueden publicar."
            : "Las reglas de esta categoría aún no están revisadas por la plataforma. Puedes preparar las fichas, pero no podrás publicar estos productos ni lanzar la tienda con esta categoría hasta que se revisen."}
        </p>
      )}

      {category.required_fields.length > 0 ? (
        <div className="space-y-1">
          <h3 className="text-[13px] font-medium">Campos obligatorios de la ficha</h3>
          <p className="text-sm">
            {category.required_fields.map((f) => supplementFieldLabel(f)).join(", ")}.
          </p>
        </div>
      ) : null}

      {category.legends.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-[13px] font-medium">Leyendas que verá el comprador</h3>
          <ul className="space-y-2">
            {category.legends.map((legend) => (
              <li key={legend.key} className="rounded-md bg-canvas p-3 text-sm">
                <p className="font-medium">{legend.label}</p>
                <p className="whitespace-pre-line">{legend.text}</p>
                <p className="mt-1 text-[13px] text-fg-muted">
                  En: {legend.placements.map((p) => PLACEMENT_LABELS[p] ?? p).join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {category.forbidden_terms.length > 0 ? (
        <div className="space-y-1">
          <h3 className="text-[13px] font-medium">Términos que no puede usar un producto</h3>
          <p className="text-sm">{category.forbidden_terms.map((t) => `«${t.term}»`).join(", ")}</p>
        </div>
      ) : null}

      {canDeclare ? (
        <DeclareCategoryForm
          storeHandle={storeHandle}
          categoryKey={category.key}
          categoryName={category.name}
          declared={category.declared}
        />
      ) : null}
    </section>
  );
}
