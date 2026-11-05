"use client";

import { useId, useState } from "react";

import { renderText, SAMPLE_VARS } from "@/lib/emails/store-texts";
import { Button } from "@/ui/primitives/button";
import { useSafeActionState } from "@/ui/use-safe-action-state";

import type { FormState } from "../../_shared/action-state";
import { FormFeedback } from "../../_shared/form-feedback";
import { saveEmailText } from "./actions";

const inputClass =
  "h-11 md:h-9 rounded-[var(--radius-control)] border border-control bg-surface px-2 text-sm";
const textareaClass =
  "min-h-20 rounded-[var(--radius-control)] border border-control bg-surface p-2 text-sm";

export function EmailTextForm({
  storeHandle,
  storeName,
  template,
  label,
  defaultSubject,
  subject,
  note,
  canEdit,
}: {
  storeHandle: string;
  storeName: string;
  template: string;
  label: string;
  defaultSubject: string;
  subject: string;
  note: string;
  canEdit: boolean;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    saveEmailText.bind(null, storeHandle, template),
    {},
  );
  const [draftSubject, setDraftSubject] = useState(state.values?.subject ?? subject);
  const [draftNote, setDraftNote] = useState(state.values?.note ?? note);
  const id = useId();
  const vars = { ...SAMPLE_VARS, tienda: storeName };
  const previewSubject = renderText(draftSubject.trim() || defaultSubject, vars);
  const previewNote = draftNote.trim() ? renderText(draftNote.trim(), vars) : "";

  return (
    <form
      action={action}
      aria-labelledby={`${id}-h`}
      className="space-y-3 rounded-md border border-border p-4"
    >
      <h2 id={`${id}-h`} className="font-semibold">
        {label}
      </h2>
      <fieldset disabled={!canEdit} className="space-y-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Asunto (opcional)
          <input
            name="subject"
            maxLength={150}
            value={draftSubject}
            onChange={(e) => setDraftSubject(e.target.value)}
            placeholder={defaultSubject}
            aria-invalid={state.fields?.subject ? true : undefined}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Mensaje de la tienda (opcional)
          <textarea
            name="note"
            maxLength={1000}
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            aria-invalid={state.fields?.note ? true : undefined}
            className={textareaClass}
          />
        </label>
      </fieldset>
      <div
        aria-label={`Vista previa: ${label}`}
        role="group"
        className="space-y-1 rounded-md bg-canvas p-3 text-sm"
      >
        <p>
          <span className="font-medium">Asunto:</span> {previewSubject}
        </p>
        {previewNote ? (
          <p className="whitespace-pre-line">
            <span className="font-medium">Tu mensaje:</span> {previewNote}
          </p>
        ) : null}
        <p className="text-fg-muted">Vista previa con un cliente de ejemplo.</p>
      </div>
      {canEdit ? (
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" loading={pending}>
            Guardar
          </Button>
          <FormFeedback state={state} />
        </div>
      ) : null}
    </form>
  );
}
