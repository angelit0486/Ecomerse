"use client";

import { startTransition, useActionState } from "react";

import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";

import { quickPricesAction, type CatalogActionState } from "./actions";

export interface QuickPriceVariant {
  id: string;
  label: string;
  /** Importes como se escriben en el formulario («699.00»). */
  price: string;
  compare: string;
}

/**
 * Cambio rápido de precios desde el listado, sin abrir el producto. El servidor
 * es la autoridad: valida, recalcula el rango y audita (§44.8).
 */
export function QuickPrices({
  storeHandle,
  productId,
  productTitle,
  variants,
}: {
  storeHandle: string;
  productId: string;
  productTitle: string;
  variants: QuickPriceVariant[];
}) {
  const [state, action, pending] = useActionState<CatalogActionState, FormData>(
    quickPricesAction.bind(null, storeHandle, productId),
    {},
  );
  const fieldError = (key: string) => state.fields?.[key];
  const otherErrors = Object.entries(state.fields ?? {})
    .filter(([key]) => !key.startsWith("price_") && !key.startsWith("compare_"))
    .map(([, message]) => message);

  return (
    <details className="mt-1 text-sm">
      <summary className="cursor-pointer min-h-11 py-3 md:min-h-0 md:py-0 text-[13px] text-fg-muted underline underline-offset-2">
        Cambiar precios
        <span className="sr-only"> de {productTitle}</span>
      </summary>
      {/* onSubmit en lugar de action: React reinicia los campos tras cada acción y,
          si un precio no es válido, se perdería lo escrito. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startTransition(() => action(data));
        }}
        className="mt-2 grid gap-2"
        aria-label={`Precios de ${productTitle}`}
      >
        {variants.map((v) => (
          <fieldset key={v.id} className="grid gap-1">
            <legend className="text-[13px] font-medium">{v.label}</legend>
            <input type="hidden" name="variant_id" value={v.id} />
            <div className="flex gap-2">
              <label className="grid gap-0.5 text-[12px]">
                Precio
                <Input
                  name={`price_${v.id}`}
                  defaultValue={v.price}
                  inputMode="decimal"
                  aria-label={`Precio de ${v.label}`}
                  aria-invalid={fieldError(`price_${v.id}`) ? true : undefined}
                  className="w-28"
                />
              </label>
              <label className="grid gap-0.5 text-[12px]">
                Precio antes
                <Input
                  name={`compare_${v.id}`}
                  defaultValue={v.compare}
                  inputMode="decimal"
                  placeholder="Opcional"
                  aria-label={`Precio antes de ${v.label}`}
                  aria-invalid={fieldError(`compare_${v.id}`) ? true : undefined}
                  className="w-28"
                />
              </label>
            </div>
            {(fieldError(`price_${v.id}`) ?? fieldError(`compare_${v.id}`)) ? (
              <p className="text-[12px] text-danger">
                {fieldError(`price_${v.id}`) ?? fieldError(`compare_${v.id}`)}
              </p>
            ) : null}
          </fieldset>
        ))}
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" variant="secondary" loading={pending}>
            Guardar precios
          </Button>
          <span aria-live="polite">
            {state.error ? (
              <span role="alert" className="text-[13px] text-danger">
                {state.error}
                {otherErrors.length ? ` ${otherErrors.join(" ")}` : ""}
              </span>
            ) : state.ok ? (
              <span role="status" className="text-[13px] text-success">
                {state.message}
              </span>
            ) : null}
          </span>
        </div>
      </form>
    </details>
  );
}
