"use client";

import { useActionState, useState } from "react";

import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import type { FormState } from "../_shared/action-state";
import { FormFeedback } from "../_shared/form-feedback";
import { submitKeepingState } from "../_shared/submit";
import { deleteAttribute, saveAttribute, saveProductAttributes } from "./attribute-actions";

export interface AttributeFormData {
  id: string;
  key: string;
  name: string;
  is_filterable: boolean;
  values: { id: string; label: string; products: number }[];
}

interface Row {
  id: string;
  label: string;
  products: number;
}

const EMPTY_ROW: Row = { id: "", label: "", products: 0 };

/**
 * Un atributo con su lista de valores (R-T04). Quitar un valor lo quita de sus
 * productos al guardar; la clave de la URL no cambia al renombrar.
 */
export function AttributeForm({
  storeHandle,
  attribute,
}: {
  storeHandle: string;
  attribute?: AttributeFormData;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveAttribute.bind(null, storeHandle),
    {},
  );
  // Controlados y sin reinicio automático (submitKeepingState): un error no borra lo elegido.
  const [filterable, setFilterable] = useState(attribute?.is_filterable ?? true);
  const [rows, setRows] = useState<Row[]>(
    attribute ? attribute.values.map((v) => ({ ...v })) : [{ ...EMPTY_ROW }, { ...EMPTY_ROW }],
  );
  const prefix = attribute ? `attr-${attribute.id}` : "attr-new";
  const title = attribute ? attribute.name : "Nuevo atributo";

  return (
    <form
      action={action}
      onSubmit={submitKeepingState(action)}
      aria-label={attribute ? `Atributo ${attribute.name}` : "Nuevo atributo"}
      className="space-y-4 rounded-md border border-border p-4"
      noValidate
    >
      {attribute ? <input type="hidden" name="id" value={attribute.id} /> : null}
      <input type="hidden" name="value_count" value={rows.length} />
      {attribute ? (
        // Valores que había al abrir: si otra persona agregó uno, guardar no lo borra.
        <input
          type="hidden"
          name="known_value_ids"
          value={attribute.values.map((v) => v.id).join(",")}
        />
      ) : null}
      <div className="flex flex-wrap items-end gap-4">
        <Field
          label={attribute ? `Nombre de ${title}` : "Nombre del atributo"}
          id={`${prefix}-name`}
          required
          error={state.fields?.name}
          hint={
            attribute
              ? `En la URL: ?${attribute.key}=…`
              : "Por ejemplo: Objetivo, Sabor o Presentación."
          }
        >
          {(c) => (
            <Input
              {...c}
              name="name"
              maxLength={60}
              defaultValue={state.values?.name ?? attribute?.name ?? ""}
            />
          )}
        </Field>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="is_filterable"
            value="1"
            checked={filterable}
            onChange={(e) => setFilterable(e.target.checked)}
          />
          Usar como filtro en la tienda
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium">Valores</legend>
        <ul className="space-y-2">
          {rows.map((row, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name={`value_id_${i}`} value={row.id} />
              <Input
                aria-label={`Valor ${i + 1} de ${title}`}
                name={`value_label_${i}`}
                maxLength={60}
                value={row.label}
                onChange={(e) =>
                  setRows((all) =>
                    all.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)),
                  )
                }
                className="max-w-xs"
              />
              {row.id ? (
                <span className="text-[13px] text-fg-muted">
                  {row.products === 1 ? "1 producto" : `${row.products} productos`}
                </span>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Quitar el valor ${i + 1} de ${title}`}
                onClick={() =>
                  setRows((all) =>
                    all.length === 1 ? [{ ...EMPTY_ROW }] : all.filter((_, j) => j !== i),
                  )
                }
              >
                Quitar
              </Button>
            </li>
          ))}
        </ul>
        {state.fields?.values ? (
          <p className="text-[13px] text-danger">{state.fields.values}</p>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          disabled={rows.length >= 50}
          onClick={() => setRows((all) => [...all, { ...EMPTY_ROW }])}
          aria-label={`Agregar un valor a ${title}`}
        >
          Agregar valor
        </Button>
        {attribute ? (
          <p className="text-[13px] text-fg-muted">
            Quitar un valor lo quita de sus productos al guardar.
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={attribute ? "secondary" : "primary"} loading={pending}>
          {attribute ? "Guardar" : "Crear atributo"}
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function DeleteAttributeForm({
  storeHandle,
  id,
  name,
  products,
}: {
  storeHandle: string;
  id: string;
  name: string;
  products: number;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    deleteAttribute.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="confirm" value="1" />
        {products > 0
          ? `Quitar «${name}» de ${products === 1 ? "1 producto" : `${products} productos`}`
          : `Eliminar «${name}»`}
      </label>
      <Button type="submit" variant="ghost" size="sm" loading={pending}>
        Eliminar atributo
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}

export interface ProductAttributeOption {
  id: string;
  name: string;
  values: { id: string; label: string }[];
}

/** Casillas de los atributos en el editor de producto (lista completa al guardar). */
export function ProductAttributesForm({
  storeHandle,
  productId,
  attributes,
  selected,
}: {
  storeHandle: string;
  productId: string;
  attributes: ProductAttributeOption[];
  selected: string[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveProductAttributes.bind(null, storeHandle, productId),
    {},
  );
  const [checked, setChecked] = useState<Set<string>>(() => new Set(selected));
  return (
    <section
      aria-labelledby="atributos-producto"
      className="space-y-4 rounded-md border border-border p-4"
    >
      <header className="space-y-1">
        <h2 id="atributos-producto" className="font-semibold">
          Atributos
        </h2>
        <p className="text-sm text-fg-muted">
          Con ellos se filtra en la tienda (por ejemplo, por objetivo o sabor).
        </p>
      </header>
      <form action={action} onSubmit={submitKeepingState(action)} className="space-y-4">
        {attributes.map((attribute) => (
          <fieldset key={attribute.id} className="space-y-1">
            <legend className="text-[13px] font-medium">{attribute.name}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {attribute.values.map((value) => (
                <label key={value.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="value"
                    value={value.id}
                    checked={checked.has(value.id)}
                    onChange={(e) =>
                      setChecked((all) => {
                        const next = new Set(all);
                        if (e.target.checked) next.add(value.id);
                        else next.delete(value.id);
                        return next;
                      })
                    }
                  />
                  {value.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="secondary" loading={pending}>
            Guardar atributos
          </Button>
          <FormFeedback state={state} />
        </div>
      </form>
    </section>
  );
}
