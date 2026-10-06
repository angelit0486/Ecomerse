"use client";

import { useActionState } from "react";

import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import {
  deleteBrand,
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
      <label className="flex h-9 items-center gap-2 text-sm">
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
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        loading={pending}
        aria-label={`Eliminar ${name}`}
      >
        Eliminar
      </Button>
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
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        loading={pending}
        aria-label={`Eliminar ${name}`}
      >
        Eliminar
      </Button>
      <Feedback state={state} />
    </form>
  );
}
