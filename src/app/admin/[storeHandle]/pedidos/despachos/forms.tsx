"use client";

import { useActionState } from "react";

import {
  nextSupplierOrderStatuses,
  SUPPLIER_ORDER_ACTIONS,
  type SupplierOrderStatus,
} from "@/lib/orders/supplier-order-status";
import { Button } from "@/ui/primitives/button";

import type { FormState } from "../../_shared/action-state";
import { FormFeedback } from "../../_shared/form-feedback";
import { setSupplierOrderStatus } from "./actions";

const inputClass =
  "h-9 rounded-[var(--radius-control)] border border-control bg-surface px-2 text-sm";

export interface SupplierOrderFormData {
  id: string;
  orderId: string;
  status: SupplierOrderStatus;
  external_reference: string | null;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  note: string | null;
}

/** Registrar el avance que hizo la dueña o informó el proveedor (adaptador manual). */
export function SupplierOrderForm({
  storeHandle,
  supplierOrder: so,
}: {
  storeHandle: string;
  supplierOrder: SupplierOrderFormData;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    setSupplierOrderStatus.bind(null, storeHandle, so.id, so.orderId),
    {},
  );
  const next = nextSupplierOrderStatuses(so.status);
  const v = (k: keyof SupplierOrderFormData) =>
    state.values?.[k] ?? (so[k] as string | null) ?? undefined;
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Referencia del proveedor (opcional)
          <input
            name="external_reference"
            maxLength={100}
            defaultValue={v("external_reference")}
            aria-invalid={state.fields?.external_reference ? true : undefined}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Paquetería del proveedor (opcional)
          <input name="carrier" maxLength={80} defaultValue={v("carrier")} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Guía del proveedor (opcional)
          <input
            name="tracking_number"
            maxLength={60}
            defaultValue={v("tracking_number")}
            aria-invalid={state.fields?.tracking_number ? true : undefined}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Rastreo del proveedor (opcional)
          <input
            name="tracking_url"
            type="url"
            maxLength={500}
            defaultValue={v("tracking_url")}
            aria-invalid={state.fields?.tracking_url ? true : undefined}
            className={inputClass}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Nota del despacho (opcional)
        <textarea
          name="note"
          maxLength={1000}
          rows={2}
          defaultValue={v("note")}
          className="rounded-[var(--radius-control)] border border-control bg-surface p-2 text-sm"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {next.length > 0 ? (
          next.map((s) => (
            <Button
              key={s}
              type="submit"
              name="status"
              value={s}
              size="sm"
              variant={s === next[0] ? "primary" : "secondary"}
              loading={pending}
            >
              {SUPPLIER_ORDER_ACTIONS[s]}
            </Button>
          ))
        ) : (
          <Button
            type="submit"
            name="status"
            value={so.status}
            size="sm"
            variant="secondary"
            loading={pending}
          >
            Guardar datos
          </Button>
        )}
        <FormFeedback state={state} />
      </div>
    </form>
  );
}
