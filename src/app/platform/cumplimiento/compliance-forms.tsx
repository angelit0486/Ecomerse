"use client";

import { useActionState, useState } from "react";

import {
  PLACEMENT_LABELS,
  RULE_KIND_LABELS,
  SUPPLEMENT_FIELD_LABELS,
} from "@/lib/compliance/labels";
import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import type { ConsoleState } from "../actions";
import { retireComplianceRule, saveComplianceRule, setComplianceProfileStatus } from "./actions";

const native =
  "h-9 w-full rounded-[var(--radius-control)] border border-control bg-surface px-2 text-sm text-fg aria-[invalid=true]:border-danger";
const area =
  "w-full rounded-[var(--radius-control)] border border-control bg-surface px-3 py-2 text-sm text-fg aria-[invalid=true]:border-danger";

function Feedback({ state }: { state: ConsoleState }) {
  if (state.ok)
    return (
      <p role="status" className="text-sm text-success">
        {state.message}
      </p>
    );
  if (state.error)
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    );
  return null;
}

export function RuleForm({ profileId, fieldKeys }: { profileId: string; fieldKeys: string[] }) {
  const [state, action, pending] = useActionState<ConsoleState, FormData>(
    saveComplianceRule.bind(null, profileId),
    {},
  );
  const [kind, setKind] = useState(state.values?.kind ?? "required_legend");
  const v = (k: string) => state.values?.[k] ?? "";
  return (
    <form action={action} className="space-y-3 rounded-md border border-border p-4" noValidate>
      <h3 className="font-medium">Agregar o editar una regla</h3>
      <p className="text-[13px] text-fg-muted">
        Con la misma clave se actualiza la regla existente. Escribe el texto exactamente como lo
        indica el asesor regulatorio.
      </p>
      <Field label="Tipo de regla" error={state.fields?.kind}>
        {(c) => (
          <select
            {...c}
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className={native}
          >
            {Object.entries(RULE_KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Clave" hint="Por ejemplo: leyenda_1" error={state.fields?.key}>
          {(c) => <Input {...c} name="key" maxLength={40} defaultValue={v("key")} />}
        </Field>
        <Field label="Nombre" error={state.fields?.label}>
          {(c) => <Input {...c} name="label" maxLength={120} defaultValue={v("label")} />}
        </Field>
      </div>
      {kind === "required_field" ? (
        <Field label="Campo de la ficha" error={state.fields?.field_key}>
          {(c) => (
            <select {...c} name="field_key" defaultValue={v("field_key")} className={native}>
              {fieldKeys.map((f) => (
                <option key={f} value={f}>
                  {SUPPLEMENT_FIELD_LABELS[f] ?? f}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : (
        <Field
          label={kind === "forbidden_term" ? "Término" : "Texto de la leyenda"}
          error={state.fields?.body}
        >
          {(c) => (
            <textarea
              {...c}
              name="body"
              rows={kind === "forbidden_term" ? 1 : 4}
              maxLength={kind === "forbidden_term" ? 60 : 2000}
              defaultValue={v("body")}
              className={area}
            />
          )}
        </Field>
      )}
      {kind === "required_legend" ? (
        <fieldset className="space-y-1">
          <legend className="text-[13px] font-medium">Dónde se muestra</legend>
          {Object.entries(PLACEMENT_LABELS).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="placements"
                value={value}
                defaultChecked={(state.values?.placements ?? "product_page")
                  .split(",")
                  .includes(value)}
              />
              {label}
            </label>
          ))}
          {state.fields?.placements ? (
            <p className="text-[13px] text-danger">{state.fields.placements}</p>
          ) : null}
        </fieldset>
      ) : null}
      <Field label="Orden" error={state.fields?.position}>
        {(c) => <Input {...c} name="position" inputMode="numeric" defaultValue={v("position")} />}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          Guardar regla
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function RetireRuleButton({ ruleId, label }: { ruleId: string; label: string }) {
  const [state, action, pending] = useActionState<ConsoleState, FormData>(
    retireComplianceRule.bind(null, ruleId),
    {},
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        loading={pending}
        aria-label={`Retirar la regla ${label}`}
      >
        Retirar
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function ProfileStatusForm({
  profileId,
  reviewedBy,
}: {
  profileId: string;
  reviewedBy: string | null;
}) {
  const [state, action, pending] = useActionState<ConsoleState, FormData>(
    setComplianceProfileStatus.bind(null, profileId),
    {},
  );
  // Lo habitual es marcar como revisadas; pendiente o suspendidas despublican (se confirma).
  const [next, setNext] = useState(state.values?.status ?? "active");
  return (
    <form action={action} className="space-y-3 rounded-md border border-border p-4" noValidate>
      <h3 className="font-medium">Revisión de las reglas</h3>
      <Field label="Estado" error={state.fields?.status}>
        {(c) => (
          <select
            {...c}
            name="status"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className={native}
          >
            <option value="active">Revisadas (se aplican)</option>
            <option value="pending">Pendiente de revisión</option>
            <option value="suspended">Suspendidas</option>
          </select>
        )}
      </Field>
      {next === "active" ? (
        <Field
          label="Revisó"
          hint="Nombre del asesor o despacho que revisó las reglas. Queda registrado con la fecha."
          error={state.fields?.reviewed_by}
        >
          {(c) => (
            <Input
              {...c}
              name="reviewed_by"
              maxLength={120}
              defaultValue={state.values?.reviewed_by ?? reviewedBy ?? ""}
            />
          )}
        </Field>
      ) : (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="confirm" value="1" className="mt-1" />
          <span>
            Entiendo que todos los productos publicados de esta categoría en las tiendas de este
            país se despublicarán.
          </span>
        </label>
      )}
      <Field label="Notas" error={state.fields?.review_notes}>
        {(c) => (
          <textarea
            {...c}
            name="review_notes"
            rows={2}
            maxLength={2000}
            defaultValue={state.values?.review_notes ?? ""}
            className={area}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          Guardar estado
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}
