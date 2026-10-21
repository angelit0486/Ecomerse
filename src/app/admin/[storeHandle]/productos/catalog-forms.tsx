"use client";

import { useActionState } from "react";

import { Button } from "@/ui/primitives/button";
import { ConfirmButton } from "@/ui/primitives/confirm-button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import {
  deleteBrand,
  createSupplementCategories,
  deleteCategory,
  saveBrand,
  saveCategory,
  type CatalogActionState,
} from "./actions";
import { nativeControl } from "./styles";

function Feedback({ state }: { state: CatalogActionState }) {
  if (state.ok) {
    return (
      <p role="status" className="text-sm text-success">
        {state.message}
      </p>
    );
  }
  if (state.error && !state.fields) {
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    );
  }
  return null;
}

/** Un slug repetido se muestra en el nombre, que es de donde sale la dirección. */
function nameError(state: CatalogActionState): string | undefined {
  if (state.fields?.name) return state.fields.name;
  return state.fields?.slug ? "Ya existe otra con ese nombre en el mismo nivel." : undefined;
}

interface CategoryOption {
  id: string;
  name: string;
  depth: number;
}

/** Alta o edición de una categoría; mover = cambiar el padre (la base evita ciclos y > 4 niveles). */
export function CategoryForm({
  storeHandle,
  categories,
  category,
}: {
  storeHandle: string;
  categories: CategoryOption[];
  category?: {
    id: string;
    name: string;
    parent_id: string | null;
    slug: string;
    is_visible: boolean;
    description?: string | null;
    seo_title?: string | null;
    seo_description?: string | null;
  };
}) {
  const [state, action, pending] = useActionState<CatalogActionState, FormData>(
    saveCategory.bind(null, storeHandle),
    {},
  );
  const prefix = category ? `cat-${category.id}` : "cat-new";
  return (
    <form
      action={action}
      className="grid gap-3 sm:grid-cols-[2fr_2fr_auto_auto] sm:items-end"
      noValidate
    >
      {category ? <input type="hidden" name="id" value={category.id} /> : null}
      <Field
        label={category ? `Nombre de ${category.name}` : "Nombre"}
        id={`${prefix}-name`}
        required
        error={nameError(state)}
      >
        {(c) => <Input {...c} name="name" defaultValue={category?.name ?? ""} maxLength={120} />}
      </Field>
      <Field label="Dentro de" id={`${prefix}-parent`} error={state.fields?.parent_id}>
        {(c) => (
          <select
            {...c}
            name="parent_id"
            defaultValue={category?.parent_id ?? ""}
            className={nativeControl}
          >
            <option value="">Ninguna (principal)</option>
            {categories
              .filter((o) => o.id !== category?.id)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {"— ".repeat(o.depth)}
                  {o.name}
                </option>
              ))}
          </select>
        )}
      </Field>
      <label className="flex h-11 md:h-9 items-center gap-2 text-sm">
        <input type="hidden" name="is_visible" value="0" />
        <input
          type="checkbox"
          name="is_visible"
          value="1"
          defaultChecked={category?.is_visible ?? true}
        />
        Visible
      </label>
      <Button
        type="submit"
        variant={category ? "secondary" : "primary"}
        size="sm"
        loading={pending}
      >
        {category ? "Guardar" : "Crear categoría"}
      </Button>
      {category ? (
        <details className="sm:col-span-4">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm underline md:min-h-0">
            Descripción y SEO en la tienda
          </summary>
          <Field
            label={`Descripción de ${category.name}`}
            id={`${prefix}-description`}
            hint="Se muestra arriba de los productos de la categoría y en Google. Texto simple, hasta 2000 caracteres."
            error={state.fields?.description}
          >
            {(c) => (
              <textarea
                {...c}
                name="description"
                rows={3}
                maxLength={2000}
                defaultValue={category.description ?? ""}
                className={nativeControl}
              />
            )}
          </Field>
          <Field
            label={`Título en Google de ${category.name}`}
            id={`${prefix}-seo-title`}
            hint="Hasta 70 caracteres. Vacío: se usa el nombre."
            error={state.fields?.seo_title}
          >
            {(c) => (
              <Input
                {...c}
                name="seo_title"
                maxLength={70}
                defaultValue={category.seo_title ?? ""}
              />
            )}
          </Field>
          <Field
            label={`Descripción en Google de ${category.name}`}
            id={`${prefix}-seo-description`}
            hint="Hasta 320 caracteres. Vacío: se usa la descripción."
            error={state.fields?.seo_description}
          >
            {(c) => (
              <textarea
                {...c}
                name="seo_description"
                rows={2}
                maxLength={320}
                defaultValue={category.seo_description ?? ""}
                className={nativeControl}
              />
            )}
          </Field>
        </details>
      ) : null}
      <div className="sm:col-span-4">
        <Feedback state={state} />
        {state.error && state.fields ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function SupplementCategoriesButton({
  storeHandle,
  count,
}: {
  storeHandle: string;
  count: number;
}) {
  const [state, action, pending] = useActionState<CatalogActionState>(
    createSupplementCategories.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" loading={pending}>
        {count === 1 ? "Crear la categoría que falta" : `Crear las ${count} categorías`}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function DeleteCategoryButton({
  storeHandle,
  id,
  name,
}: {
  storeHandle: string;
  id: string;
  name: string;
}) {
  const [state, action, pending] = useActionState<CatalogActionState, FormData>(
    deleteCategory.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <ConfirmButton
        size="sm"
        loading={pending}
        aria-label={`Eliminar ${name}`}
        question={`¿Eliminar la categoría «${name}»?`}
        detail="Sus productos dejan de estar en esta categoría."
      >
        Eliminar
      </ConfirmButton>
      <Feedback state={state} />
    </form>
  );
}

export function BrandForm({
  storeHandle,
  brand,
}: {
  storeHandle: string;
  brand?: { id: string; name: string };
}) {
  const [state, action, pending] = useActionState<CatalogActionState, FormData>(
    saveBrand.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-3" noValidate>
      {brand ? <input type="hidden" name="id" value={brand.id} /> : null}
      <Field
        label={brand ? `Nombre de ${brand.name}` : "Nombre de la marca"}
        id={brand ? `brand-${brand.id}` : "brand-new"}
        required
        error={nameError(state)}
      >
        {(c) => <Input {...c} name="name" defaultValue={brand?.name ?? ""} maxLength={120} />}
      </Field>
      <Button type="submit" variant={brand ? "secondary" : "primary"} size="sm" loading={pending}>
        {brand ? "Guardar" : "Crear marca"}
      </Button>
      <Feedback state={state} />
      {state.error && state.fields ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function DeleteBrandButton({
  storeHandle,
  id,
  name,
}: {
  storeHandle: string;
  id: string;
  name: string;
}) {
  const [state, action, pending] = useActionState<CatalogActionState, FormData>(
    deleteBrand.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <ConfirmButton
        size="sm"
        loading={pending}
        aria-label={`Eliminar ${name}`}
        question={`¿Eliminar la marca «${name}»?`}
        detail="Sus productos quedan sin marca."
      >
        Eliminar
      </ConfirmButton>
      <Feedback state={state} />
    </form>
  );
}
