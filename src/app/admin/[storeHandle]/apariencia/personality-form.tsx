"use client";

import { useState } from "react";

import { PERSONALITY_OPTIONS, type Personality, type PersonalityKey } from "@/lib/theme/constants";
import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Select } from "@/ui/primitives/select";
import { submitKeepingState } from "@/ui/submit";
import { useSafeActionState } from "@/ui/use-safe-action-state";

import type { FormState } from "../_shared/action-state";
import { FormFeedback } from "../_shared/form-feedback";
import { saveThemeSection } from "./actions";

/** Cada opción en palabras de la dueña; la primera es como se ve hoy. */
const FIELDS: ReadonlyArray<{
  key: PersonalityKey;
  label: string;
  hint?: string;
  options: Record<string, string>;
}> = [
  {
    key: "card_style",
    label: "Estilo de las tarjetas de producto",
    options: {
      outlined: "Con borde (como hoy)",
      flat: "Planas, sin borde: la foto manda",
      raised: "Elevadas, con sombra",
    },
  },
  {
    key: "image_ratio",
    label: "Forma de la foto",
    hint: "Vertical luce mejor en ropa, joyería y belleza.",
    options: {
      "1:1": "Cuadrada (como hoy)",
      "4:5": "Vertical 4:5",
      "3:4": "Vertical 3:4, más alta",
    },
  },
  {
    key: "image_fit",
    label: "Cómo llena la foto su espacio",
    hint: "«Llenar» recorta los bordes: úsalo con fotos de ambiente, no con fondo blanco.",
    options: { contain: "Completa, con margen (como hoy)", cover: "Llenar todo el espacio" },
  },
  {
    key: "card_hover",
    label: "Al pasar el cursor sobre una tarjeta",
    options: { zoom: "Acerca la foto (como hoy)", lift: "La tarjeta se eleva", none: "Sin efecto" },
  },
  {
    key: "card_align",
    label: "Texto de la tarjeta",
    options: { start: "A la izquierda (como hoy)", center: "Centrado" },
  },
  {
    key: "heading_case",
    label: "Mayúsculas en los títulos",
    options: { normal: "Como los escribes (como hoy)", uppercase: "Todo en mayúsculas" },
  },
  {
    key: "heading_tracking",
    label: "Espacio entre letras de los títulos",
    options: {
      normal: "Normal (como hoy)",
      tight: "Más junto, con fuerza",
      wide: "Más abierto, elegante",
    },
  },
  {
    key: "heading_weight",
    label: "Grosor de los títulos",
    options: {
      "": "Cada título con su grosor (como hoy)",
      regular: "Delgado",
      semibold: "Medio",
      bold: "Grueso",
    },
  },
  {
    key: "type_scale",
    label: "Tamaño de los títulos",
    options: { normal: "Normal (como hoy)", compact: "Más pequeños", large: "Más grandes" },
  },
  {
    key: "motion",
    label: "Movimiento",
    hint: "Si tu cliente pidió reducir el movimiento en su teléfono o computadora, nada se mueve.",
    options: {
      none: "Sin movimiento (como hoy)",
      subtle: "Sutil: los bloques de la portada suben al aparecer",
    },
  },
];

const RATIO_CLASS: Record<string, string> = {
  "1:1": "aspect-square",
  "4:5": "aspect-[4/5]",
  "3:4": "aspect-[3/4]",
};
const CARD_CLASS: Record<string, string> = {
  outlined: "border border-border p-2",
  flat: "",
  raised: "p-2 shadow-lg",
};
const TRACKING_CLASS: Record<string, string> = {
  normal: "",
  tight: "tracking-tight",
  wide: "tracking-[0.08em]",
};
const WEIGHT_CLASS: Record<string, string> = {
  "": "font-extrabold",
  regular: "font-normal",
  semibold: "font-semibold",
  bold: "font-bold",
};
const SIZE_CLASS: Record<string, string> = {
  normal: "text-2xl",
  compact: "text-xl",
  large: "text-3xl",
};

function initialValues(p: Personality): Record<PersonalityKey, string> {
  return Object.fromEntries(
    FIELDS.map((f) => {
      const current = p[f.key];
      const fallback = f.key === "heading_weight" ? "" : PERSONALITY_OPTIONS[f.key][0];
      return [f.key, typeof current === "string" ? current : fallback];
    }),
  ) as Record<PersonalityKey, string>;
}

