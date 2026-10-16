"use client";

import { useActionState, useState } from "react";

import { PLACEMENT_LABELS, SUPPLEMENT_FIELD_LABELS } from "@/lib/compliance/labels";
import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import type { FormState } from "../_shared/action-state";
import { FormFeedback } from "../_shared/form-feedback";
import { saveRegulatoryInfo } from "./regulatory-actions";

export interface RegulatoryCategoryOption {
  key: string;
  name: string;
  profileStatus: "pending" | "active" | "suspended";
  requiredFields: string[];
  legends: Array<{ key: string; label: string; text: string; placements: string[] }>;
}

export interface NutritionRowValue {
  name: string;
  amount: string;
  unit: string;
  dv: string;
}

export interface RegulatoryInitial {
  /** undefined: aún sin clasificar; "none": no regulado. */
  classification: string | undefined;
  data: Record<string, string>;
  nutrition: NutritionRowValue[];
}

const LONG_FIELDS = ["ingredients", "usage", "warnings", "storage", "allergens"] as const;
const SHORT_FIELDS = ["form", "net_content", "serving_size", "sanitary_notice"] as const;
const LIMITS: Record<string, number> = {
  form: 100,
  net_content: 100,
  serving_size: 100,
  ingredients: 5000,
  usage: 2000,
  warnings: 3000,
  storage: 1000,
  allergens: 1000,
  sanitary_notice: 300,
};
const EMPTY_ROW: NutritionRowValue = { name: "", amount: "", unit: "", dv: "" };
const textarea =
  "w-full rounded-[var(--radius-control)] border border-control bg-surface px-3 py-2 text-sm text-fg aria-[invalid=true]:border-danger";

/**
 * Ficha sanitaria del producto (R-T02, ADR-021). Todo el contenido lo escribe la
 * tienda; las leyendas vienen de las reglas de la plataforma y aquí solo se
 * muestran. La base valida otra vez al guardar y al publicar.
 */
