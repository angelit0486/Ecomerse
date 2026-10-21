"use client";

import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";
import { useSafeActionState } from "@/ui/use-safe-action-state";

import { saveBrand, type CatalogActionState } from "../actions";
import { nativeControl } from "../styles";

/** Nombre, descripción y sitio web de una marca (misión Portada/Marcas, Paso 2). */
export function BrandProfileForm({
  storeHandle,
  brand,
}: {
  storeHandle: string;
  brand: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    website_url: string | null;
  };
}) {
  const [state, action, pending] = useSafeActionState<CatalogActionState, FormData>(
    saveBrand.bind(null, storeHandle),
    {},
  );
  const prefix = `brand-${brand.id}`;
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="id" value={brand.id} />
      {/* Renombrar no cambia la dirección de la página de la marca (revisión del Paso 2). */}
      <input type="hidden" name="slug" value={brand.slug} />
      <Field
        label="Nombre"
        id={`${prefix}-name`}
        required
        error={
          state.fields?.name ??
          (state.fields?.slug ? "Ya hay otra marca con ese nombre." : undefined)
        }
      >
        {(c) => (
          <Input
            {...c}
            name="name"
            defaultValue={state.values?.name ?? brand.name}
            maxLength={120}
          />
        )}
      </Field>
      <Field
        label="Descripción (opcional)"
        id={`${prefix}-description`}
        hint="Aparece en la página de la marca. Hasta 1000 caracteres."
        error={state.fields?.description}
      >
        {(c) => (
          <textarea
            {...c}
            name="description"
            rows={3}
            maxLength={1000}
            defaultValue={state.values?.description ?? brand.description ?? ""}
            className={`${nativeControl} h-auto w-full py-2`}
          />
        )}
      </Field>
      <Field
        label="Sitio web (opcional)"
        id={`${prefix}-website`}
        hint="La dirección completa, por ejemplo https://marca.com"
        error={state.fields?.website_url}
      >
        {(c) => (
          <Input
            {...c}
            name="website_url"
            type="url"
            inputMode="url"
            defaultValue={state.values?.website_url ?? brand.website_url ?? ""}
            maxLength={500}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" loading={pending}>
          Guardar datos de la marca
        </Button>
        {state.ok ? (
          <p role="status" className="text-sm text-success">
            {state.message}
          </p>
        ) : state.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