/**
 * Personalidad del diseño (tema v5, ADR-063 fase B-1): opciones fijas que
 * cambian cómo se ve la tienda, nunca lo que dice. Se guarda en el borrador.
 */
export function PersonalityForm({
  storeHandle,
  revision,
  personality,
}: {
  storeHandle: string;
  revision: number;
  personality: Personality;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    saveThemeSection.bind(null, storeHandle, "personalidad"),
    {},
  );
  const [values, setValues] = useState(() => initialValues(personality));
  const set = (key: PersonalityKey, value: string) => setValues((v) => ({ ...v, [key]: value }));
  const v = values;

  return (
    <form action={action} onSubmit={submitKeepingState(action)} className="space-y-6" noValidate>
      <input type="hidden" name="revision" value={revision} />
      <p role="note" className="rounded-md border border-border bg-canvas p-3 text-sm">
        Dale a tu tienda su propio carácter. Estas opciones cambian cómo se ve, no lo que dice: los
        precios, los textos obligatorios y el contraste de los colores no cambian.
      </p>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="space-y-6">
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-semibold">Tarjetas de producto</legend>
            {FIELDS.slice(0, 5).map((f) => (
              <PersonalityField
                key={f.key}
                field={f}
                value={v[f.key]}
                onChange={set}
                state={state}
              />
            ))}
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-semibold">Títulos</legend>
            {FIELDS.slice(5, 9).map((f) => (
              <PersonalityField
                key={f.key}
                field={f}
                value={v[f.key]}
                onChange={set}
                state={state}
              />
            ))}
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-semibold">Movimiento</legend>
            {FIELDS.slice(9).map((f) => (
              <PersonalityField
                key={f.key}
                field={f}
                value={v[f.key]}
                onChange={set}
                state={state}
              />
            ))}
          </fieldset>
        </div>
        <aside aria-label="Vista rápida" className="space-y-2 lg:sticky lg:top-4 lg:self-start">
          <p className="text-[13px] text-fg-muted">
            Vista rápida, sin tus colores ni tu tipografía. Usa la vista previa para ver tu tienda.
          </p>
          <div
            className="space-y-4 rounded-md border border-border bg-canvas p-4"
            aria-hidden="true"
          >
            <p
              className={`leading-tight ${SIZE_CLASS[v.type_scale] ?? "text-2xl"} ${WEIGHT_CLASS[v.heading_weight] ?? ""} ${TRACKING_CLASS[v.heading_tracking] ?? ""} ${v.heading_case === "uppercase" ? "uppercase" : ""}`}
            >
              Lo más nuevo
            </p>
            <div
              className={`w-40 rounded-md bg-surface ${CARD_CLASS[v.card_style] ?? ""} ${v.card_align === "center" ? "text-center" : ""}`}
            >
              <div
                className={`flex w-full items-center justify-center rounded border border-dashed border-border bg-canvas text-fg ${RATIO_CLASS[v.image_ratio] ?? "aspect-square"} ${v.image_fit === "cover" ? "" : "p-3"}`}
              >
                <span className="text-xs">Foto</span>
              </div>
              <p className="mt-2 text-sm font-semibold">Producto de ejemplo</p>
              <p className="text-sm font-bold">$349.00</p>
            </div>
          </div>
        </aside>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          Guardar en el borrador
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

function PersonalityField({
  field,
  value,
  onChange,
  state,
}: {
  field: (typeof FIELDS)[number];
  value: string;
  onChange: (key: PersonalityKey, value: string) => void;
  state: FormState;
}) {
  return (
    <Field
      label={field.label}
      {...(field.hint ? { hint: field.hint } : {})}
      {...(state.fields?.[field.key] ? { error: state.fields[field.key] } : {})}
    >
      {(c) => (
        <Select
          {...c}
          name={field.key}
          value={value}
          onValueChange={(next) => onChange(field.key, next)}
          options={Object.entries(field.options).map(([optionValue, label]) => ({
            value: optionValue,
            label,
          }))}
        />
      )}
    </Field>
  );
}
