"use client";

import { Button } from "@/ui/primitives/button";
import { ConfirmButton } from "@/ui/primitives/confirm-button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import type { FormState } from "../../_shared/action-state";
import { FormFeedback } from "../../_shared/form-feedback";
import { nativeControl } from "../styles";
import {
  importSupplierCsv,
  saveSupplier,
  setSupplierVariant,
  unlinkSupplierVariant,
  type SupplierCsvState,
} from "./actions";
import { AVAILABILITY_LABELS } from "./labels";
import { useSafeActionState } from "@/ui/use-safe-action-state";

const area =
  "w-full rounded-[var(--radius-control)] border border-control bg-surface px-3 py-2 text-sm text-fg aria-[invalid=true]:border-danger";

export function SupplierForm({
  storeHandle,
  supplier,
}: {
  storeHandle: string;
  supplier?: {
    id: string;
    name: string;
    status: string;
    lead_time_min_days: number | null;
    lead_time_max_days: number | null;
    shipping_terms: string | null;
  };
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    saveSupplier.bind(null, storeHandle),
    {},
  );
  const v = (k: string, fallback: string) => state.values?.[k] ?? fallback;
  return (
    <form action={action} className="space-y-3 rounded-md border border-border p-4" noValidate>
      {supplier ? <input type="hidden" name="id" value={supplier.id} /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label="Nombre del proveedor"
          required
          error={state.fields?.name ?? state.fields?.code}
        >
          {(c) => (
            <Input
              {...c}
              name="name"
              maxLength={120}
              defaultValue={v("name", supplier?.name ?? "")}
            />
          )}
        </Field>
        {supplier ? (
          <Field label="Estado" error={state.fields?.status}>
            {(c) => (
              <select
                {...c}
                name="status"
                defaultValue={v("status", supplier.status)}
                className={nativeControl}
              >
                <option value="active">Activo: su disponibilidad se vende</option>
                <option value="inactive">Inactivo: no aporta disponibilidad</option>
              </select>
            )}
          </Field>
        ) : null}
        <Field
          label="Plazo de despacho mínimo (días)"
          hint="Lo que informa el proveedor; nunca se inventa."
          error={state.fields?.lead_time}
        >
          {(c) => (
            <Input
              {...c}
              name="lead_time_min_days"
              inputMode="numeric"
              defaultValue={v("lead_time_min_days", supplier?.lead_time_min_days?.toString() ?? "")}
            />
          )}
        </Field>
        <Field label="Plazo de despacho máximo (días)">
          {(c) => (
            <Input
              {...c}
              name="lead_time_max_days"
              inputMode="numeric"
              defaultValue={v("lead_time_max_days", supplier?.lead_time_max_days?.toString() ?? "")}
            />
          )}
        </Field>
      </div>
      <Field label="Condiciones de envío" error={state.fields?.shipping_terms}>
        {(c) => (
          <textarea
            {...c}
            name="shipping_terms"
            rows={2}
            maxLength={1000}
            defaultValue={v("shipping_terms", supplier?.shipping_terms ?? "")}
            className={area}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          {supplier ? "Guardar proveedor" : "Agregar proveedor"}
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function SupplierVariantForm({
  storeHandle,
  supplierId,
  initial,
}: {
  storeHandle: string;
  supplierId: string;
  initial?: {
    sku: string;
    supplier_sku: string;
    unit_cost: string;
    availability: string;
    quantity: string;
  };
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    setSupplierVariant.bind(null, storeHandle, supplierId),
    {},
  );
  const v = (k: keyof NonNullable<typeof initial>) => state.values?.[k] ?? initial?.[k] ?? "";
  return (
    <form action={action} className="space-y-3" noValidate>
      <div className="grid gap-3 md:grid-cols-5">
        <Field label="SKU de tu tienda" required error={state.fields?.sku}>
          {(c) =>
            initial ? (
              <>
                <input type="hidden" name="sku" value={initial.sku} />
                <Input {...c} value={initial.sku} readOnly />
              </>
            ) : (
              <Input {...c} name="sku" maxLength={64} defaultValue={v("sku")} />
            )
          }
        </Field>
        <Field label="SKU del proveedor" error={state.fields?.supplier_sku}>
          {(c) => (
            <Input {...c} name="supplier_sku" maxLength={100} defaultValue={v("supplier_sku")} />
          )}
        </Field>
        <Field label="Costo de adquisición" error={state.fields?.unit_cost}>
          {(c) => (
            <Input {...c} name="unit_cost" inputMode="decimal" defaultValue={v("unit_cost")} />
          )}
        </Field>
        <Field label="Disponibilidad informada" error={state.fields?.availability}>
          {(c) => (
            <select
              {...c}
              name="availability"
              defaultValue={v("availability") || "available"}
              className={nativeControl}
            >
              {Object.entries(AVAILABILITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label="Piezas informadas"
          hint="Para «Disponible» y «Pocas piezas»."
          error={state.fields?.quantity}
        >
          {(c) => <Input {...c} name="quantity" inputMode="numeric" defaultValue={v("quantity")} />}
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant={initial ? "secondary" : "primary"}
          size="sm"
          loading={pending}
        >
          {initial ? "Actualizar disponibilidad" : "Vincular variante"}
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function UnlinkVariantButton({
  storeHandle,
  supplierId,
  variantId,
  label,
}: {
  storeHandle: string;
  supplierId: string;
  variantId: string;
  label: string;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    unlinkSupplierVariant.bind(null, storeHandle, supplierId, variantId),
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <ConfirmButton
        size="sm"
        loading={pending}
        aria-label={`Desvincular ${label}`}
        question={`¿Desvincular «${label}» de este proveedor?`}
      >
        Desvincular
      </ConfirmButton>
      <FormFeedback state={state} />
    </form>
  );
}

/** Lista de disponibilidad del proveedor en CSV: todo o nada, con el error de cada fila. */
export function SupplierCsvForm({
  storeHandle,
  supplierId,
}: {
  storeHandle: string;
  supplierId: string;
}) {
  const [state, action, pending] = useSafeActionState<SupplierCsvState, FormData>(
    importSupplierCsv.bind(null, storeHandle, supplierId),
    {},
  );
  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-fg-muted">
        Columnas: <code>sku</code> (el de tu tienda), <code>disponibilidad</code> (disponible,
        limitado, no disponible o desconocido), <code>cantidad</code>, <code>sku_proveedor</code> y{" "}
        <code>costo</code>. Si una columna no viene, se conserva lo guardado. Si alguna fila tiene
        un problema no se aplica ningún cambio.
      </p>
      <Field label="Archivo CSV" required>
        {(c) => <Input {...c} name="file" type="file" accept=".csv,text/csv" required />}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" loading={pending}>
          Cargar disponibilidad
        </Button>
        <p role="status" className={state.error ? "text-sm text-danger" : "text-sm"}>
          {state.error ?? state.message ?? ""}
        </p>
      </div>
      {state.rowErrors && state.rowErrors.length > 0 ? (
        <ul aria-label="Problemas por fila" className="list-disc space-y-1 pl-5 text-sm">
          {state.rowErrors.map((e, i) => (
            <li key={`${e.row}-${i}`}>
              Fila {e.row}: {e.message}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
