"use client";

import { useActionState, useMemo, useState } from "react";

import {
  generateCombinations,
  MAX_OPTIONS,
  selectionLabel,
  signatureOf,
} from "@/lib/catalog/variants";
import { parseMoneyToCents } from "@/lib/money/format";
import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import { saveProduct, type CatalogActionState } from "./actions";
import type { EditorProduct } from "./editor-model";
import { nativeControl } from "./styles";

/**
 * Editor de producto (F3-T05): simple (una variante) o con hasta 3 opciones y
 * su tabla de combinaciones. Envía el producto completo como JSON a
 * catalog_upsert_product; la base valida todo de nuevo.
 */
type VariantDraft = EditorProduct["variants"][number];
interface OptionDraft {
  name: string;
  values: string;
}

const emptyVariant = (options: Record<string, string> = {}): VariantDraft => ({
  options,
  sku: "",
  barcode: "",
  price: "",
  compare_at_price: "",
  cost: "",
  active: true,
});

function splitValues(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}

/** Texto sin etiquetas → párrafos; con etiquetas se envía tal cual (se sanitiza en el servidor). */
function toHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || /<[a-z][\s\S]*>/i.test(trimmed)) return trimmed;
  return trimmed
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function ProductEditor({
  storeHandle,
  initial,
  brands,
  categories,
  canReadCost,
  currency,
}: {
  storeHandle: string;
  initial: EditorProduct;
  brands: { id: string; name: string }[];
  categories: { id: string; name: string; depth: number }[];
  canReadCost: boolean;
  currency: string;
}) {
  const [state, action, pending] = useActionState<CatalogActionState, FormData>(
    saveProduct.bind(null, storeHandle, initial.id),
    {},
  );
  const [title, setTitle] = useState(initial.title);
  const [slug, setSlug] = useState(initial.slug);
  const [description, setDescription] = useState(initial.description_html);
  const [brandId, setBrandId] = useState(initial.brand_id);
  const [tags, setTags] = useState(initial.tags);
  const [seoTitle, setSeoTitle] = useState(initial.seo_title);
  const [seoDescription, setSeoDescription] = useState(initial.seo_description);
  const [productCategories, setProductCategories] = useState(initial.categories);
  const [options, setOptions] = useState<OptionDraft[]>(
    initial.options.map((o) => ({ name: o.name, values: o.values.join(", ") })),
  );
  const [variants, setVariants] = useState<Record<string, VariantDraft>>(() => {
    const parsed = initial.options.map((o) => ({ name: o.name, values: o.values }));
    return Object.fromEntries(initial.variants.map((v) => [signatureOf(parsed, v.options), v]));
  });

  const parsedOptions = useMemo(
    () =>
      options
        .map((o) => ({ name: o.name.trim(), values: splitValues(o.values) }))
        .filter((o) => o.name),
    [options],
  );
  const combinations = useMemo(
    () => (parsedOptions.length === 0 ? [{}] : generateCombinations(parsedOptions)),
    [parsedOptions],
  );
  const rows = combinations.map((combo) => {
    const signature = signatureOf(parsedOptions, combo);
    return { signature, combo, draft: variants[signature] ?? emptyVariant(combo) };
  });

  function updateVariant(
    signature: string,
    combo: Record<string, string>,
    patch: Partial<VariantDraft>,
  ) {
    setVariants((current) => ({
      ...current,
      [signature]: { ...(current[signature] ?? emptyVariant(combo)), ...patch, options: combo },
    }));
  }

  function applyToAll(field: "price" | "compare_at_price" | "cost", value: string) {
    setVariants((current) => {
      const next = { ...current };
      for (const row of rows)
        next[row.signature] = { ...row.draft, [field]: value, options: row.combo };
      return next;
    });
  }

  const [clientError, setClientError] = useState<string | null>(null);
  const fieldError = (key: string) => state.fields?.[key];

  function buildPayload(): { ok: true; json: string } | { ok: false; error: string } {
    const payloadVariants = [];
    for (const [index, row] of rows.entries()) {
      const price = parseMoneyToCents(row.draft.price);
      const compare = row.draft.compare_at_price.trim()
        ? parseMoneyToCents(row.draft.compare_at_price)
        : null;
      const cost = row.draft.cost.trim() ? parseMoneyToCents(row.draft.cost) : null;
      const label = selectionLabel(parsedOptions, row.combo) || "el producto";
      if (price === null)
        return { ok: false, error: `Escribe un precio válido para ${label} (por ejemplo 199.00).` };
      if (row.draft.compare_at_price.trim() && compare === null)
        return { ok: false, error: `Precio de comparación no válido en ${label}.` };
      if (row.draft.cost.trim() && cost === null)
        return { ok: false, error: `Costo no válido en ${label}.` };
      payloadVariants.push({
        ...(row.draft.id ? { id: row.draft.id } : {}),
        options: row.combo,
        sku: row.draft.sku.trim() || null,
        barcode: row.draft.barcode.trim() || null,
        price,
        compare_at_price: compare,
        ...(canReadCost ? { cost } : {}),
        status: row.draft.active ? "active" : "inactive",
        position: index,
      });
    }
    const json = JSON.stringify({
      title,
      slug: slug.trim() || undefined,
      description_html: toHtml(description) || null,
      brand_id: brandId || null,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      seo_title: seoTitle.trim() || null,
      seo_description: seoDescription.trim() || null,
      options: parsedOptions,
      variants: payloadVariants,
      categories: productCategories,
    });
    return { ok: true, json };
  }

  const [payload, setPayload] = useState("");

  return (
    <form
      action={action}
      onSubmit={(event) => {
        const built = buildPayload();
        if (!built.ok) {
          event.preventDefault();
          setClientError(built.error);
          return;
        }
        setClientError(null);
        setPayload(built.json);
        // El input oculto debe llevar el JSON antes de que React lea el FormData.
        const hidden = event.currentTarget.elements.namedItem("payload") as HTMLInputElement;
        hidden.value = built.json;
      }}
      className="space-y-8"
      noValidate
    >
      <input type="hidden" name="payload" value={payload} readOnly />

      <div aria-live="polite">
        {state.ok ? (
          <p role="status" className="text-sm text-success">
            {state.message}
          </p>
        ) : null}
        {clientError || state.error ? (
          <div
            role="alert"
            className="rounded-md border border-danger px-3 py-2 text-sm text-danger"
          >
            <p>{clientError ?? state.error}</p>
            {!clientError && state.fields ? (
              <ul className="mt-1 list-disc pl-5">
                {Object.entries(state.fields)
                  .filter(([key]) => !["title", "slug"].includes(key))
                  .map(([key, message]) => (
                    <li key={key}>{message}</li>
                  ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <fieldset className="grid max-w-2xl gap-4">
        <legend className="mb-2 text-base font-semibold">Información</legend>
        <Field label="Título" required error={fieldError("title")}>
          {(c) => (
            <Input
              {...c}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          )}
        </Field>
        <Field
          label="Dirección (slug)"
          hint="Se genera del título si la dejas vacía. Solo minúsculas, números y guiones."
          error={fieldError("slug")}
        >
          {(c) => (
            <Input {...c} value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={120} />
          )}
        </Field>
        <Field
          label="Descripción"
          hint="Texto libre; separa párrafos con una línea en blanco. Se permite formato básico (negritas, listas, enlaces)."
          error={fieldError("description_html")}
        >
          {(c) => (
            <textarea
              {...c}
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded-[var(--radius-control)] border border-control bg-surface p-3 text-sm"
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Marca" error={fieldError("brand_id")}>
            {(c) => (
              <select
                {...c}
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
                className={nativeControl}
              >
                <option value="">Sin marca</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Etiquetas" hint="Separadas por comas." error={fieldError("tags")}>
            {(c) => <Input {...c} value={tags} onChange={(e) => setTags(e.target.value)} />}
          </Field>
        </div>
      </fieldset>

      {categories.length > 0 ? (
        <fieldset className="max-w-2xl space-y-2">
          <legend className="mb-2 text-base font-semibold">Categorías</legend>
          <ul className="space-y-1">
            {categories.map((cat) => {
              const current = productCategories.find((c) => c.id === cat.id);
              return (
                <li key={cat.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-2" data-depth={cat.depth}>
                    <input
                      type="checkbox"
                      checked={Boolean(current)}
                      onChange={(e) =>
                        setProductCategories((list) =>
                          e.target.checked
                            ? [...list, { id: cat.id, is_primary: list.length === 0 }]
                            : list.filter((c) => c.id !== cat.id),
                        )
                      }
                    />
                    {"— ".repeat(cat.depth)}
                    {cat.name}
                  </label>
                  {current ? (
                    <label className="flex items-center gap-1 text-fg-muted">
                      <input
                        type="radio"
                        name="primary_category"
                        checked={current.is_primary}
                        onChange={() =>
                          setProductCategories((list) =>
                            list.map((c) => ({ ...c, is_primary: c.id === cat.id })),
                          )
                        }
                      />
                      Principal
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}

      <fieldset className="space-y-4">
        <legend className="mb-2 text-base font-semibold">Opciones y variantes</legend>
        <p className="max-w-prose text-sm text-fg-muted">
          Sin opciones, el producto tiene una sola variante. Con opciones (por ejemplo Color y
          Talla) se crea una variante por combinación; máximo {MAX_OPTIONS} opciones.
        </p>
        {options.map((option, index) => (
          <div
            key={index}
            className="grid max-w-2xl gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
          >
            <Field label={`Opción ${index + 1}`}>
              {(c) => (
                <Input
                  {...c}
                  value={option.name}
                  placeholder="Color"
                  maxLength={60}
                  onChange={(e) =>
                    setOptions((list) =>
                      list.map((o, i) => (i === index ? { ...o, name: e.target.value } : o)),
                    )
                  }
                />
              )}
            </Field>
            <Field label={`Valores de la opción ${index + 1}`} hint="Separados por comas.">
              {(c) => (
                <Input
                  {...c}
                  value={option.values}
                  placeholder="Negro, Blanco"
                  onChange={(e) =>
                    setOptions((list) =>
                      list.map((o, i) => (i === index ? { ...o, values: e.target.value } : o)),
                    )
                  }
                />
              )}
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOptions((list) => list.filter((_, i) => i !== index))}
            >
              Quitar opción {index + 1}
            </Button>
          </div>
        ))}
        {options.length < MAX_OPTIONS ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setOptions((l) => [...l, { name: "", values: "" }])}
          >
            Agregar opción
          </Button>
        ) : null}

        <div className="flex flex-wrap items-end gap-3">
          <p className="text-sm font-medium" aria-live="polite">
            {rows.length === 1 && parsedOptions.length === 0
              ? "Una variante"
              : `${rows.length} variantes`}
          </p>
          {rows.length > 1 ? (
            <ApplyToAll currency={currency} onApply={applyToAll} canReadCost={canReadCost} />
          ) : null}
        </div>

        <div className="overflow-x-auto rounded-[var(--radius-container)] border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Variantes</caption>
            <thead className="bg-canvas">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Variante
                </th>
                <th scope="col" className="px-3 py-2">
                  Precio ({currency})
                </th>
                <th scope="col" className="px-3 py-2">
                  Precio antes
                </th>
                {canReadCost ? (
                  <th scope="col" className="px-3 py-2">
                    Costo
                  </th>
                ) : null}
                <th scope="col" className="px-3 py-2">
                  SKU
                </th>
                <th scope="col" className="px-3 py-2">
                  Activa
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ signature, combo, draft }, index) => {
                const label = selectionLabel(parsedOptions, combo) || "Única";
                const priceError = fieldError(`variants.${index}.price`);
                const compareError = fieldError(`variants.${index}.compare_at_price`);
                return (
                  <tr key={signature || "single"} className="border-t border-border">
                    <th scope="row" className="px-3 py-2 font-medium">
                      {label}
                    </th>
                    <td className="px-3 py-2">
                      <Input
                        aria-label={`Precio de ${label}`}
                        inputMode="decimal"
                        value={draft.price}
                        aria-invalid={priceError ? true : undefined}
                        onChange={(e) => updateVariant(signature, combo, { price: e.target.value })}
                        className="w-28"
                      />
                      {priceError ? (
                        <span className="block text-[13px] text-danger">{priceError}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        aria-label={`Precio antes de ${label}`}
                        inputMode="decimal"
                        value={draft.compare_at_price}
                        aria-invalid={compareError ? true : undefined}
                        onChange={(e) =>
                          updateVariant(signature, combo, { compare_at_price: e.target.value })
                        }
                        className="w-28"
                      />
                      {compareError ? (
                        <span className="block text-[13px] text-danger">{compareError}</span>
                      ) : null}
                    </td>
                    {canReadCost ? (
                      <td className="px-3 py-2">
                        <Input
                          aria-label={`Costo de ${label}`}
                          inputMode="decimal"
                          value={draft.cost}
                          onChange={(e) =>
                            updateVariant(signature, combo, { cost: e.target.value })
                          }
                          className="w-28"
                        />
                      </td>
                    ) : null}
                    <td className="px-3 py-2">
                      <Input
                        aria-label={`SKU de ${label}`}
                        value={draft.sku}
                        maxLength={64}
                        onChange={(e) => updateVariant(signature, combo, { sku: e.target.value })}
                        className="w-32"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`${label} activa`}
                        checked={draft.active}
                        onChange={(e) =>
                          updateVariant(signature, combo, { active: e.target.checked })
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </fieldset>

      <fieldset className="grid max-w-2xl gap-4">
        <legend className="mb-2 text-base font-semibold">Buscadores (SEO)</legend>
        <Field
          label="Título para buscadores"
          hint="Máximo 70 caracteres."
          error={fieldError("seo_title")}
        >
          {(c) => (
            <Input
              {...c}
              value={seoTitle}
              maxLength={70}
              onChange={(e) => setSeoTitle(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Descripción para buscadores"
          hint="Máximo 320 caracteres."
          error={fieldError("seo_description")}
        >
          {(c) => (
            <textarea
              {...c}
              rows={3}
              maxLength={320}
              value={seoDescription}
              onChange={(e) => setSeoDescription(e.target.value)}
              className="rounded-[var(--radius-control)] border border-control bg-surface p-3 text-sm"
            />
          )}
        </Field>
      </fieldset>

      <div className="flex gap-3">
        <Button type="submit" loading={pending}>
          {initial.id ? "Guardar cambios" : "Crear producto"}
        </Button>
      </div>
    </form>
  );
}

function ApplyToAll({
  currency,
  canReadCost,
  onApply,
}: {
  currency: string;
  canReadCost: boolean;
  onApply: (field: "price" | "compare_at_price" | "cost", value: string) => void;
}) {
  const [value, setValue] = useState("");
  const [field, setField] = useState<"price" | "compare_at_price" | "cost">("price");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-[13px] font-medium">
        Aplicar a todas
        <select
          value={field}
          onChange={(e) => setField(e.target.value as typeof field)}
          className={nativeControl}
        >
          <option value="price">Precio</option>
          <option value="compare_at_price">Precio antes</option>
          {canReadCost ? <option value="cost">Costo</option> : null}
        </select>
      </label>
      <Input
        aria-label={`Valor a aplicar (${currency})`}
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-28"
      />
      <Button type="button" variant="secondary" size="sm" onClick={() => onApply(field, value)}>
        Aplicar
      </Button>
    </div>
  );
}