export function RegulatoryForm({
  storeHandle,
  productId,
  categories,
  initial,
}: {
  storeHandle: string;
  productId: string;
  categories: RegulatoryCategoryOption[];
  initial: RegulatoryInitial;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveRegulatoryInfo.bind(null, storeHandle, productId),
    {},
  );
  const [classification, setClassification] = useState(initial.classification ?? "");
  const [rows, setRows] = useState<NutritionRowValue[]>(
    initial.nutrition.length > 0 ? initial.nutrition : [{ ...EMPTY_ROW }],
  );
  const category = categories.find((c) => c.key === classification);
  const value = (key: string) => state.values?.[key] ?? initial.data[key] ?? "";
  const required = (key: string) => category?.requiredFields.includes(key) ?? false;

  return (
    <section
      aria-labelledby="ficha-sanitaria"
      className="space-y-4 rounded-md border border-border p-4"
    >
      <header className="space-y-1">
        <h2 id="ficha-sanitaria" className="font-semibold">
          Ficha sanitaria
        </h2>
        <p className="text-sm text-fg-muted">
          Tu tienda declaró productos regulados: cada producto necesita su clasificación para
          publicarse. Escribe los datos tal como aparecen en la etiqueta del producto.
        </p>
      </header>

      <form action={action} className="space-y-4" noValidate>
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium">Clasificación</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="classification"
              value="none"
              checked={classification === "none"}
              onChange={() => setClassification("none")}
            />
            Producto no regulado
          </label>
          {categories.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="classification"
                value={c.key}
                checked={classification === c.key}
                onChange={() => setClassification(c.key)}
              />
              {c.name}
            </label>
          ))}
          {state.fields?.classification ? (
            <p className="text-[13px] text-danger">Elige una clasificación.</p>
          ) : null}
        </fieldset>

        {category ? (
          <>
            {category.profileStatus !== "active" ? (
              <p role="status" className="rounded-md border border-warning p-3 text-sm">
                Las reglas de esta categoría aún no están revisadas por la plataforma: puedes
                guardar la ficha, pero no publicar el producto todavía.
              </p>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              {SHORT_FIELDS.map((key) => (
                <Field
                  key={key}
                  label={SUPPLEMENT_FIELD_LABELS[key]!}
                  required={required(key)}
                  error={state.fields?.[key]}
                >
                  {(c) => (
                    <Input {...c} name={key} maxLength={LIMITS[key]} defaultValue={value(key)} />
                  )}
                </Field>
              ))}
              <Field
                label={SUPPLEMENT_FIELD_LABELS.servings_per_container!}
                required={required("servings_per_container")}
                error={state.fields?.servings_per_container}
              >
                {(c) => (
                  <Input
                    {...c}
                    name="servings_per_container"
                    inputMode="numeric"
                    defaultValue={value("servings_per_container")}
                  />
                )}
              </Field>
            </div>

            {LONG_FIELDS.map((key) => (
              <Field
                key={key}
                label={SUPPLEMENT_FIELD_LABELS[key]!}
                required={required(key)}
                error={state.fields?.[key]}
              >
                {(c) => (
                  <textarea
                    {...c}
                    name={key}
                    rows={key === "ingredients" || key === "warnings" ? 4 : 3}
                    maxLength={LIMITS[key]}
                    defaultValue={value(key)}
                    className={textarea}
                  />
                )}
              </Field>
            ))}

            <fieldset className="space-y-2">
              <legend className="text-[13px] font-medium">
                {SUPPLEMENT_FIELD_LABELS.nutrition}
                {required("nutrition") ? <span className="text-danger"> *</span> : null}
              </legend>
              <input type="hidden" name="nutrition_rows" value={rows.length} />
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-[13px] text-fg-muted">
                    <tr>
                      <th scope="col" className="py-1 pr-2 font-medium">
                        Nutrimento
                      </th>
                      <th scope="col" className="py-1 pr-2 font-medium">
                        Cantidad
                      </th>
                      <th scope="col" className="py-1 pr-2 font-medium">
                        Unidad
                      </th>
                      <th scope="col" className="py-1 pr-2 font-medium">
                        %VNR
                      </th>
                      <th scope="col" className="py-1 font-medium">
                        <span className="sr-only">Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i}>
                        {(["name", "amount", "unit", "dv"] as const).map((cell) => (
                          <td key={cell} className="py-1 pr-2">
                            <Input
                              aria-label={`${{ name: "Nutrimento", amount: "Cantidad", unit: "Unidad", dv: "%VNR" }[cell]} del renglón ${i + 1}`}
                              name={`nutrition_${cell}_${i}`}
                              maxLength={{ name: 100, amount: 30, unit: 20, dv: 10 }[cell]}
                              value={row[cell]}
                              onChange={(e) =>
                                setRows((all) =>
                                  all.map((r, j) =>
                                    j === i ? { ...r, [cell]: e.target.value } : r,
                                  ),
                                )
                              }
                            />
                          </td>
                        ))}
                        <td className="py-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Quitar el renglón ${i + 1}`}
                            onClick={() =>
                              setRows((all) =>
                                all.length === 1
                                  ? [{ ...EMPTY_ROW }]
                                  : all.filter((_, j) => j !== i),
                              )
                            }
                          >
                            Quitar
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {state.fields?.nutrition ? (
                <p className="text-[13px] text-danger">{state.fields.nutrition}</p>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                disabled={rows.length >= 60}
                onClick={() => setRows((all) => [...all, { ...EMPTY_ROW }])}
              >
                Agregar renglón
              </Button>
            </fieldset>

            <div className="space-y-2">
              <h3 className="text-[13px] font-medium">
                Leyendas que se mostrarán con este producto
              </h3>
              {category.legends.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  Las reglas de esta categoría todavía no tienen leyendas.
                </p>
              ) : (
                <ul className="space-y-2">
                  {category.legends.map((legend) => (
                    <li key={legend.key} className="rounded-md bg-canvas p-3 text-sm">
                      <p className="whitespace-pre-line">{legend.text}</p>
                      <p className="mt-1 text-[13px] text-fg-muted">
                        {legend.label} · En:{" "}
                        {legend.placements.map((p) => PLACEMENT_LABELS[p] ?? p).join(", ")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={pending}>
            Guardar ficha sanitaria
          </Button>
          <FormFeedback state={state} />
        </div>
      </form>
    </section>
  );
}
