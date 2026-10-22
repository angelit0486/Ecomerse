"use client";

import { useId, useState } from "react";

import { MAX_NAV_ITEMS } from "@/lib/theme/constants";
import type { NavBarSettings } from "@/lib/theme/schema";
import { Button } from "@/ui/primitives/button";

import { nativeControl } from "../productos/styles";
import type { NavPick } from "./home-options";

/**
 * Editor de la barra de categorías del encabezado (misión Panel, Paso D): qué
 * enlaces aparecen (categorías, objetivos, ofertas, marcas, páginas o enlaces
 * propios), su orden (arrastrar o ↑ ↓ con teclado), nombre y en qué
 * dispositivos; y el estilo de la barra. Los colores van en Portada → Colores.
 * Se envía con el formulario de Encabezado y pie.
 */
type Item = { label: string; link: string; visibility: "all" | "mobile" | "desktop" };

const VISIBILITY_LABELS: Record<Item["visibility"], string> = {
  all: "Celular y computadora",
  mobile: "Solo celular",
  desktop: "Solo computadora",
};

export function NavBarEditor({
  initial,
  legacy,
  picks,
  errors,
}: {
  initial: NavBarSettings | undefined;
  /** Accesos rápidos de antes (tema v2): se pasan a la barra al editarla. */
  legacy: { label: string; link: string }[] | undefined;
  picks: NavPick[];
  errors?: string | undefined;
}) {
  const id = useId();
  const [items, setItems] = useState<Item[]>(
    (initial?.items ?? legacy ?? []).map(
      (i: { label: string; link: string; visibility?: Item["visibility"] }) => ({
        label: i.label,
        link: i.link,
        visibility: i.visibility ?? "all",
      }),
    ),
  );
  const [pick, setPick] = useState("");
  const [dragging, setDragging] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const full = items.length >= MAX_NAV_ITEMS;

  function update(index: number, change: Partial<Item>) {
    setItems((all) => all.map((item, i) => (i === index ? { ...item, ...change } : item)));
  }
  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    setItems(next);
    setAnnouncement(`«${item!.label}» movido a la posición ${target + 1} de ${next.length}.`);
    requestAnimationFrame(() =>
      document.getElementById(`${id}-${target}-${delta < 0 ? "up" : "down"}`)?.focus(),
    );
  }
  function drop(target: number) {
    if (dragging === null || dragging === target) return setDragging(null);
    const next = [...items];
    const [item] = next.splice(dragging, 1);
    next.splice(target, 0, item!);
    setItems(next);
    setDragging(null);
    setAnnouncement(`«${item!.label}» movido a la posición ${target + 1} de ${next.length}.`);
  }
  function addPick() {
    const found = picks.find((p) => `${p.group}|${p.link}` === pick);
    if (!found || full) return;
    setItems((all) => [...all, { label: found.label, link: found.link, visibility: "all" }]);
    setAnnouncement(`«${found.label}» agregado al final.`);
    setPick("");
  }

  const groups = [...new Set(picks.map((p) => p.group))];
  return (
    <fieldset className="space-y-3">
      <legend className="text-[13px] font-medium">
        Barra de categorías (debajo del encabezado)
      </legend>
      <p className="text-[13px] text-fg-muted">
        Hasta {MAX_NAV_ITEMS} enlaces. Sin elegir ninguno, se arma sola con tus ofertas, lo más
        vendido y tu menú.
      </p>
      <input type="hidden" name="nav_present" value="1" />
      <input type="hidden" name="nav_items" value={JSON.stringify(items)} />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {errors ? (
        <p role="alert" className="text-sm text-danger">
          {errors}
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${id}-pick`} className="text-[13px] font-medium">
            Agregar a la barra
          </label>
          <select
            id={`${id}-pick`}
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className={`${nativeControl} w-full`}
          >
            <option value="">Elige un destino…</option>
            {groups.map((group) => (
              <optgroup key={group} label={group}>
                {picks
                  .filter((p) => p.group === group)
                  .map((p) => (
                    <option key={`${p.group}|${p.link}`} value={`${p.group}|${p.link}`}>
                      {p.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!pick || full}
          onClick={addPick}
        >
          Agregar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={full}
          onClick={() => {
            setItems((all) => [...all, { label: "", link: "", visibility: "all" }]);
            setAnnouncement("Enlace propio agregado al final: escribe su nombre y dirección.");
          }}
        >
          Enlace propio
        </Button>
      </div>
      {items.length > 0 ? (
        <ol aria-label="Enlaces de la barra" className="space-y-2">
          {items.map((item, index) => (
            <li
              key={index}
              className={`grid gap-2 rounded-md border p-2 sm:grid-cols-[auto_1fr_1fr_auto_auto] sm:items-end ${
                dragging === index ? "border-accent opacity-60" : "border-border"
              }`}
              onDragOver={(e) => {
                if (dragging !== null) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(index);
              }}
            >
              <span
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  setDragging(index);
                }}
                onDragEnd={() => setDragging(null)}
                className="hidden cursor-grab select-none self-center px-1 text-fg-muted sm:block"
                title="Arrastra para cambiar el orden"
                aria-hidden="true"
              >
                ⠿
              </span>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-${index}-label`} className="text-[13px] font-medium">
                  Nombre {index + 1}
                </label>
                <input
                  id={`${id}-${index}-label`}
                  value={item.label}
                  maxLength={30}
                  onChange={(e) => update(index, { label: e.target.value })}
                  className={nativeControl}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-${index}-link`} className="text-[13px] font-medium">
                  Enlace {index + 1}
                </label>
                <input
                  id={`${id}-${index}-link`}
                  value={item.link}
                  placeholder="/categoria/proteinas"
                  onChange={(e) => update(index, { link: e.target.value })}
                  className={nativeControl}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-${index}-vis`} className="text-[13px] font-medium">
                  Dónde se ve
                </label>
                <select
                  id={`${id}-${index}-vis`}
                  value={item.visibility}
                  onChange={(e) =>
                    update(index, { visibility: e.target.value as Item["visibility"] })
                  }
                  className={nativeControl}
                >
                  {Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  id={`${id}-${index}-up`}
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Subir ${item.label || `enlace ${index + 1}`}`}
                >
                  ↑
                </Button>
                <Button
                  id={`${id}-${index}-down`}
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Bajar ${item.label || `enlace ${index + 1}`}`}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setItems((all) => all.filter((_, i) => i !== index));
                    setAnnouncement(`«${item.label || `Enlace ${index + 1}`}» quitado.`);
                  }}
                  aria-label={`Quitar ${item.label || `enlace ${index + 1}`}`}
                >
                  Quitar
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          id={`${id}-style`}
          name="nav_style"
          label="Estilo"
          initial={initial?.style ?? "text"}
          options={[
            ["text", "Texto simple"],
            ["pills", "Píldoras"],
            ["photos", "Con foto de la categoría"],
          ]}
        />
        <SelectField
          id={`${id}-visibility`}
          name="nav_visibility"
          label="Dónde se ve la barra"
          initial={initial?.visibility ?? "mobile"}
          options={[
            ["mobile", "Solo en el celular"],
            ["all", "En el celular y la computadora"],
          ]}
        />
        <SelectField
          id={`${id}-align`}
          name="nav_align"
          label="Alineación"
          initial={initial?.align ?? "start"}
          options={[
            ["start", "A la izquierda"],
            ["center", "Centrada"],
          ]}
        />
        <SelectField
          id={`${id}-size`}
          name="nav_size"
          label="Tamaño de letra"
          initial={initial?.size ?? "sm"}
          options={[
            ["sm", "Normal"],
            ["md", "Grande"],
          ]}
        />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="nav_sticky"
          value="1"
          defaultChecked={initial?.sticky === true}
        />
        Fija arriba al bajar por la página
      </label>
    </fieldset>
  );
}

function SelectField({
  id,
  name,
  label,
  initial,
  options,
}: {
  id: string;
  name: string;
  label: string;
  initial: string;
  options: [string, string][];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </label>
      <select id={id} name={name} defaultValue={initial} className={nativeControl}>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}
