"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/ui/primitives/button";
import { Table, TBody, TD, TH, THead, TR } from "@/ui/primitives/table";

import { bulkProductsAction, type CatalogActionState } from "./actions";
import { QuickPrices, type QuickPriceVariant } from "./quick-prices";
import { nativeControl } from "./styles";

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
  /** null sin permiso de edición. */
  quickPrices: QuickPriceVariant[] | null;
}

const BULK_FORM = "bulk-products";

export function BulkProductsTable({
  storeHandle,
  rows,
  deletedView,
  canBulkStatus,
  canBulkDelete,
}: {
  storeHandle: string;
  rows: Row[];
  deletedView: boolean;
  canBulkStatus: boolean;
  canBulkDelete: boolean;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [state, action, pending] = useActionState<CatalogActionState, FormData>(
    async (previous: CatalogActionState, formData: FormData) => {
      const result = await bulkProductsAction(storeHandle, previous, formData);
      if (result.ok) setChosen(new Set());
      return result;
    },
    {},
  );
  // Solo cuenta lo que sigue en esta página (tras borrar, paginar o refrescar).
  const selected = new Set(rows.map((r) => r.id).filter((id) => chosen.has(id)));
  const setSelected = setChosen;
  const bulkEnabled = !deletedView && (canBulkStatus || canBulkDelete);
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
          action={action}
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
          <select id="bulk-action" name="action" defaultValue="" className={nativeControl}>
            <option value="" disabled>
              Acción…
            </option>
            {canBulkStatus ? <option value="publish">Publicar</option> : null}
            {canBulkStatus ? <option value="draft">Pausar (ocultar de la tienda)</option> : null}
            {canBulkStatus ? <option value="archive">Archivar</option> : null}
            {canBulkDelete ? <option value="delete">Eliminar</option> : null}
          </select>
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            loading={pending}
            disabled={selected.size === 0}
          >
            Aplicar
          </Button>
        </form>
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
            <TH>Variantes</TH>
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
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {row.title}
                    </Link>
                    {row.brand ? (
                      <span className="block text-[13px] text-fg-muted">{row.brand}</span>
                    ) : null}
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
                </TD>
              ) : null}
              <TD>{row.variants}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
