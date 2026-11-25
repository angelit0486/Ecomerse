"use client";

import { useMemo, useState } from "react";

import {
  MAX_TIERS,
  rulesFromForm,
  promotionExample,
  type PromotionFormValues,
  type PromotionScope,
} from "@/lib/promotions/form";
import { describePromotion, type PromotionType } from "@/lib/promotions/rules";
import { Button } from "@/ui/primitives/button";
import { ConfirmButton } from "@/ui/primitives/confirm-button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";
import { useSafeActionState } from "@/ui/use-safe-action-state";

import type { FormState } from "../_shared/action-state";
import { FormFeedback } from "../_shared/form-feedback";
import { nativeControl } from "../productos/styles";
import { savePromotion, setPromotionStatus } from "./actions";

const TYPES: { value: PromotionType; title: string; hint: string }[] = [
  {
    value: "buy_n_pay_m",
    title: "Lleva N, paga M",
    hint: "Ejemplo: 3×2. El cliente lleva 3 piezas y paga 2; la de menor precio sale gratis.",
  },
  {
    value: "nth_percent",
    title: "Descuento en la N-ésima pieza",
    hint: "Ejemplo: la segunda al 50 %. El descuento cae en la pieza de menor precio.",
  },
  {
    value: "volume",
    title: "Mayoreo (precio por volumen)",
    hint: "Ejemplo: desde 5 piezas, $85 cada una. Aplica a cualquier cliente que lleve la cantidad.",
  },
];

const SCOPES: { value: PromotionScope; title: string; hint: string }[] = [
  { value: "store", title: "Toda la tienda", hint: "Cualquier producto cuenta." },
  {
    value: "categories",
    title: "Categorías",
    hint: "Los productos de esas categorías y de sus subcategorías.",
  },
  { value: "products", title: "Productos", hint: "Solo los productos que elijas." },
];

const fieldset = "space-y-3 rounded-md border border-border p-4";
const legend = "px-1 text-sm font-semibold";
const radioCard =
  "flex cursor-pointer gap-3 rounded-md border border-border p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/5";

