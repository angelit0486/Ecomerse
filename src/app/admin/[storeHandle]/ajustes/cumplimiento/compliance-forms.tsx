"use client";

import { useActionState } from "react";

import { Button } from "@/ui/primitives/button";

import type { FormState } from "../../_shared/action-state";
import { FormFeedback } from "../../_shared/form-feedback";
import { classifyPublishedAsUnregulated, setRegulatedCategory } from "./actions";

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
