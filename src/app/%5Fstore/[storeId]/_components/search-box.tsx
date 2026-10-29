"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

/**
 * Buscador con sugerencias (F9-T04, F9-DESIGN §10): patrón combobox de ARIA
 * con lista (`aria-activedescendant`). Flechas para moverse, Enter para ir,
 * Escape para cerrar. Sin JavaScript es un formulario GET a /buscar.
 */
export interface SuggestionItem {
  kind: "product" | "category" | "brand" | "value";
  label: string;
  detail: string | null;
  href: string;
  image: string | null;
}

const GROUPS: { kind: SuggestionItem["kind"]; label: string }[] = [
  { kind: "product", label: "Productos" },
  { kind: "value", label: "Objetivos y más" },
  { kind: "category", label: "Categorías" },
  { kind: "brand", label: "Marcas" },
];

const DEBOUNCE_MS = 200;

/** `storeName`: el campo dice «Buscar en {tienda}» (misión vendible F2, V5). */
export function SearchBox({ storeName }: { storeName: string }) {
  const router = useRouter();
  const id = useId();
  const listId = `${id}-lista`;
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SuggestionItem[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const abort = useRef<AbortController | null>(null);

  const q = query.trim();
  // La última opción siempre busca el texto completo.
  const options: SuggestionItem[] =
    q.length >= 2
      ? [
          ...items,
          {
            kind: "product",
            label: `Buscar «${q}»`,
            detail: null,
            href: `/buscar?${new URLSearchParams([["q", q]]).toString()}`,
            image: null,
          },
        ]
      : [];
  const expanded = open && options.length > 0;

  useEffect(() => {
    // Cada texto cancela la petición del anterior (Gate F9): una respuesta
    // vieja no vuelve a llenar la lista con sugerencias de otro texto.
    abort.current?.abort();
    if (q.length < 2) return;
    const controller = new AbortController();
    abort.current = controller;
    const timer = setTimeout(() => {
      fetch(`/buscar/sugerencias?${new URLSearchParams([["q", q]]).toString()}`, {
        signal: controller.signal,
      })
        .then((r) => (r.ok ? (r.json() as Promise<{ items: SuggestionItem[] }>) : { items: [] }))
        .then((data) => {
          if (controller.signal.aborted) return;
          setItems(data.items);
          setActive(-1);
        })
        .catch(() => {
          // Cancelada o sin red: se queda lo anterior; Enter sigue buscando.
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  function go(item: SuggestionItem) {
    setOpen(false);
    router.push(item.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (options.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const n = options.length;
      setActive((i) => (event.key === "ArrowDown" ? (i + 1) % n : i <= 0 ? n - 1 : i - 1));
    } else if (event.key === "Enter" && expanded && active >= 0 && options[active]) {
      event.preventDefault();
      go(options[active]);
    } else if (event.key === "Escape") {
      if (expanded) {
        event.preventDefault();
        setOpen(false);
        setActive(-1);
      } else {
        setQuery("");
      }
    }
  }

  const optionId = (i: number) => `${id}-op-${i}`;

  return (
    <form
      method="get"
      action="/buscar"
      role="search"
      className="relative order-last w-full px-2 sm:order-none sm:max-w-2xl sm:flex-1 sm:px-0"
    >
      <label htmlFor={`${id}-q`} className="sr-only">
        Buscar productos
      </label>
      {/* Campo con el botón dentro (rediseño A+B): el borde de 2 px en el color de
          compra marca dónde se busca; el foco se ve en todo el control. */}
      <div className="flex h-11 items-center gap-1 rounded-[var(--sf-radius-btn)] border-2 border-[var(--sf-primary)] bg-[var(--sf-bg)] p-0.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--sf-primary)]">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="ml-2 h-5 w-5 shrink-0 text-[var(--sf-muted)]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
        <input
          id={`${id}-q`}
          name="q"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          placeholder={`Buscar en ${storeName}`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Lo elegido con flechas era para el texto anterior.
            setActive(-1);
            if (e.target.value.trim().length < 2) setItems([]);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          // 16 px: Safari en iPhone no acerca la página al tocar el campo.
          className="h-full min-w-0 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-[var(--sf-muted)]"
        />
        <button
          type="submit"
          className="h-full shrink-0 rounded-[max(calc(var(--sf-radius-btn)-3px),0px)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-4 text-sm font-semibold text-[var(--sf-btn-fg)]"
        >
          Buscar
        </button>
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label="Sugerencias"
        hidden={!expanded}
        className="absolute left-0 right-0 top-12 z-20 max-h-[70vh] overflow-y-auto rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] bg-[var(--sf-bg)] p-2 text-sm shadow-lg sm:min-w-96"
      >
        {GROUPS.map((group) => {
          const groupItems = items.filter((item) => item.kind === group.kind);
          if (groupItems.length === 0) return null;
          return (
            <div key={group.kind} role="group" aria-labelledby={`${id}-g-${group.kind}`}>
              <div
                id={`${id}-g-${group.kind}`}
                className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--sf-muted)]"
              >
                {group.label}
              </div>
              {groupItems.map((item) => {
                const i = options.indexOf(item);
                return (
                  <Option
                    key={item.href}
                    item={item}
                    id={optionId(i)}
                    active={i === active}
                    onPick={go}
                  />
                );
              })}
            </div>
          );
        })}
        {options.length > 0 ? (
          <Option
            item={options[options.length - 1]!}
            id={optionId(options.length - 1)}
            active={active === options.length - 1}
            onPick={go}
          />
        ) : null}
      </div>
      <p aria-live="polite" className="sr-only">
        {expanded && items.length > 0 ? `${items.length} sugerencias disponibles.` : ""}
      </p>
    </form>
  );
}

function Option({
  item,
  id,
  active,
  onPick,
}: {
  item: SuggestionItem;
  id: string;
  active: boolean;
  onPick: (item: SuggestionItem) => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      // mousedown: elige antes de que el campo pierda el foco y cierre la lista.
      onMouseDown={(event) => {
        event.preventDefault();
        onPick(item);
      }}
      className={`flex cursor-pointer items-center gap-3 rounded-[var(--sf-radius-control)] px-2 py-2 ${
        active
          ? "bg-[var(--sf-surface)] outline outline-2 outline-[var(--sf-fg)]"
          : "hover:bg-[var(--sf-surface)]"
      }`}
    >
      {item.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- miniatura re-codificada
        <img
          src={item.image}
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 rounded object-cover"
        />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{item.label}</span>
        {item.detail ? (
          <span className="block truncate text-xs text-[var(--sf-muted)]">{item.detail}</span>
        ) : null}
      </span>
    </div>
  );
}