export function PromotionForm({
  storeHandle,
  initial,
  currency,
  products,
  categories,
  productsTruncated,
}: {
  storeHandle: string;
  initial: PromotionFormValues;
  currency: string;
  products: { id: string; title: string }[];
  categories: { id: string; name: string; depth: number }[];
  productsTruncated: boolean;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    savePromotion.bind(null, storeHandle),
    {},
  );
  const [v, setV] = useState<PromotionFormValues>(initial);
  const set = <K extends keyof PromotionFormValues>(k: K, value: PromotionFormValues[K]) =>
    setV((prev) => ({ ...prev, [k]: value }));
  const err = (k: string) => state.fields?.[k];

  const preview = useMemo(() => {
    const r = rulesFromForm(v);
    if ("field" in r) return null;
    return {
      text: describePromotion(r.rules, currency),
      example: promotionExample(r.rules, currency),
    };
  }, [v, currency]);

  const tiers = v.tiers.length > 0 ? v.tiers : [{ qty: "", value: "" }];
  const setTier = (i: number, k: "qty" | "value", value: string) =>
    set(
      "tiers",
      tiers.map((t, j) => (j === i ? { ...t, [k]: value } : t)),
    );
  const p = v.id ? `pr-${v.id}` : "pr-new";

  return (
    <form action={action} className="space-y-5" noValidate>
      {v.id ? <input type="hidden" name="id" value={v.id} /> : null}

      <fieldset className={fieldset}>
        <legend className={legend}>Nombre</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Nombre interno"
            hint="Solo lo ves tú, en esta lista."
            id={`${p}-name`}
            required
            error={err("name")}
          >
            {(c) => (
              <Input
                {...c}
                name="name"
                value={v.name}
                maxLength={80}
                onChange={(e) => set("name", e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Leyenda para el cliente"
            hint="Corta y clara, por ejemplo «3×2 en playeras». Hasta 40 letras."
            id={`${p}-label`}
            required
            error={err("label")}
          >
            {(c) => (
              <Input
                {...c}
                name="label"
                value={v.label}
                maxLength={40}
                onChange={(e) => set("label", e.target.value)}
              />
            )}
          </Field>
        </div>
      </fieldset>

      <fieldset className={fieldset}>
        <legend className={legend}>Tipo de promoción</legend>
        <div className="grid gap-2 md:grid-cols-3">
          {TYPES.map((t) => (
            <label key={t.value} className={radioCard}>
              <input
                type="radio"
                name="type"
                value={t.value}
                checked={v.type === t.value}
                onChange={() => set("type", t.value)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">{t.title}</span>
                <span className="block text-fg-muted">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>

        {v.type === "buy_n_pay_m" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Lleva (piezas)" id={`${p}-buy`} error={err("buy")}>
              {(c) => (
                <Input
                  {...c}
                  name="buy"
                  inputMode="numeric"
                  value={v.buy}
                  onChange={(e) => set("buy", e.target.value)}
                />
              )}
            </Field>
            <Field label="Paga (piezas)" id={`${p}-pay`} error={err("pay")}>
              {(c) => (
                <Input
                  {...c}
                  name="pay"
                  inputMode="numeric"
                  value={v.pay}
                  onChange={(e) => set("pay", e.target.value)}
                />
              )}
            </Field>
          </div>
        ) : null}

        {v.type === "nth_percent" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="¿Qué pieza lleva descuento?"
              hint="2 = la segunda, 3 = la tercera…"
              id={`${p}-nth`}
              error={err("nth")}
            >
              {(c) => (
                <Input
                  {...c}
                  name="nth"
                  inputMode="numeric"
                  value={v.nth}
                  onChange={(e) => set("nth", e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Descuento (%)"
              hint="100 = gratis."
              id={`${p}-nth-percent`}
              error={err("nth_percent")}
            >
              {(c) => (
                <Input
                  {...c}
                  name="nth_percent"
                  inputMode="decimal"
                  value={v.nth_percent}
                  onChange={(e) => set("nth_percent", e.target.value)}
                />
              )}
            </Field>
          </div>
        ) : null}

        {v.type === "volume" ? (
          <div className="space-y-3">
            <Field label="¿Cómo baja el precio?" id={`${p}-mode`}>
              {(c) => (
                <select
                  {...c}
                  name="volume_mode"
                  value={v.volume_mode}
                  onChange={(e) => set("volume_mode", e.target.value as "unit_price" | "percent")}
                  className={nativeControl}
                >
                  <option value="unit_price">Precio por pieza</option>
                  <option value="percent">Porcentaje de descuento</option>
                </select>
              )}
            </Field>
            <p className="text-[13px] text-fg-muted">
              Las tallas, colores o sabores del mismo producto cuentan juntos. Hasta {MAX_TIERS}{" "}
              escalones; cada uno pide más piezas y da mejor precio que el anterior.
            </p>
            <ol className="space-y-2" aria-label="Escalones de mayoreo">
              {tiers.map((t, i) => (
                <li key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <Field label={`Escalón ${i + 1}: desde (piezas)`} id={`${p}-tq-${i}`}>
                    {(c) => (
                      <Input
                        {...c}
                        name={`tier_qty_${i}`}
                        inputMode="numeric"
                        value={t.qty}
                        onChange={(e) => setTier(i, "qty", e.target.value)}
                      />
                    )}
                  </Field>
                  <Field
                    label={
                      v.volume_mode === "unit_price"
                        ? `Escalón ${i + 1}: precio por pieza (${currency})`
                        : `Escalón ${i + 1}: descuento (%)`
                    }
                    id={`${p}-tv-${i}`}
                  >
                    {(c) => (
                      <Input
                        {...c}
                        name={`tier_value_${i}`}
                        inputMode="decimal"
                        value={t.value}
                        onChange={(e) => setTier(i, "value", e.target.value)}
                      />
                    )}
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={tiers.length === 1}
                    onClick={() =>
                      set(
                        "tiers",
                        tiers.filter((_, j) => j !== i),
                      )
                    }
                    aria-label={`Quitar escalón ${i + 1}`}
                  >
                    Quitar
                  </Button>
                </li>
              ))}
            </ol>
            {tiers.length < MAX_TIERS ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => set("tiers", [...tiers, { qty: "", value: "" }])}
              >
                Agregar escalón
              </Button>
            ) : null}
            {err("tiers") ? (
              <p role="alert" className="text-[13px] text-danger">
                {err("tiers")}
              </p>
            ) : null}
          </div>
        ) : null}

        <div aria-live="polite" className="rounded-md border border-border bg-canvas p-3 text-sm">
          {preview ? (
            <>
              <p className="font-medium">El cliente verá: {preview.text}</p>
              <p className="text-fg-muted">{preview.example.text}</p>
            </>
          ) : (
            <p className="text-fg-muted">Completa la regla para ver un ejemplo.</p>
          )}
        </div>
      </fieldset>

      <fieldset className={fieldset}>
        <legend className={legend}>¿A qué aplica?</legend>
        <div className="grid gap-2 md:grid-cols-3">
          {SCOPES.map((s) => (
            <label key={s.value} className={radioCard}>
              <input
                type="radio"
                name="scope"
                value={s.value}
                checked={v.scope === s.value}
                onChange={() => set("scope", s.value)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">{s.title}</span>
                <span className="block text-fg-muted">{s.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {v.scope === "products" ? (
          <ProductChooser
            id={`${p}-products`}
            products={products}
            truncated={productsTruncated}
            value={v.product_ids}
            onChange={(ids) => set("product_ids", ids)}
          />
        ) : null}
        {v.scope === "categories" ? (
          <fieldset className="space-y-1">
            <legend className="text-[13px] font-medium">
              Categorías elegidas ({v.category_ids.length})
            </legend>
            {categories.length === 0 ? (
              <p className="text-[13px] text-fg-muted">Tu tienda aún no tiene categorías.</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-auto rounded-md border border-border p-2">
                {categories.map((c) => (
                  <li key={c.id} style={{ paddingInlineStart: `${c.depth * 1}rem` }}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="category_ids"
                        value={c.id}
                        checked={v.category_ids.includes(c.id)}
                        onChange={(e) =>
                          set(
                            "category_ids",
                            e.target.checked
                              ? [...v.category_ids, c.id]
                              : v.category_ids.filter((x) => x !== c.id),
                          )
                        }
                      />
                      {c.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        ) : null}
        {err("targets") ? (
          <p role="alert" className="text-[13px] text-danger">
            {err("targets")}
          </p>
        ) : null}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="applies_to_sale_items"
            checked={v.applies_to_sale_items}
            onChange={(e) => set("applies_to_sale_items", e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="block font-medium">También en productos que ya están en oferta</span>
            <span className="block text-fg-muted">
              Si no lo marcas, los productos con «precio antes» no entran en esta promoción (así no
              se juntan dos descuentos).
            </span>
          </span>
        </label>
      </fieldset>

      <fieldset className={fieldset}>
        <legend className={legend}>Fechas (opcional)</legend>
        <p className="text-[13px] text-fg-muted">
          Sin fechas, la promoción corre mientras esté activa. Los días son de la zona horaria de tu
          tienda.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Desde" id={`${p}-start`} error={err("dates")}>
            {(c) => (
              <Input
                {...c}
                type="date"
                name="starts_at"
                value={v.starts_at}
                onChange={(e) => set("starts_at", e.target.value)}
              />
            )}
          </Field>
          <Field label="Hasta" id={`${p}-end`}>
            {(c) => (
              <Input
                {...c}
                type="date"
                name="ends_at"
                value={v.ends_at}
                onChange={(e) => set("ends_at", e.target.value)}
              />
            )}
          </Field>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          {v.id ? "Guardar cambios" : "Guardar como borrador"}
        </Button>
        {!v.id ? (
          <p className="text-[13px] text-fg-muted">
            Se guarda en borrador: revísala y actívala cuando quieras.
          </p>
        ) : null}
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

function ProductChooser({
  id,
  products,
  truncated,
  value,
  onChange,
}: {
  id: string;
  products: { id: string; title: string }[];
  truncated: boolean;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const byId = new Map(products.map((x) => [x.id, x]));
  const found = q
    ? products
        .filter((x) => !value.includes(x.id) && x.title.toLowerCase().includes(q))
        .slice(0, 20)
    : [];
  return (
    <fieldset className="space-y-2">
      <legend className="text-[13px] font-medium">Productos elegidos ({value.length})</legend>
      {value.length > 0 ? (
        <ul className="space-y-1">
          {value.map((pid) => (
            <li key={pid} className="flex items-center gap-2 text-sm">
              <input type="hidden" name="product_ids" value={pid} />
              <span className="mr-auto">{byId.get(pid)?.title ?? "Producto que ya no existe"}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(value.filter((x) => x !== pid))}
                aria-label={`Quitar ${byId.get(pid)?.title ?? "producto"}`}
              >
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <label htmlFor={`${id}-q`} className="block text-[13px] font-medium">
        Buscar un producto para agregar
      </label>
      <Input
        id={`${id}-q`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Escribe parte del nombre"
      />
      {truncated ? (
        <p className="text-[13px] text-fg-muted">
          Tu catálogo es grande: se buscan los primeros 2,000 productos por nombre. Para más, usa
          una categoría.
        </p>
      ) : null}
      {found.length > 0 ? (
        <ul className="space-y-1" aria-label="Resultados">
          {found.map((x) => (
            <li key={x.id}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  onChange([...value, x.id]);
                  setQuery("");
                }}
                aria-label={`Agregar ${x.title}`}
              >
                + {x.title}
              </Button>
            </li>
          ))}
        </ul>
      ) : q ? (
        <p className="text-[13px] text-fg-muted">Sin resultados.</p>
      ) : null}
    </fieldset>
  );
}

export function PromotionStatusButtons({
  storeHandle,
  id,
  status,
  name,
  from,
}: {
  storeHandle: string;
  id: string;
  status: string;
  name: string;
  from?: "detail";
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    setPromotionStatus.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {from ? <input type="hidden" name="from" value={from} /> : null}
      {status === "active" ? (
        <Button
          type="submit"
          name="status"
          value="paused"
          size="sm"
          variant="secondary"
          loading={pending}
          aria-label={`Pausar ${name}`}
        >
          Pausar
        </Button>
      ) : (
        <Button
          type="submit"
          name="status"
          value="active"
          size="sm"
          loading={pending}
          aria-label={`Activar ${name}`}
        >
          Activar
        </Button>
      )}
      <ConfirmButton
        name="status"
        value="archived"
        size="sm"
        disabled={pending}
        aria-label={`Archivar ${name}`}
        question={`¿Archivar la promoción «${name}»?`}
        detail="Deja de aplicarse y sale de la lista. Los pedidos que ya la usaron la conservan."
      >
        Archivar
      </ConfirmButton>
      <FormFeedback state={state} />
    </form>
  );
}
