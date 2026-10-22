"use client";

import { useId, useState } from "react";

import { contrastRatio } from "@/lib/color/contrast";
import {
  COLOR_KEYS,
  DEFAULT_COLORS,
  resolvePalette,
  suggestContrastFix,
  themeContrastIssues,
  type Palette,
} from "@/lib/theme/palette";
import { THEME_PRESETS } from "@/lib/theme/presets";
import type { ThemeSettings } from "@/lib/theme/schema";
import { Button } from "@/ui/primitives/button";
import { submitKeepingState } from "@/ui/submit";
import { useSafeActionState } from "@/ui/use-safe-action-state";

import type { FormState } from "../_shared/action-state";
import { FormFeedback } from "../_shared/form-feedback";
import { saveColors } from "./colors-actions";

/**
 * Portada → Colores (misión Panel, Paso C). Solo colores: la paleta de la
 * tienda, el color de oferta, colores propios por elemento y por bloque.
 * Cambiar algo aquí no mueve ni cambia ningún bloque (eso es Diseño). Todo
 * par de texto y fondo se revisa al momento (≥ 4.5:1) con un color sugerido;
 * la base lo vuelve a revisar al guardar y al publicar.
 */
type Pair = { on: boolean; bg: string; fg: string; active?: string; border?: string };
type ElementKey = "hero" | "header" | "nav_bar" | "cards" | "buttons" | "footer";

const ELEMENTS: { key: ElementKey; name: string; hint: string }[] = [
  { key: "header", name: "Encabezado", hint: "Logo, buscador y carrito." },
  { key: "nav_bar", name: "Barra de categorías", hint: "La franja con Todos, Energía…" },
  { key: "hero", name: "Portada principal", hint: "El primer bloque grande." },
  { key: "cards", name: "Tarjetas de producto", hint: "Fondo y texto de cada producto." },
  { key: "buttons", name: "Botones", hint: "Agregar al carrito, Comprar…" },
  { key: "footer", name: "Pie de página", hint: "La franja final de la tienda." },
];

const COLOR_NAMES: Record<(typeof COLOR_KEYS)[number], string> = {
  primary: "Principal (botones)",
  accent: "Acento",
  background: "Fondo",
  foreground: "Texto",
  muted: "Texto secundario",
};

const HEX = /^#[0-9a-f]{6}$/;
const safe = (value: string | undefined, fallback: string) =>
  value && HEX.test(value) ? value : fallback;

export interface BlockColorRow {
  id: string;
  label: string;
  colors?: { background: string; foreground: string } | undefined;
}

