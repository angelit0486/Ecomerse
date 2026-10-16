"use client";

import { useActionState } from "react";

import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import type { FormState } from "../../_shared/action-state";
import { FormFeedback } from "../../_shared/form-feedback";
import { classifyPublishedAsUnregulated, saveStoreLegend, setRegulatedCategory } from "./actions";

export function DeclareCategoryForm({
  storeHandle,
  categoryKey,
  categoryName,
  declared,
}: {
  storeHandle: string;
  categoryKey: string;
  categoryName: string;
  declared: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    setRegulatedCategory.bind(null, storeHandle, categoryKey, !declared),
    {},
  );
  return (
    <form action={action} className="space-y-2">
      {declared ? (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="confirm" value="1" className="mt-1" />
          <span>
            Ya no vendo {categoryName.toLowerCase()}: mis productos de esta categoría están
            reclasificados.
          </span>
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={declared ? "secondary" : "primary"} loading={pending}>
          {declared
            ? `Retirar ${categoryName.toLowerCase()}`
            : `Vendo ${categoryName.toLowerCase()}`}
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function ClassifyPublishedForm({
  storeHandle,
  count,
}: {
  storeHandle: string;
  count: number;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    classifyPublishedAsUnregulated.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="space-y-2">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" value="1" className="mt-1" />
        <span>
          Confirmo que {count === 1 ? "ese producto no es" : `esos ${count} productos no son`}{" "}
          suplementos ni otro producto regulado.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" loading={pending}>
          Marcar como no regulados
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

const area =
  "w-full rounded-[var(--radius-control)] border border-control bg-surface px-3 py-2 text-sm text-fg aria-[invalid=true]:border-danger";

/**
 * Leyenda sanitaria de la tienda (Fase A). El borrador se guarda sin efecto en la
 * tienda; «Aprobar» publica exactamente este texto con el nombre de quien lo
 * revisó. El borrador sugerido llega marcado «PENDIENTE DE REVISIÓN» y la base
 * no deja aprobarlo así.
 */
export function StoreLegendForm({
  storeHandle,
  categoryKey,
  initialBody,
  initialReviewer,
  canEdit,
}: {
  storeHandle: string;
  categoryKey: string;
  initialBody: string;
  initialReviewer: string;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveStoreLegend.bind(null, storeHandle, categoryKey),
    {},
  );
  const body = state.values?.body ?? initialBody;
  const reviewer = state.values?.reviewed_by ?? initialReviewer;
  return (
    <form action={action} className="space-y-3" noValidate>
      <Field
        label="Texto de la leyenda (borrador)"
        hint="Escríbelo exactamente como lo indique tu asesor regulatorio."
        error={state.fields?.body ?? state.fields?.pending_marker}
      >
        {(c) => (
          <textarea
            {...c}
            name="body"
            rows={5}
            maxLength={2000}
            defaultValue={body}
            key={body}
            readOnly={!canEdit}
            className={area}
          />
        )}
      </Field>
      {canEdit ? (
        <>
          <Field
            label="Revisado por (para aprobar)"
            hint="Nombre de tu asesor regulatorio o responsable sanitario."
            error={state.fields?.reviewed_by}
          >
            {(c) => (
              <Input
                {...c}
                name="reviewed_by"
                maxLength={120}
                defaultValue={reviewer}
                key={reviewer}
              />
            )}
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="confirm" value="1" className="mt-1" />
            <span>Confirmo que mi asesor regulatorio revisó este texto (solo para aprobar).</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" name="intent" value="draft" variant="secondary" loading={pending}>
              Guardar borrador
            </Button>
            <Button type="submit" name="intent" value="approve" loading={pending}>
              Aprobar y publicar leyenda
            </Button>
            <FormFeedback state={state} />
          </div>
        </>
      ) : (
        <p className="text-sm text-fg-muted">Tu rol no permite editar la leyenda.</p>
      )}
    </form>
  );
}
