import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PLACEMENT_LABELS, supplementFieldLabel } from "@/lib/compliance/labels";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import {
  getComplianceReport,
  getComplianceStatus,
  type ComplianceCategoryStatus,
  type ComplianceReport,
} from "@/server/compliance/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { publishIssueMessage, STATUS_LABELS } from "../../productos/messages";
import { ClassifyPublishedForm, DeclareCategoryForm, StoreLegendForm } from "./compliance-forms";

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
  const canReadProducts = hasPermission(ctx, "products.read");
  const [status, report] = await Promise.all([
    getComplianceStatus(supabase, ctx.store.id),
    canReadProducts ? getComplianceReport(supabase, ctx.store.id) : Promise.resolve(null),
  ]);
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
            canEditLegend={canDeclare}
            formatDate={(iso) => date.format(new Date(iso))}
          />
        ))
      )}

      {report ? (
        <BlockedProducts
          report={report}
          storeHandle={ctx.store.handle}
          terms={
            new Map(status.categories.flatMap((c) => c.forbidden_terms.map((t) => [t.key, t.term])))
          }
        />
      ) : null}

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
  canEditLegend,
  formatDate,
}: {
  category: ComplianceCategoryStatus;
  storeHandle: string;
  canDeclare: boolean;
  canEditLegend: boolean;
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
          {profile.status === "pending" && profile.review_notes ? (
            <span className="mt-1 block text-fg-muted">{profile.review_notes}</span>
          ) : null}
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

      {category.store_legend && category.declared ? (
        <StoreLegend
          legend={category.store_legend}
          categoryKey={category.key}
          storeHandle={storeHandle}
          canEdit={canEditLegend}
          formatDate={formatDate}
        />
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

function StoreLegend({
  legend,
  categoryKey,
  storeHandle,
  canEdit,
  formatDate,
}: {
  legend: NonNullable<ComplianceCategoryStatus["store_legend"]>;
  categoryKey: string;
  storeHandle: string;
  canEdit: boolean;
  formatDate: (iso: string) => string;
}) {
  const where = legend.placements.map((p) => PLACEMENT_LABELS[p] ?? p).join(", ");
  return (
    <section aria-labelledby={`leyenda-${categoryKey}`} className="space-y-3">
      <h3 id={`leyenda-${categoryKey}`} className="text-[13px] font-medium">
        Leyenda sanitaria de tu tienda
      </h3>
      <p className="text-sm">
        Las reglas piden una leyenda que redactas y apruebas con tu asesor regulatorio. Se muestra
        en: {where}. Sin leyenda aprobada, los productos de esta categoría no se pueden publicar.
      </p>
      {legend.approved && legend.reviewed_by && legend.reviewed_at ? (
        <div className="rounded-md bg-canvas p-3 text-sm">
          <p className="font-medium">
            Publicada · revisada por {legend.reviewed_by} el {formatDate(legend.reviewed_at)}
          </p>
          <p className="whitespace-pre-line">{legend.approved}</p>
        </div>
      ) : (
        <p role="status" className="rounded-md border border-warning p-3 text-sm">
          Aún no hay leyenda aprobada.
        </p>
      )}
      {legend.approved && legend.draft && legend.draft !== legend.approved ? (
        <p className="text-[13px] text-fg-muted">
          Hay un borrador distinto del texto publicado: el comprador sigue viendo el publicado.
        </p>
      ) : null}
      <StoreLegendForm
        storeHandle={storeHandle}
        categoryKey={categoryKey}
        initialBody={legend.draft ?? legend.suggested ?? ""}
        initialReviewer={legend.reviewed_by ?? ""}
        canEdit={canEdit}
      />
    </section>
  );
}

/** Validador de la tienda (Fase A): qué no se puede publicar y por qué. */
function BlockedProducts({
  report,
  storeHandle,
  terms,
}: {
  report: ComplianceReport;
  storeHandle: string;
  terms: Map<string, string>;
}) {
  const message = (code: string) => {
    const [base, key = ""] = code.split(":", 2);
    const term = base === "compliance_forbidden_term" ? terms.get(key) : undefined;
    return term
      ? `Usa «${term}», un término que las reglas sanitarias no permiten (título, descripción, ficha, etiquetas, opciones, marca, atributos o texto alternativo).`
      : publishIssueMessage(code);
  };
  return (
    <section
      aria-labelledby="no-publicables"
      className="space-y-3 rounded-md border border-border p-4"
    >
      <h2 id="no-publicables" className="font-semibold">
        Productos que no se pueden publicar
      </h2>
      {report.total === 0 ? (
        <p className="text-sm text-fg-muted">
          {report.checked === 0
            ? "Aún no tienes productos."
            : "Todos tus productos cumplen los requisitos para publicarse."}
        </p>
      ) : (
        <>
          <p className="text-sm">
            {report.total === 1
              ? "1 producto no cumple los requisitos para publicarse."
              : `${report.total} productos no cumplen los requisitos para publicarse.`}
            {report.total > report.products.length
              ? ` Se muestran los primeros ${report.products.length}.`
              : ""}
          </p>
          <ul className="divide-y divide-border">
            {report.products.map((product) => (
              <li key={product.id} className="space-y-1 py-3">
                <p className="text-sm">
                  <Link
                    href={`/admin/${storeHandle}/productos/${product.id}`}
                    className="font-medium underline underline-offset-4"
                  >
                    {product.title}
                  </Link>{" "}
                  <span className="text-fg-muted">
                    · {STATUS_LABELS[product.status] ?? product.status}
                  </span>
                </p>
                <ul className="list-disc space-y-0.5 pl-5 text-sm">
                  {product.codes.map((code) => (
                    <li key={code}>{message(code)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
