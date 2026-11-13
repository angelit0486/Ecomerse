"use client";

import { useId, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/ui/primitives/button";

export interface MissingCategory {
  path: string;
  key: string;
  products: number;
  creatable: boolean;
  reason: string | null;
  hint: string | null;
  similar: string[];
  accepted: boolean;
}

const REASONS: Record<string, (hint: string | null) => string> = {
  slug_taken: (hint) =>
    `Ya existe «${hint ?? ""}» con la misma dirección: corrige el archivo para usar ese nombre.`,
  slug_deleted: (hint) =>
    `Hay una categoría borrada con esa dirección («${hint ?? ""}»): restáurala en Productos → Categorías o usa otro nombre.`,
  spelling: (hint) =>
    `En otras filas se escribe «${hint ?? ""}»: usa la misma forma en todo el archivo.`,
  too_deep: () => "Tiene más de 3 niveles: créala a mano o acorta la ruta.",
  invalid_name: () => "El nombre no es válido (hasta 120 caracteres, sin «|» ni «>»).",
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} variant="secondary">
      {pending ? "Revisando…" : label}
    </Button>
  );
}

const count = (n: number) => (n === 1 ? "1 producto" : `${n.toLocaleString("es-MX")} productos`);

/**
 * ADR-065 opción A: crear las categorías que falten. Apagado por defecto; la
 * lista muestra qué se crearía y con cuántos productos; nada se crea hasta
 * confirmar la importación (y si la importación falla, no se crea ninguna).
 */
export function NewCategories({
  missing,
  accepted,
  canCreate,
  action,
}: {
  missing: MissingCategory[];
  accepted: string[];
  canCreate: boolean;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const id = useId();
  const creatable = missing.filter((m) => m.creatable);
  const [enabled, setEnabled] = useState(false);
  if (missing.length === 0 && accepted.length === 0) return null;
  return (
    <section
      aria-labelledby={`${id}-h`}
      className="space-y-3 rounded-md border border-border p-4 text-sm"
    >
      <h2 id={`${id}-h`} className="font-semibold">
        Categorías que no existen en tu tienda
      </h2>
      {accepted.length > 0 ? (
        <form action={action} className="space-y-2">
          <p role="status">
            Se crearán al confirmar la importación, en la misma operación (si la importación falla,
            no se crea ninguna): {accepted.map((p) => `«${p}»`).join(", ")}.
          </p>
          <input type="hidden" name="intent" value="clear" />
          <Submit label="Ya no crearlas" />
        </form>
      ) : null}
      {missing.filter((m) => !m.accepted).length > 0 ? (
        <ul
          aria-label="Categorías que faltan"
          className="divide-y divide-border rounded-md border border-border"
        >
          {missing
            .filter((m) => !m.accepted)
            .map((m) => (
              <li key={m.key} className="space-y-1 p-3">
                <p>
                  <span className="font-medium">{m.path}</span>{" "}
                  <span className="text-fg-muted">· {count(m.products)}</span>
                </p>
                {!m.creatable && m.reason ? (
                  <p>{(REASONS[m.reason] ?? (() => "No se puede crear."))(m.hint)}</p>
                ) : null}
                {m.similar.length > 0 ? (
                  <p className="text-[13px]">
                    Aviso: se parece a {m.similar.map((s) => `«${s}»`).join(", ")}, que ya existe.
                    Si es la misma, corrige el archivo en lugar de crear otra.
                  </p>
                ) : null}
              </li>
            ))}
        </ul>
      ) : null}
      {!canCreate && creatable.some((m) => !m.accepted) ? (
        <p>
          Tu rol no puede crear categorías. Pide que las creen en Productos → Categorías o corrige
          el archivo.
        </p>
      ) : null}
      {canCreate && creatable.some((m) => !m.accepted) ? (
        <div className="space-y-2">
          <label className="flex min-h-11 items-center gap-2 font-medium">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.currentTarget.checked)}
            />
            Crear las categorías que falten
          </label>
          {enabled ? (
            <form action={action} className="space-y-2 rounded-md border border-border p-3">
              <input type="hidden" name="intent" value="accept" />
              {/* Las ya aceptadas se conservan al agregar otras. */}
              {accepted.map((p) => (
                <input key={p} type="hidden" name="paths" value={p} />
              ))}
              <fieldset className="space-y-1">
                <legend className="font-medium">Elige cuáles crear</legend>
                {creatable
                  .filter((m) => !m.accepted)
                  .map((m) => (
                    <label key={m.key} className="flex min-h-11 items-center gap-2">
                      <input type="checkbox" name="paths" value={m.path} defaultChecked />
                      {m.path} ({count(m.products)})
                    </label>
                  ))}
              </fieldset>
              <p className="text-fg-muted">
                No se crea nada todavía: se crean al confirmar la importación. Revisa los nombres;
                una categoría mal escrita se crearía tal cual.
              </p>
              <Submit label="Usar estas categorías y revisar de nuevo" />
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
