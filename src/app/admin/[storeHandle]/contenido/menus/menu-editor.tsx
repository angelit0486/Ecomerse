"use client";

import { useState } from "react";

import { Button } from "@/ui/primitives/button";

import { saveMenu, type ContentActionState } from "../actions";
import { filterHref, LINK_TYPE_LABELS } from "../labels";
import { useSafeActionState } from "@/ui/use-safe-action-state";

const control =
  "h-11 md:h-9 rounded-[var(--radius-control)] border border-control bg-surface px-2 text-sm text-fg";

export interface MenuDraft {
  key: string;
  label: string;
  link_type: string;
  target_id: string;
  url: string;
  children: MenuDraft[];
  /** Su destino anterior ya no existe: hay que elegir otro. */
  stale?: boolean;
}

export type TargetOptions = Record<
  "category" | "brand" | "page" | "product" | "filter",
  { id: string; name: string }[]
>;

/**
 * Destinos que se eligen de una lista. `filter` (F9-T04) no existe en la base:
 * es un enlace interno `/productos?atributo=valor` (p. ej. «Objetivos» →
 * Energía) que se guarda como `url`.
 */
const TARGET_TYPES = ["category", "brand", "page", "product", "filter"] as const;

const MAX_ITEMS = 50;

let counter = 0;
const newKey = () => `n${++counter}`;

function blank(): MenuDraft {
  return { key: newKey(), label: "", link_type: "home", target_id: "", url: "", children: [] };
}

function toPayload(items: MenuDraft[]): unknown[] {
  const one = (i: MenuDraft) =>
    i.link_type === "filter"
      ? {
          label: i.label.trim(),
          link_type: "url",
          target_id: null,
          url: i.target_id ? filterHref(i.target_id) : null,
        }
      : {
          label: i.label.trim(),
          link_type: i.link_type,
          target_id: (TARGET_TYPES as readonly string[]).includes(i.link_type)
            ? i.target_id || null
            : null,
          url: i.link_type === "url" ? i.url.trim() || null : null,
        };
  return items.map((i) => ({ ...one(i), children: i.children.map(one) }));
}

function move<T>(list: T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (to < 0 || to >= list.length) return list;
  const copy = list.slice();
  [copy[index], copy[to]] = [copy[to]!, copy[index]!];
  return copy;
}

function ItemRow({
  item,
  label,
  targets,
  onChange,
  onRemove,
  onMove,
  canUp,
  canDown,
}: {
  item: MenuDraft;
  label: string;
  targets: TargetOptions;
  onChange: (patch: Partial<MenuDraft>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  canUp: boolean;
  canDown: boolean;
}) {
  const options = (TARGET_TYPES as readonly string[]).includes(item.link_type)
    ? targets[item.link_type as (typeof TARGET_TYPES)[number]]
    : null;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-[13px] font-medium">
        Texto de {label}
        <input
          className={control}
          value={item.label}
          maxLength={60}
          onChange={(e) => onChange({ label: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-medium">
        Destino de {label}
        <select
          className={control}
          value={item.link_type}
          onChange={(e) => onChange({ link_type: e.target.value, target_id: "", url: "" })}
        >
          {Object.entries(LINK_TYPE_LABELS).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </label>
      {options ? (
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          {LINK_TYPE_LABELS[item.link_type]} de {label}
          <select
            className={control}
            value={item.target_id}
            onChange={(e) => onChange({ target_id: e.target.value, stale: false })}
          >
            <option value="">Elige…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {item.link_type === "url" ? (
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          Dirección de {label}
          <input
            className={control}
            value={item.url}
            maxLength={500}
            placeholder="https://… o /ruta"
            onChange={(e) => onChange({ url: e.target.value })}
          />
        </label>
      ) : null}
      {item.stale ? (
        <p className="basis-full text-[13px] text-danger">
          El destino de {label} ya no existe. Elige otro o quita el enlace.
        </p>
      ) : null}
      <div className="flex gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canUp}
          onClick={() => onMove(-1)}
          aria-label={`Subir ${label}`}
        >
          ↑
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canDown}
          onClick={() => onMove(1)}
          aria-label={`Bajar ${label}`}
        >
          ↓
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={`Quitar ${label}`}
        >
          Quitar
        </Button>
      </div>
    </div>
  );
}

export function MenuEditor({
  storeHandle,
  handle,
  title,
  initial,
  targets,
}: {
  storeHandle: string;
  handle: "main" | "footer";
  title: string;
  initial: MenuDraft[];
  targets: TargetOptions;
}) {
  const [items, setItems] = useState<MenuDraft[]>(initial);
  const [state, action, pending] = useSafeActionState<ContentActionState, FormData>(
    saveMenu.bind(null, storeHandle, handle),
    {},
  );
  const total = items.reduce((n, i) => n + 1 + i.children.length, 0);
  const full = total >= MAX_ITEMS;

  const update = (index: number, patch: Partial<MenuDraft>) =>
    setItems((list) => list.map((i, n) => (n === index ? { ...i, ...patch } : i)));
  const updateChild = (index: number, child: number, patch: Partial<MenuDraft>) =>
    setItems((list) =>
      list.map((i, n) =>
        n === index
          ? { ...i, children: i.children.map((c, m) => (m === child ? { ...c, ...patch } : c)) }
          : i,
      ),
    );

  return (
    <form
      action={action}
      className="space-y-4 rounded-md border border-border p-4"
      aria-labelledby={`menu-${handle}`}
    >
      <h2 id={`menu-${handle}`} className="text-lg font-semibold">
        {title}
      </h2>
      <input type="hidden" name="payload" value={JSON.stringify(toPayload(items))} />
      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {handle === "main"
            ? "Sin enlaces: la tienda muestra tus categorías principales."
            : "Sin enlaces: el pie muestra las políticas publicadas."}
        </p>
      ) : null}
      <ol className="space-y-4">
        {items.map((item, index) => {
          const label = `enlace ${index + 1}`;
          return (
            <li key={item.key} className="space-y-2 border-l-2 border-border pl-3">
              <ItemRow
                item={item}
                label={label}
                targets={targets}
                onChange={(patch) => update(index, patch)}
                onRemove={() => setItems((list) => list.filter((_, n) => n !== index))}
                onMove={(delta) => setItems((list) => move(list, index, delta))}
                canUp={index > 0}
                canDown={index < items.length - 1}
              />
              {item.children.length > 0 ? (
                <ol className="space-y-2 pl-6">
                  {item.children.map((child, c) => (
                    <li key={child.key}>
                      <ItemRow
                        item={child}
                        label={`${label}.${c + 1}`}
                        targets={targets}
                        onChange={(patch) => updateChild(index, c, patch)}
                        onRemove={() =>
                          update(index, { children: item.children.filter((_, m) => m !== c) })
                        }
                        onMove={(delta) =>
                          update(index, { children: move(item.children, c, delta) })
                        }
                        canUp={c > 0}
                        canDown={c < item.children.length - 1}
                      />
                    </li>
                  ))}
                </ol>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={full}
                onClick={() => update(index, { children: [...item.children, blank()] })}
              >
                Agregar subenlace a {label}
              </Button>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={full}
          onClick={() => setItems((l) => [...l, blank()])}
        >
          Agregar enlace
        </Button>
        <Button type="submit" size="sm" loading={pending}>
          Guardar {title.toLowerCase()}
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
