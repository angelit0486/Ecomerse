"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";

import { formatMoney } from "@/lib/money/format";
import { Button } from "@/ui/primitives/button";
import { ConfirmButton } from "@/ui/primitives/confirm-button";
import { Table, TBody, TD, TH, THead, TR } from "@/ui/primitives/table";

import { bulkProductsAction, type CatalogActionState } from "./actions";
import { QuickPrices, type QuickPriceVariant } from "./quick-prices";
import { linkButton, nativeControl } from "./styles";

interface Row {
  id: string;
  title: string;
  href: string;
  status: string;
  price: string;
  variants: number;
  /** Miniatura (la primera foto lista). */
  image: string | null;
  brand: string | null;
  /** null sin permiso de inventario. */
  stock: string | null;
  /** Alguna presentación activa sin existencias (y sin venta bajo pedido). */
  soldOut: boolean;
  /** Alguna presentación en o bajo su mínimo de existencias. */
  lowStock: boolean;
  /** null sin permiso de edición. */
  quickPrices: QuickPriceVariant[] | null;
}

const BULK_FORM = "bulk-products";

interface Choice {
  id: string;
  label: string;
}

export function BulkProductsTable({
  storeHandle,
  currency,
  rows,
  deletedView,
  canBulkStatus,
  canBulkDelete,
  canBulkEdit,
  brands,
  categories,
}: {
  storeHandle: string;
  currency: string;
  rows: Row[];
  deletedView: boolean;
  canBulkStatus: boolean;
  canBulkDelete: boolean;
  /** products.update: marca, categoría y precios en bloque. */
  canBulkEdit: boolean;
  brands: Choice[];
  categories: Choice[];
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  // Controlados: React reinicia los campos no controlados tras cada envío y la
  // vista previa de precios necesita conservarlos para «Aplicar cambios».
  const [bulkAction, setBulkAction] = useState("");
  const [percent, setPercent] = useState("");
  const [rounding, setRounding] = useState<"centavo" | "peso">("centavo");
  const [brandId, setBrandId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tag, setTag] = useState("");
  const [state, action, pending] = useActionState<CatalogActionState, FormData>(
    async (previous: CatalogActionState, formData: FormData) => {
      const result = await bulkProductsAction(storeHandle, previous, formData);
      if (result.ok) {
        setChosen(new Set());
        setPercent("");
      }
      return result;
    },
    {},
  );
  // Solo cuenta lo que sigue en esta página (tras borrar, paginar o refrescar).
  const selected = new Set(rows.map((r) => r.id).filter((id) => chosen.has(id)));
  const setSelected = setChosen;
  const bulkEnabled = !deletedView && (canBulkStatus || canBulkDelete || canBulkEdit);
  // La vista previa vale solo para lo que muestra: mismo porcentaje, redondeo y
  // selección; si cambia algo, hay que volver a verla antes de aplicar.
  const sameSelection = (ids: string[]) =>
    ids.length === selected.size && ids.every((id) => selected.has(id));
  const preview =
    state.preview &&
    bulkAction === "prices" &&
    state.preview.percent === percent.trim().replace(",", ".") &&
    state.preview.rounding === rounding &&
    sameSelection(state.preview.ids)
      ? state.preview
      : null;
  const money = (cents: number | null) => (cents === null ? "—" : formatMoney(cents, currency));
  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // El formulario masivo solo envuelve sus controles: cada fila tiene su propio
  // formulario de precios (no se pueden anidar) y las casillas se asocian con `form`.
  return (
    <div className="space-y-3">
      {bulkEnabled ? (
        <form
          id={BULK_FORM}
          // onSubmit y no `action`: React reinicia el formulario tras cada acción
          // y el selector volvería a «Acción…» entre la vista previa y «Aplicar».
          onSubmit={(event) => {
            event.preventDefault();
            const submitter = (event.nativeEvent as SubmitEvent).submitter;
            const data = new FormData(event.currentTarget, submitter);
            startTransition(() => action(data));
          }}
          className="flex flex-wrap items-center gap-2"
          aria-live="polite"
        >
          <span className="text-sm text-fg-muted">
            {selected.size === 0
              ? "Selecciona productos para acciones masivas."
              : `${selected.size} seleccionado${selected.size === 1 ? "" : "s"}`}
          </span>
          <label htmlFor="bulk-action" className="sr-only">
            Acción masiva
          </label>
          <select
            id="bulk-action"
            name="action"
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value)}
            className={nativeControl}
          >
            <option value="" disabled>
              Acción…
            </option>
            {canBulkStatus ? <option value="publish">Publicar</option> : null}
            {canBulkStatus ? <option value="draft">Pausar (ocultar de la tienda)</option> : null}
            {canBulkStatus ? <option value="archive">Archivar</option> : null}
            {canBulkEdit ? <option value="brand">Asignar marca…</option> : null}
            {canBulkEdit && categories.length ? (
              <option value="category_add">Agregar a una categoría…</option>
            ) : null}
            {canBulkEdit && categories.length ? (
              <option value="category_remove">Quitar de una categoría…</option>
            ) : null}
            {canBulkEdit ? <option value="tags_add">Agregar etiqueta…</option> : null}
            {canBulkEdit ? <option value="tags_remove">Quitar etiqueta…</option> : null}
            {canBulkEdit ? <option value="prices">Cambiar precios (%)…</option> : null}
            {canBulkEdit ? <option value="sale">Programar oferta…</option> : null}
            {canBulkDelete ? <option value="delete">Eliminar</option> : null}
          </select>
          {bulkAction === "brand" ? (
            <>
              <label htmlFor="bulk-brand" className="sr-only">
                Marca para los seleccionados
              </label>
              <select
                id="bulk-brand"
                name="brand_id"
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
                className={nativeControl}
              >
                <option value="">Sin marca</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          {bulkAction === "category_add" || bulkAction === "category_remove" ? (
            <>
              <label htmlFor="bulk-category" className="sr-only">
                Categoría para los seleccionados
              </label>
              <select
                id="bulk-category"
                name="category_id"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className={nativeControl}
              >
                <option value="" disabled>
                  Categoría…
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          {bulkAction === "tags_add" || bulkAction === "tags_remove" ? (
            <input
              name="tag"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              maxLength={60}
              placeholder="Etiqueta"
              aria-label="Etiqueta para los seleccionados"
              className={`${nativeControl} w-40`}
            />
          ) : null}
          {bulkAction === "prices" ? (
            <>
              <label className="flex items-center gap-1 text-sm">
                <span className="sr-only">Porcentaje</span>
                <input
                  name="percent"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  inputMode="decimal"
                  placeholder="10 o -15"
                  aria-label="Porcentaje de cambio"
                  aria-describedby="bulk-percent-help"
                  className={`${nativeControl} w-24`}
                />
                %
              </label>
              <label htmlFor="bulk-rounding" className="sr-only">
                Redondeo
              </label>
              <select
                id="bulk-rounding"
                name="rounding"
                value={rounding}
                onChange={(e) => setRounding(e.target.value === "peso" ? "peso" : "centavo")}
                className={nativeControl}
              >
                <option value="centavo">Al centavo</option>
                <option value="peso">Al peso</option>
              </select>
              <span id="bulk-percent-help" className="sr-only">
                Positivo sube los precios y negativo los baja. Primero verás una vista previa.
              </span>
            </>
          ) : null}
          {bulkAction === "sale" ? (
            // La oferta se arma en su propia página (fechas y vista previa).
            selected.size > 0 ? (
              <Link
                href={`/admin/${storeHandle}/productos/ofertas/nueva?${[...selected]
                  .map((id) => `ids=${id}`)
                  .join("&")}`}
                className={`${linkButton} border border-control`}
              >
                Continuar
              </Link>
            ) : null
          ) : (bulkAction === "archive" || bulkAction === "delete") && selected.size > 0 ? (
            // Archivar y eliminar piden confirmación; sin selección se queda el
            // botón deshabilitado de abajo (y la pregunta se cierra tras aplicar).
            <ConfirmButton
              key={bulkAction}
              size="sm"
              loading={pending}
              question={
                bulkAction === "delete"
                  ? selected.size === 1
                    ? "¿Eliminar el producto elegido?"
                    : `¿Eliminar los ${selected.size} productos elegidos?`
                  : selected.size === 1
                    ? "¿Archivar el producto elegido?"
                    : `¿Archivar los ${selected.size} productos elegidos?`
              }
              confirmLabel={bulkAction === "delete" ? "Sí, eliminar" : "Sí, archivar"}
              detail={
                bulkAction === "delete"
                  ? "Se pueden restaurar desde «Ver eliminados»."
                  : "Dejan de mostrarse en la tienda; puedes volver a publicarlos."
              }
            >
              Aplicar
            </ConfirmButton>
          ) : (
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              loading={pending}
              disabled={selected.size === 0 || !bulkAction}
            >
              {bulkAction === "prices" ? "Ver vista previa" : "Aplicar"}
            </Button>
          )}
        </form>
      ) : null}
      {preview ? (
        <section
          aria-label="Vista previa de precios"
          className="space-y-2 rounded border border-control p-3"
        >
          <p className="text-sm font-medium">
            Vista previa: {Number(preview.percent) > 0 ? "+" : ""}
            {preview.percent} % ({preview.rounding === "peso" ? "al peso" : "al centavo"}). Nada
            cambia hasta que apliques.
          </p>
          <Table caption="Precios actuales y nuevos" captionHidden>
            <THead>
              <TR>
                <TH>Producto</TH>
                <TH>Precio actual</TH>
                <TH>Precio nuevo</TH>
              </TR>
            </THead>
            <TBody>
              {preview.rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    {r.title}
                    {r.options ? (
                      <span className="block text-[13px] text-fg-muted">
                        {r.options
                          .split("|")
                          .map((kv) => kv.slice(kv.indexOf("=") + 1))
                          .join(" / ")}
                      </span>
                    ) : null}
                  </TD>
                  <TD className="tabular-nums">{money(r.price)}</TD>
                  <TD className="tabular-nums">
                    {money(r.new_price)}
                    {r.compare_at_price !== null && r.new_compare_at_price === null ? (
                      <span className="block text-[13px] text-warning">
                        Se quita el «precio antes» ({money(r.compare_at_price)}): ya no sería
                        oferta.
                      </span>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Button
            type="submit"
            form={BULK_FORM}
            name="confirm"
            value="1"
            size="sm"
            loading={pending}
            disabled={selected.size === 0}
          >
            Aplicar cambios
          </Button>
        </section>
      ) : null}
      {state.error ? (
        <div role="alert" className="text-sm text-danger">
          <p>{state.error}</p>
          {state.issues?.length ? (
            <ul className="list-disc pl-5">
              {state.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : state.ok ? (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      ) : null}

      <Table caption={deletedView ? "Productos eliminados" : "Productos"} captionHidden>
        <THead>
          <TR>
            {bulkEnabled ? (
              <TH>
                <input
                  type="checkbox"
                  aria-label="Seleccionar todos"
                  checked={allSelected}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                  }
                />
              </TH>
            ) : null}
            <TH>Producto</TH>
            <TH>Estado</TH>
            <TH>Precio</TH>
            {rows.some((r) => r.stock !== null) ? <TH>Existencias</TH> : null}
            {/* En el celular el número de presentaciones va bajo el nombre. */}
            <TH className="hidden md:table-cell">Variantes</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.id}>
              {bulkEnabled ? (
                <TD>
                  <input
                    type="checkbox"
                    form={BULK_FORM}
                    name="ids"
                    value={row.id}
                    aria-label={`Seleccionar ${row.title}`}
                    checked={selected.has(row.id)}
                    onChange={(e) => toggle(row.id, e.target.checked)}
                  />
                </TD>
              ) : null}
              {/* Ancho mínimo: en móvil el título se partía palabra por palabra. */}
              <TD className="min-w-52">
                <div className="flex items-center gap-3">
                  {row.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- miniatura ya re-codificada por Storage
                    <img
                      src={row.image}
                      alt=""
                      width={40}
                      height={40}
                      loading="lazy"
                      className="h-10 w-10 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-canvas text-[11px] text-fg-muted"
                    >
                      Sin foto
                    </span>
                  )}
                  <span className="min-w-0">
                    <Link
                      href={row.href}
                      className="inline-flex min-h-11 items-center font-medium underline-offset-2 hover:underline md:min-h-0"
                    >
                      {row.title}
                    </Link>
                    {row.brand ? (
                      <span className="block text-[13px] text-fg-muted">{row.brand}</span>
                    ) : null}
                    <span className="block text-[13px] text-fg-muted md:hidden">
                      {row.variants} presentaci{row.variants === 1 ? "ón" : "ones"}
                    </span>
                  </span>
                </div>
              </TD>
              <TD className="whitespace-nowrap">{row.status}</TD>
              <TD className="whitespace-nowrap tabular-nums">
                {row.price}
                {row.quickPrices?.length ? (
                  <QuickPrices
                    storeHandle={storeHandle}
                    productId={row.id}
                    productTitle={row.title}
                    variants={row.quickPrices}
                  />
                ) : null}
              </TD>
              {rows.some((r) => r.stock !== null) ? (
                <TD className="whitespace-nowrap tabular-nums">
                  {row.stock ?? "—"}
                  {row.soldOut && row.stock !== "Agotado" ? (
                    <span className="block text-[13px] text-warning">
                      Alguna presentación agotada
                    </span>
                  ) : null}
                  {row.lowStock ? (
                    <span className="block text-[13px] text-warning">Pocas existencias</span>
                  ) : null}
                </TD>
              ) : null}
              <TD className="hidden md:table-cell">{row.variants}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
