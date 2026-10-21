"use client";

import { useActionState, useState } from "react";

import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import { FormFeedback } from "../_shared/form-feedback";
import { SeoPreview } from "../_shared/seo-preview";
import { pageAction, pageBlocksAction, savePage, type ContentActionState } from "./actions";

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
  seo_image_media_id?: string | null;
}

export function PageEditorForm({
  storeHandle,
  page,
  canEdit,
  images = [],
  pageUrl,
}: {
  storeHandle: string;
  page: EditablePage;
  canEdit: boolean;
  /** Imágenes ya procesadas para la imagen al compartir (ADR-034 §3). */
  images?: { id: string; url: string; alt: string | null }[];
  /** Dirección pública de la página, para la vista previa de buscadores. */
  pageUrl?: string;
}) {
  const [state, action, pending] = useActionState<ContentActionState, FormData>(
    savePage.bind(null, storeHandle, page.id),
    {},
  );
  const v = (k: keyof EditablePage) => state.values?.[k] ?? String(page[k] ?? "");
  const [seoTitle, setSeoTitle] = useState(v("seo_title"));
  const [seoDescription, setSeoDescription] = useState(v("seo_description"));
  const [seoImage, setSeoImage] = useState(page.seo_image_media_id ?? "");
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
            {(c) => (
              <Input
                {...c}
                name="seo_title"
                value={seoTitle}
                onChange={(e) => setSeoTitle(e.target.value)}
                maxLength={70}
              />
            )}
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
                value={seoDescription}
                onChange={(e) => setSeoDescription(e.target.value)}
                maxLength={320}
              />
            )}
          </Field>
        </div>
        {page.type === "content" ? (
          <fieldset>
            <legend className="text-[13px] font-medium">Imagen al compartir (opcional)</legend>
            <p className="text-[13px] text-fg-muted">
              Sin elegir, se usa la de tu tienda. Se elige entre imágenes ya subidas.
            </p>
            {state.fields?.seo_image_media_id ? (
              <p className="text-[13px] text-danger">{state.fields.seo_image_media_id}</p>
            ) : null}
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="flex min-h-11 items-center gap-2 rounded-md border border-border p-2 text-sm">
                <input
                  type="radio"
                  name="seo_image_media_id"
                  value=""
                  checked={seoImage === ""}
                  onChange={() => setSeoImage("")}
                />
                La de la tienda
              </label>
              {images.map((img) => (
                <label
                  key={img.id}
                  className="flex flex-col gap-1 rounded-md border border-border p-2 text-sm"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- imagen ya re-codificada */}
                  <img src={img.url} alt="" className="aspect-[1200/630] w-full object-cover" />
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="seo_image_media_id"
                      value={img.id}
                      checked={seoImage === img.id}
                      onChange={() => setSeoImage(img.id)}
                    />
                    {img.alt || "Imagen sin descripción"}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {pageUrl ? (
          <SeoPreview
            title={seoTitle.trim() || v("title")}
            description={seoDescription.trim()}
            url={pageUrl}
            imageUrl={images.find((i) => i.id === seoImage)?.url ?? null}
          />
        ) : null}
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

/** Publicar o descartar el borrador de bloques de una página (ADR-034 §3). */
export function PageBlocksBar({
  storeHandle,
  pageId,
  hasDraft,
  previewHref,
}: {
  storeHandle: string;
  pageId: string;
  hasDraft: boolean;
  previewHref: string | null;
}) {
  const [state, action, pending] = useActionState<ContentActionState, FormData>(
    pageBlocksAction.bind(null, storeHandle, pageId),
    {},
  );
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
      <p className="mr-auto text-sm">
        {hasDraft
          ? "Tienes cambios de bloques sin publicar."
          : "Los bloques publicados están al día."}
      </p>
      {previewHref ? (
        <a
          href={previewHref}
          target="_blank"
          rel="noopener"
          className="inline-flex min-h-11 items-center text-sm underline md:min-h-0"
        >
          Ver vista previa<span className="sr-only"> (se abre en otra pestaña)</span>
        </a>
      ) : null}
      {hasDraft ? (
        <form action={action} className="flex flex-wrap gap-2">
          <Button type="submit" name="action" value="publish" loading={pending}>
            Publicar bloques
          </Button>
          <Button type="submit" name="action" value="discard" variant="ghost" disabled={pending}>
            Descartar cambios de bloques
          </Button>
        </form>
      ) : null}
      <FormFeedback state={state} />
    </div>
  );
}
