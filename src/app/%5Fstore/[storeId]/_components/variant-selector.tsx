"use client";

import { useMemo, useState } from "react";

import { AddToCart } from "./add-to-cart";

/**
 * Selector de variantes (isla cliente, §21.4): un grupo de botones de opción por
 * opción del producto; muestra precio, disponibilidad e imagen de la
 * combinación elegida. Sin JavaScript se ven todas las variantes en la tabla
 * de respaldo de la ficha.
 */
export interface SelectorVariant {
  id: string;
  options: Record<string, string>;
  price: string;
  compareAt: string | null;
  availability: string;
  available: boolean;
  imageUrl: string | null;
}

export function VariantSelector({
  storeId,
  options,
  variants,
}: {
  storeId: string;
  options: { name: string; values: string[] }[];
  variants: SelectorVariant[];
}) {
  const initial = variants.find((v) => v.available) ?? variants[0];
  const [selection, setSelection] = useState<Record<string, string>>(initial?.options ?? {});
  const selected = useMemo(
    () =>
      variants.find((v) => options.every((o) => v.options[o.name] === selection[o.name])) ?? null,
    [variants, options, selection],
  );

  /** ¿Existe alguna variante con este valor y el resto de la selección actual? */
  function exists(option: string, value: string) {
    return variants.some(
      (v) =>
        v.options[option] === value &&
        options.every((o) => o.name === option || v.options[o.name] === selection[o.name]),
    );
  }

  return (
    <div className="space-y-5">
      {options.map((option) => (
        <fieldset key={option.name} className="space-y-2">
          <legend className="text-sm font-medium">
            {option.name}:{" "}
            <span className="font-normal">{selection[option.name] ?? "elige una opción"}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {option.values.map((value) => {
              const id = `opt-${option.name}-${value}`.replace(/[^a-zA-Z0-9-]/g, "_");
              const disabled = !exists(option.name, value);
              return (
                <span key={value}>
                  <input
                    type="radio"
                    id={id}
                    name={option.name}
                    value={value}
                    checked={selection[option.name] === value}
                    disabled={disabled}
                    onChange={() => setSelection((s) => ({ ...s, [option.name]: value }))}
                    className="peer sr-only"
                  />
                  <label
                    htmlFor={id}
                    className="inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] px-3 text-sm peer-checked:border-[var(--sf-fg)] peer-checked:bg-[var(--sf-fg)] peer-checked:text-[var(--sf-bg)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--sf-primary)] peer-disabled:cursor-not-allowed peer-disabled:line-through peer-disabled:opacity-50"
                  >
                    {value}
                  </label>
                </span>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div aria-live="polite" className="space-y-1">
        {selected ? (
          <>
            <p className="text-xl font-semibold">
              {selected.price}
              {selected.compareAt ? (
                <s className="ml-3 text-base font-normal text-[var(--sf-muted)]">
                  <span className="sr-only">Antes </span>
                  {selected.compareAt}
                </s>
              ) : null}
            </p>
            <p className="text-sm">{selected.availability}</p>
            {selected.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- imagen de la variante, re-codificada
              <img src={selected.imageUrl} alt="" className="mt-2 h-24 w-24 rounded object-cover" />
            ) : null}
          </>
        ) : (
          <p className="text-sm text-[var(--sf-muted)]">Esta combinación no está disponible.</p>
        )}
      </div>
      <AddToCart
        storeId={storeId}
        variantId={selected?.id ?? null}
        available={Boolean(selected?.available)}
      />
    </div>
  );
}
