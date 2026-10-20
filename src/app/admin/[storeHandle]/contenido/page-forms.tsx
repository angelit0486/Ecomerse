"use client";

import { useActionState } from "react";

import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import { FormFeedback } from "../_shared/form-feedback";
import { pageAction, savePage, type ContentActionState } from "./actions";

const textarea =
  "rounded-[var(--radius-control)] border border-control bg-surface p-3 font-mono text-sm";

export function NewPageForm({ storeHandle }: { storeHandle: string }) {
  const [state, action, pending] = useActionState<ContentActionState, FormData>(
    savePage.bind(null, storeHandle, null),
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-3" noValidate>
      <Field
        label="Título de la nueva página"
        id="page-new-title"
        required
        error={state.fields?.title ?? state.fields?.slug}
      >
        {(c) => (
          <Input {...c} name="title" defaultValue={state.values?.title ?? ""} maxLength={120} />
        )}
      </Field>
      <Button type="submit" size="sm" loading={pending}>
        Crear página
      </Button>
      {!state.fields ? <FormFeedback state={state} /> : null}
    </form>
  );
}

export interface EditablePage {
  id: string;
  type: string;
  slug: string;
  title: string;
  body_html: string;
  is_published: boolean;
  seo_title: string | null;
  seo_description: string | null;
}

export function PageEditorForm({
  storeHandle,
  page,
  canEdit,
}: {
  storeHandle: string;
  page: EditablePage;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<ContentActionState, FormData>(
    savePage.bind(null, storeHandle, page.id),
    {},
  );
  const v = (k: keyof EditablePage) => state.values?.[k] ?? String(page[k] ?? "");
  return (
    <form action={action} className="space-y-4" noValidate>
      <fieldset disabled={!canEdit} className="space-y-4">
        <Field label="Título" required error={state.fields?.title}>
          {(c) => <Input {...c} name="title" defaultValue={v("title")} maxLength={120} />}
        </Field>
        <Field
          label="Dirección (slug)"
          hint={
            page.is_published
              ? "La página está publicada: su dirección no cambia."
              : "Solo minúsculas, números y guiones."
          }
          error={state.fields?.slug ?? state.fields?.slug_published}
        >
          {(c) => (
            <Input
              {...c}
              name="slug"
              defaultValue={v("slug")}
              maxLength={120}
              readOnly={page.is_published}
            />
          )}
        </Field>
        <Field
          label="Contenido"
          hint="HTML básico: párrafos, títulos (h2–h4), listas, negritas, enlaces y tablas. Lo demás se elimina al guardar."
          error={state.fields?.body_html}
        >
          {(c) => (
            <textarea
              {...c}
              name="body_html"
              rows={16}
              defaultValue={v("body_html")}
              className={textarea}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Título para buscadores"
            hint="Máximo 70 caracteres."
            error={state.fields?.seo_title}
          >
            {(c) => <Input {...c} name="seo_title" defaultValue={v("seo_title")} maxLength={70} />}
          </Field>
          <Field
            label="Descripción para buscadores"
            hint="Máximo 320 caracteres."
            error={state.fields?.seo_description}
          >
            {(c) => (
              <Input
                {...c}
                name="seo_description"
                defaultValue={v("seo_description")}
                maxLength={320}
              />
            )}
          </Field>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={pending}>
              Guardar
            </Button>
            <FormFeedback state={state} />
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}

export function PageStatusForm({
  storeHandle,
  pageId,
  published,
  deletable,
}: {
  storeHandle: string;
  pageId: string;
  published: boolean;
  deletable: boolean;
}) {
  const [state, action, pending] = useActionState<ContentActionState, FormData>(
    pageAction.bind(null, storeHandle, pageId),
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button
        type="submit"
        name="action"
        value={published ? "unpublish" : "publish"}
        variant={published ? "secondary" : "primary"}
        size="sm"
        loading={pending}
      >
        {published ? "Despublicar" : "Publicar"}
      </Button>
      {deletable ? (
        <Button
          type="submit"
          name="action"
          value="delete"
          variant="ghost"
          size="sm"
          disabled={pending}
        >
          Eliminar página
        </Button>
      ) : null}
      <FormFeedback state={state} />
    </form>
  );
}