export function ColorsEditor({
  storeHandle,
  revision,
  settings,
  blocks,
  nonce,
}: {
  storeHandle: string;
  revision: number;
  settings: ThemeSettings;
  blocks: BlockColorRow[];
  nonce: string | undefined;
}) {
  const id = useId();
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    saveColors.bind(null, storeHandle),
    {},
  );
  const [palette, setPalette] = useState<Palette>(resolvePalette(settings.colors));
  const [saleOn, setSaleOn] = useState(Boolean(settings.colors?.sale));
  const [sale, setSale] = useState(settings.colors?.sale ?? "#b91c1c");
  const initialElements = Object.fromEntries(
    ELEMENTS.map(({ key }) => {
      const c = settings.element_colors?.[key] as
        { background: string; foreground: string; active?: string; border?: string } | undefined;
      return [
        key,
        {
          on: Boolean(c),
          bg: c?.background ?? "#ffffff",
          fg: c?.foreground ?? "#111827",
          ...(key === "nav_bar"
            ? { active: c?.active ?? "#1d4ed8", border: c?.border ?? "#e5e7eb" }
            : {}),
        },
      ];
    }),
  ) as Record<ElementKey, Pair>;
  const [elements, setElements] = useState(initialElements);
  const [blockColors, setBlockColors] = useState<Record<string, Pair>>(
    Object.fromEntries(
      blocks.map((b) => [
        b.id,
        {
          on: Boolean(b.colors),
          bg: b.colors?.background ?? "#f3f4f6",
          fg: b.colors?.foreground ?? "#111827",
        },
      ]),
    ),
  );
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");

  const setElement = (key: ElementKey, change: Partial<Pair>) =>
    setElements((all) => ({ ...all, [key]: { ...all[key], ...change } }));
  const setBlock = (blockId: string, change: Partial<Pair>) =>
    setBlockColors((all) => ({ ...all, [blockId]: { ...all[blockId]!, ...change } }));

  const issues = new Set(
    themeContrastIssues({
      colors: { ...palette, ...(saleOn ? { sale } : {}) },
      shape: { button_style: settings.shape?.button_style ?? "solid" },
      element_colors: Object.fromEntries(
        ELEMENTS.filter(({ key }) => elements[key].on).map(({ key }) => [
          key,
          {
            background: elements[key].bg,
            foreground: elements[key].fg,
            ...(key === "nav_bar" ? { active: elements[key].active } : {}),
          },
        ]),
      ),
    }),
  );
  const blockIssues = blocks.filter(
    (b) =>
      blockColors[b.id]?.on && contrastRatio(blockColors[b.id]!.fg, blockColors[b.id]!.bg) < 4.5,
  );
  const problems = issues.size + blockIssues.length;

  const blocksPayload = Object.fromEntries(
    blocks.map((b) => {
      const c = blockColors[b.id]!;
      return [b.id, c.on ? { background: c.bg, foreground: c.fg } : null];
    }),
  );

  // Vista previa en vivo: variables de una muestra de la tienda (solo hex).
  const el = (key: ElementKey, fallbackBg: string, fallbackFg: string) =>
    elements[key].on
      ? { bg: safe(elements[key].bg, fallbackBg), fg: safe(elements[key].fg, fallbackFg) }
      : { bg: fallbackBg, fg: fallbackFg };
  const p = {
    bg: safe(palette.background, DEFAULT_COLORS.background),
    fg: safe(palette.foreground, DEFAULT_COLORS.foreground),
    primary: safe(palette.primary, DEFAULT_COLORS.primary),
    muted: safe(palette.muted, DEFAULT_COLORS.muted),
  };
  const header = el("header", p.bg, p.fg);
  const nav = el("nav_bar", p.bg, p.fg);
  const hero = el("hero", p.primary, "#ffffff");
  const card = el("cards", p.bg, p.fg);
  const button = el("buttons", p.primary, "#ffffff");
  const footer = el("footer", p.fg, p.bg);
  const navActive = elements.nav_bar.on ? safe(elements.nav_bar.active, nav.fg) : p.primary;
  const saleColor = saleOn ? safe(sale, "#b91c1c") : "#b91c1c";
  const css = [
    `.cp-root{background:${p.bg};color:${p.fg}}`,
    `.cp-header{background:${header.bg};color:${header.fg}}`,
    `.cp-nav{background:${nav.bg};color:${nav.fg}}`,
    `.cp-nav-active{color:${navActive};border-color:${navActive}}`,
    `.cp-hero{background:${hero.bg};color:${hero.fg}}`,
    `.cp-card{background:${card.bg};color:${card.fg}}`,
    `.cp-muted{color:${p.muted}}`,
    `.cp-button{background:${button.bg};color:${button.fg}}`,
    `.cp-sale{color:${saleColor}}`,
    `.cp-footer{background:${footer.bg};color:${footer.fg}}`,
  ].join("");

  function applyPreset(key: string) {
    const preset = THEME_PRESETS.find((t) => t.key === key);
    if (preset) setPalette({ ...preset.colors });
  }
  function reset() {
    setPalette({ ...DEFAULT_COLORS });
    setSaleOn(false);
    setElements(
      (all) =>
        Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { ...v, on: false }])) as Record<
          ElementKey,
          Pair
        >,
    );
    setBlockColors((all) =>
      Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { ...v, on: false }])),
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <form
        action={action}
        onSubmit={submitKeepingState(action)}
        className="min-w-0 space-y-6"
        noValidate
      >
        <input type="hidden" name="revision" value={revision} />
        <input type="hidden" name="block_colors" value={JSON.stringify(blocksPayload)} />

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Paletas listas (un toque)</legend>
          <div className="flex flex-wrap gap-2">
            {THEME_PRESETS.map((preset) => (
              <Button
                key={preset.key}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => applyPreset(preset.key)}
              >
                {preset.name}
              </Button>
            ))}
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              Restablecer colores
            </Button>
          </div>
          <p className="text-[13px] text-fg-muted">
            Cambiar los colores no mueve ningún bloque. Nada se publica hasta que tú lo publiques.
          </p>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Colores de toda la tienda</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {COLOR_KEYS.map((key) => (
              <ColorInput
                key={key}
                id={`${id}-${key}`}
                name={key}
                label={COLOR_NAMES[key]}
                value={palette[key]}
                onChange={(value) => setPalette((all) => ({ ...all, [key]: value }))}
                problem={
                  issues.has(key)
                    ? {
                        message: `No se lee sobre el fondo.`,
                        fix: suggestContrastFix(
                          palette[key],
                          palette.background,
                          key === "primary" || key === "accent" ? 3 : 4.5,
                        ),
                      }
                    : null
                }
                error={state.fields?.[key]}
              />
            ))}
            <div className="space-y-2">
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="sale_on"
                  value="1"
                  checked={saleOn}
                  onChange={(e) => setSaleOn(e.target.checked)}
                />
                Color propio para ofertas
              </label>
              {saleOn ? (
                <ColorInput
                  id={`${id}-sale`}
                  name="sale"
                  label="Ofertas (precio rebajado y ahorro)"
                  value={sale}
                  onChange={setSale}
                  problem={
                    issues.has("sale")
                      ? {
                          message: "No se lee sobre el fondo.",
                          fix: suggestContrastFix(sale, palette.background, 4.5),
                        }
                      : null
                  }
                  error={state.fields?.sale}
                />
              ) : null}
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Colores por parte de la tienda</legend>
          <ul className="space-y-3">
            {ELEMENTS.map(({ key, name, hint }) => {
              const c = elements[key];
              const problem = issues.has(`element_colors.${key}`);
              return (
                <li key={key} className="space-y-2 rounded-md border border-border p-3">
                  <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      name={`el_${key}_on`}
                      value="1"
                      checked={c.on}
                      onChange={(e) => setElement(key, { on: e.target.checked })}
                    />
                    {name}: colores propios
                    <span className="font-normal text-fg-muted">— {hint}</span>
                  </label>
                  {c.on ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ColorInput
                        id={`${id}-${key}-bg`}
                        name={`el_${key}_bg`}
                        label={`Fondo de ${name.toLowerCase()}`}
                        value={c.bg}
                        onChange={(bg) => setElement(key, { bg })}
                        error={state.fields?.[`el_${key}_bg`]}
                      />
                      <ColorInput
                        id={`${id}-${key}-fg`}
                        name={`el_${key}_fg`}
                        label={`Texto de ${name.toLowerCase()}`}
                        value={c.fg}
                        onChange={(fg) => setElement(key, { fg })}
                        problem={
                          problem
                            ? {
                                message: "No se lee sobre su fondo.",
                                fix: suggestContrastFix(c.fg, c.bg, 4.5),
                              }
                            : null
                        }
                        error={state.fields?.[`el_${key}_fg`]}
                      />
                      {key === "nav_bar" ? (
                        <>
                          <ColorInput
                            id={`${id}-nav-active`}
                            name="el_nav_bar_active"
                            label="Elemento activo de la barra"
                            value={c.active ?? c.fg}
                            onChange={(active) => setElement(key, { active })}
                            problem={
                              issues.has("element_colors.nav_bar.active")
                                ? {
                                    message: "No se lee sobre el fondo de la barra.",
                                    fix: suggestContrastFix(c.active ?? c.fg, c.bg, 4.5),
                                  }
                                : null
                            }
                            error={state.fields?.el_nav_bar_active}
                          />
                          <ColorInput
                            id={`${id}-nav-border`}
                            name="el_nav_bar_border"
                            label="Borde de la barra"
                            value={c.border ?? "#e5e7eb"}
                            onChange={(border) => setElement(key, { border })}
                          />
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className="text-[13px] text-fg-muted">
            La barra de anuncio tiene sus propios colores en Encabezado y pie.
          </p>
        </fieldset>

        {blocks.length > 0 ? (
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">Colores de cada bloque de la portada</legend>
            <ul className="space-y-3">
              {blocks.map((block) => {
                const c = blockColors[block.id]!;
                const bad = c.on && contrastRatio(c.fg, c.bg) < 4.5;
                return (
                  <li key={block.id} className="space-y-2 rounded-md border border-border p-3">
                    <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={c.on}
                        onChange={(e) => setBlock(block.id, { on: e.target.checked })}
                      />
                      {block.label}: fondo propio
                    </label>
                    {c.on ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <ColorInput
                          id={`${id}-b-${block.id}-bg`}
                          label={`Fondo de ${block.label}`}
                          value={c.bg}
                          onChange={(bg) => setBlock(block.id, { bg })}
                        />
                        <ColorInput
                          id={`${id}-b-${block.id}-fg`}
                          label={`Texto de ${block.label}`}
                          value={c.fg}
                          onChange={(fg) => setBlock(block.id, { fg })}
                          problem={
                            bad
                              ? {
                                  message: "No se lee sobre su fondo.",
                                  fix: suggestContrastFix(c.fg, c.bg, 4.5),
                                }
                              : null
                          }
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          {problems > 0 ? (
            <p role="alert" className="basis-full text-sm text-danger">
              {problems === 1
                ? "Hay un color que no se lee. Usa el sugerido antes de guardar."
                : `Hay ${problems} colores que no se leen. Usa los sugeridos antes de guardar.`}
            </p>
          ) : null}
          <Button type="submit" loading={pending} disabled={problems > 0}>
            Guardar colores en el borrador
          </Button>
          <FormFeedback state={state} />
        </div>
      </form>

      <aside
        aria-labelledby={`${id}-preview`}
        className="space-y-3 lg:sticky lg:top-4 lg:self-start"
      >
        <style nonce={nonce}>{css}</style>
        <div className="flex items-center justify-between gap-2">
          <h2 id={`${id}-preview`} className="text-sm font-semibold">
            Vista previa en vivo
          </h2>
          <div role="group" aria-label="Dispositivo" className="flex gap-1">
            {(["mobile", "desktop"] as const).map((d) => (
              <Button
                key={d}
                type="button"
                size="sm"
                variant={device === d ? "primary" : "ghost"}
                aria-pressed={device === d}
                onClick={() => setDevice(d)}
              >
                {d === "mobile" ? "Celular" : "Computadora"}
              </Button>
            ))}
          </div>
        </div>
        <div
          aria-hidden="true"
          className={`cp-root mx-auto overflow-hidden rounded-md border border-border text-[11px] ${
            device === "mobile" ? "max-w-[15rem]" : "w-full"
          }`}
        >
          <div className="cp-header flex items-center justify-between px-3 py-2 font-bold">
            <span>Tu tienda</span>
            <span>Carrito</span>
          </div>
          <div className="cp-nav flex gap-3 px-3 py-1.5">
            <span className="cp-nav-active border-b-2 font-bold">Todos</span>
            <span>Energía</span>
            <span>Fuerza</span>
          </div>
          <div className="cp-hero m-2 rounded p-3">
            <p className="text-sm font-extrabold">Portada principal</p>
            <p>Texto de la portada</p>
          </div>
          <div className={`grid gap-2 p-2 ${device === "mobile" ? "grid-cols-2" : "grid-cols-4"}`}>
            {[0, 1].map((n) => (
              <div key={n} className="cp-card rounded border border-border p-2">
                <p className="font-semibold">Producto</p>
                <p className="cp-muted">30 porciones</p>
                <p className="cp-sale font-bold">$499.00</p>
                <span className="cp-button mt-1 block rounded px-2 py-1 text-center font-bold">
                  Agregar
                </span>
              </div>
            ))}
          </div>
          <div className="cp-footer px-3 py-3">Pie de página</div>
        </div>
        <p className="text-[13px] text-fg-muted">
          Es una muestra. La tienda completa con tus colores está en «Vista previa».
        </p>
      </aside>
    </div>
  );
}

function ColorInput({
  id,
  name,
  label,
  value,
  onChange,
  problem = null,
  error,
}: {
  id: string;
  name?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  problem?: { message: string; fix: string } | null;
  error?: string | undefined;
}) {
  const message = error ?? problem?.message;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          name={name}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `${id}-msg` : undefined}
          className="h-11 w-20 rounded border border-control bg-surface p-1"
        />
        <span className="font-mono text-[13px]">{value}</span>
        {problem ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => onChange(problem.fix)}>
            Usar sugerido ({problem.fix})
          </Button>
        ) : null}
      </div>
      {message ? (
        <p id={`${id}-msg`} className="text-[13px] text-danger">
          {message}
        </p>
      ) : null}
    </div>
  );
}
