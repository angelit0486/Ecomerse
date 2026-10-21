"use client";

import { Button } from "@/ui/primitives/button";

import type { FormState } from "../_shared/action-state";
import { FormFeedback } from "../_shared/form-feedback";
import { copyDesignFromStore, importDesignFile } from "./actions";
import { useSafeActionState } from "@/ui/use-safe-action-state";

/**
 * Llevar el diseño de una tienda a otra (ADR-034 §6): descargar el archivo,
 * subirlo en otra tienda o copiar directo de una tienda de la misma
 * organización. Todo cae en el borrador.
 */
export function MoveDesign({
  storeHandle,
  revision,
  stores,
}: {
  storeHandle: string;
  revision: number;
  stores: { id: string; name: string }[];
}) {
  const [imported, importAction, importing] = useSafeActionState<FormState, FormData>(
    importDesignFile.bind(null, storeHandle),
    {},
  );
  const [copied, copyAction, copying] = useSafeActionState<FormState, FormData>(
    copyDesignFromStore.bind(null, storeHandle),
    {},
  );
  return (
    <section aria-labelledby="mover-diseno" className="space-y-4 border-t border-border pt-6">
      <div className="space-y-1">
        <h2 id="mover-diseno" className="text-base font-semibold">
          Llevar el diseño a otra tienda
        </h2>
        <p className="text-sm text-fg-muted">
          Se copian colores, tipografía, forma, encabezado, presentación y portada. No se copian
          imágenes, SEO, contacto ni redes, ni las secciones que dependen de tus productos,
          categorías o marcas.
        </p>
      </div>

      <a
        href={`/admin/${storeHandle}/apariencia/exportar`}
        download
        className="inline-flex min-h-11 items-center text-sm underline"
      >
        Descargar el diseño (archivo .json)
      </a>

      <form action={importAction} className="space-y-2">
        <input type="hidden" name="revision" value={revision} />
        <label htmlFor="archivo-diseno" className="block text-sm font-medium">
          Subir un diseño descargado
        </label>
        <input
          id="archivo-diseno"
          type="file"
          name="file"
          accept="application/json,.json"
          className="block min-h-11 text-sm file:mr-3 file:min-h-11 file:rounded-md file:border file:border-control file:bg-surface file:px-3"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="secondary" loading={importing}>
            Copiar al borrador
          </Button>
          <FormFeedback state={imported} />
        </div>
      </form>

      {stores.length > 0 ? (
        <form action={copyAction} className="space-y-2">
          <input type="hidden" name="revision" value={revision} />
          <label htmlFor="tienda-origen" className="block text-sm font-medium">
            Copiar el diseño publicado de otra tienda
          </label>
          <select
            id="tienda-origen"
            name="source_store_id"
            className="block min-h-11 w-full max-w-sm rounded-md border border-control bg-surface px-3 text-sm"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="secondary" loading={copying}>
              Copiar diseño de esta tienda
            </Button>
            <FormFeedback state={copied} />
          </div>
        </form>
      ) : null}
    </section>
  );
}
