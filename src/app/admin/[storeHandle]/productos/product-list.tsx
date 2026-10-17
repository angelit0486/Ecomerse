"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/ui/primitives/button";
import { Table, TBody, TD, TH, THead, TR } from "@/ui/primitives/table";

import { bulkProductsAction, type CatalogActionState } from "./actions";
import { nativeControl } from "./styles";

interface Row {
  id: string;
  title: string;
  href: string;
  status: string;
  price: string;
  variants: number;
}

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

  return (
    <form action={action} className="space-y-3">
      {bulkEnabled ? (
        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
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
            {canBulkStatus ? <option value="draft">Pasar a borrador</option> : null}
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
        </div>
      ) : null}
      {state.ok ? (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      ) : state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
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
                <Link href={row.href} className="font-medium underline-offset-2 hover:underline">
                  {row.title}
                </Link>
              </TD>
              <TD className="whitespace-nowrap">{row.status}</TD>
              <TD className="whitespace-nowrap tabular-nums">{row.price}</TD>
              <TD>{row.variants}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </form>
  );
}
