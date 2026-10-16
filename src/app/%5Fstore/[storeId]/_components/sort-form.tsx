import { AutoSubmitForm, NoJsSubmit } from "./auto-submit";

const SORT_LABELS: Record<string, string> = {
  relevance: "Relevancia",
  newest: "Novedades",
  price_asc: "Precio: menor a mayor",
  price_desc: "Precio: mayor a menor",
  best_selling: "Más vendidos",
};

/** Orden y filtro de disponibilidad por GET: se aplican al cambiar; sin JavaScript, con «Aplicar». */
export function SortForm({
  action,
  sort,
  available,
  query,
  hidden = [],
}: {
  action: string;
  sort: string;
  available: boolean;
  query?: string;
  /** Filtros de atributos activos: se conservan al ordenar. */
  hidden?: [string, string][];
}) {
  const sorts = query
    ? Object.keys(SORT_LABELS)
    : Object.keys(SORT_LABELS).filter((s) => s !== "relevance");
  return (
    <AutoSubmitForm action={action} className="flex flex-wrap items-end gap-x-4 gap-y-2 text-sm">
      {query ? <input type="hidden" name="q" value={query} /> : null}
      {hidden.map(([name, value]) => (
        <input key={`${name}=${value}`} type="hidden" name={name} value={value} />
      ))}
      <label className="flex flex-col gap-1">
        <span className="font-medium">Ordenar por</span>
        <select
          name="orden"
          defaultValue={sort}
          className="h-11 rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] px-2"
        >
          {sorts.map((s) => (
            <option key={s} value={s}>
              {SORT_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          name="disponible"
          value="1"
          defaultChecked={available}
          className="h-5 w-5 accent-[var(--sf-primary)]"
        />
        Solo disponibles
      </label>
      <NoJsSubmit className="h-10 rounded-[var(--sf-radius-control)] border border-[var(--sf-border)] px-4 font-medium">
        Aplicar
      </NoJsSubmit>
    </AutoSubmitForm>
  );
}
