"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES } from "@/lib/media/constants";
import {
  BENEFIT_ICONS,
  MAX_PRODUCT_SECTIONS,
  MAX_SECTIONS,
  type BenefitIcon,
  type Visibility,
} from "@/lib/theme/constants";
import type { HomeSectionType } from "@/lib/theme/schema";
import { Button } from "@/ui/primitives/button";

import { FormFeedback } from "../_shared/form-feedback";
import { submitKeepingState } from "@/ui/submit";
import { nativeControl } from "../productos/styles";
import { HomePreview } from "./home-preview";
import {
  finalizeBannerUpload,
  requestBannerUpload,
  saveHomeDraft,
  type HomeFormState,
} from "./home-actions";
import { useSafeActionState } from "@/ui/use-safe-action-state";

/**
 * Editor de la portada (F9-T02 y ADR-034): agregar, editar, ocultar, duplicar,
 * eliminar y ordenar los bloques (arrastrando o con botones, accesible con
 * teclado), elegir en qué dispositivos se ven y entre qué fechas. Se guarda la
 * lista completa en el borrador.
 */
type Props = Record<string, unknown>;
export interface EditorSection {
  id: string;
  type: HomeSectionType;
  enabled: boolean;
  props: Props;
  visibility?: Visibility;
  starts_at?: string;
  ends_at?: string;
}

export interface HomeEditorOptions {
  banners: { id: string; url: string; alt: string | null }[];
  categories: { id: string; name: string }[];
  brands: { id: string; name: string; hasLogo: boolean }[];
  goals: { id: string; label: string }[];
  products: { id: string; title: string }[];
}

export const SECTION_LABELS: Record<HomeSectionType, string> = {
  hero: "Portada principal",
  featured_products: "Productos destacados",
  category_grid: "Categorías",
  promo_banner: "Banner de promoción",
  image_with_text: "Imagen con texto",
  brand_logos: "Marcas",
  testimonials: "Testimonios (escritos por ti)",
  rich_text: "Texto con formato",
  faq: "Preguntas frecuentes",
  benefits: "Beneficios y confianza",
  goals: "Compra por objetivo",
  reviews: "Opiniones verificadas",
  video: "Video",
  contact_map: "Contacto y ubicación",
};

export const BENEFIT_ICON_LABELS: Record<BenefitIcon, string> = {
  truck: "Envío",
  shield: "Compra segura",
  return: "Devoluciones",
  chat: "Atención personal",
  star: "Calidad",
  leaf: "Natural",
  lab: "Probado en laboratorio",
  card: "Formas de pago",
  gift: "Regalo",
  clock: "Rapidez",
};

const VISIBILITY_LABELS: Record<Visibility, string> = {
  all: "Celular y computadora",
  mobile: "Solo en el celular",
  desktop: "Solo en la computadora",
};

const DEFAULTS: Record<HomeSectionType, Props> = {
  hero: {
    heading: "",
    subheading: "",
    align: "center",
    image_media_id: "",
    cta: { label: "", link: "" },
  },
  featured_products: { title: "", source: { type: "newest" }, limit: 8, show_view_all: true },
  category_grid: { title: "Categorías", category_ids: [] },
  promo_banner: { image_media_id: "", heading: "", text: "", cta: { label: "", link: "" } },
  image_with_text: {
    image_media_id: "",
    heading: "",
    body: "",
    image_position: "left",
    cta: { label: "", link: "" },
  },
  brand_logos: { title: "Nuestras marcas", brand_ids: [] },
  testimonials: { title: "", items: [{ quote: "", author: "", detail: "" }] },
  rich_text: { heading: "", html: "" },
  faq: { title: "Preguntas frecuentes", items: [{ question: "", answer: "" }] },
  benefits: { title: "", items: [{ icon: "truck", title: "", text: "" }] },
  goals: { title: "Compra por objetivo", value_ids: [] },
  reviews: { title: "Lo que dicen nuestros clientes", limit: 6 },
  video: { provider: "youtube", video_id: "", title: "", caption: "" },
  contact_map: { title: "Visítanos", show_whatsapp: true },
};

const SOURCE_LABELS = {
  newest: "Novedades",
  best_selling: "Más vendidos",
  category: "De una categoría",
  brand: "De una marca",
  attribute_value: "De un objetivo (u otro filtro)",
  manual: "Elegidos a mano",
} as const;

/** «2026-11-17T06:00:00.000Z» ↔ valor de un input datetime-local en la hora del dispositivo. */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

const label = "text-[13px] font-medium text-fg";
const control = `${nativeControl} w-full`;

function TextField({
  id,
  text,
  value,
  onChange,
  maxLength,
  multiline,
  hint,
}: {
  id: string;
  text: string;
  value: string;
  onChange: (v: string) => void;
  maxLength: number;
  multiline?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={label}>
        {text}
      </label>
      {multiline ? (
        <textarea
          id={id}
          rows={4}
          maxLength={maxLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${control} h-auto py-2`}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
      ) : (
        <input
          id={id}
          maxLength={maxLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={control}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
      )}
      {hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function ImagePicker({
  id,
  value,
  onChange,
  banners,
  required,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  banners: HomeEditorOptions["banners"];
  required?: boolean;
}) {
  return (
    <fieldset>
      <legend className={label}>Imagen{required ? " (obligatoria)" : " (opcional)"}</legend>
      {banners.length === 0 ? (
        <p className="text-[13px] text-fg-muted">Sube una imagen abajo para usarla aquí.</p>
      ) : null}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {required ? null : (
          <label className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
            <input type="radio" name={id} checked={value === ""} onChange={() => onChange("")} />
            Sin imagen
          </label>
        )}
        {banners.map((b) => (
          <label
            key={b.id}
            className="flex flex-col gap-1 rounded-md border border-border p-2 text-sm"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- imagen ya re-codificada */}
            <img src={b.url} alt="" className="aspect-[16/9] w-full rounded object-cover" />
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name={id}
                checked={value === b.id}
                onChange={() => onChange(b.id)}
              />
              {b.alt || "Imagen sin descripción"}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CtaFields({
  id,
  cta,
  onChange,
}: {
  id: string;
  cta: { label?: string; link?: string } | undefined;
  onChange: (v: { label: string; link: string }) => void;
}) {
  const value = { label: cta?.label ?? "", link: cta?.link ?? "" };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField
        id={`${id}-cta-label`}
        text="Texto del botón (opcional)"
        value={value.label}
        maxLength={30}
        onChange={(label) => onChange({ ...value, label })}
      />
      <TextField
        id={`${id}-cta-link`}
        text="Enlace del botón"
        value={value.link}
        maxLength={500}
        hint="Una ruta de tu tienda (/productos?objetivo=energia) o https://…"
        onChange={(link) => onChange({ ...value, link })}
      />
    </div>
  );
}

function SectionFields({
  section,
  options,
  update,
}: {
  section: EditorSection;
  options: HomeEditorOptions;
  update: (props: Props) => void;
}) {
  const p = section.props;
  const id = `s-${section.id}`;
  const set = (key: string) => (value: unknown) => update({ ...p, [key]: value });
  const str = (key: string) => (typeof p[key] === "string" ? (p[key] as string) : "");
  const list = (key: string) => (Array.isArray(p[key]) ? (p[key] as string[]) : []);
  const toggle = (key: string, value: string, on: boolean) =>
    update({
      ...p,
      [key]: on ? [...list(key), value] : list(key).filter((v) => v !== value),
    });

  switch (section.type) {
    case "hero":
      return (
        <div className="space-y-3">
          <TextField
            id={`${id}-heading`}
            text="Título"
            value={str("heading")}
            maxLength={80}
            onChange={set("heading")}
          />
          <TextField
            id={`${id}-sub`}
            text="Subtítulo (opcional)"
            value={str("subheading")}
            maxLength={200}
            onChange={set("subheading")}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-align`} className={label}>
              Alineación
            </label>
            <select
              id={`${id}-align`}
              value={str("align")}
              onChange={(e) => set("align")(e.target.value)}
              className={control}
            >
              <option value="center">Centrado</option>
              <option value="left">A la izquierda</option>
            </select>
          </div>
          <ImagePicker
            id={`${id}-img`}
            value={str("image_media_id")}
            onChange={set("image_media_id")}
            banners={options.banners}
          />
          <CtaFields id={id} cta={p.cta as never} onChange={set("cta")} />
        </div>
      );
    case "featured_products": {
      const source = (p.source ?? { type: "newest" }) as {
        type: keyof typeof SOURCE_LABELS;
        id?: string;
        product_ids?: string[];
      };
      const needsId =
        source.type === "category" || source.type === "brand" || source.type === "attribute_value";
      const picked = Array.isArray(source.product_ids) ? source.product_ids : [];
      const choices =
        source.type === "category"
          ? options.categories.map((c) => ({ id: c.id, label: c.name }))
          : source.type === "brand"
            ? options.brands.map((b) => ({ id: b.id, label: b.name }))
            : options.goals;
      return (
        <div className="space-y-3">
          <TextField
            id={`${id}-title`}
            text="Título"
            value={str("title")}
            maxLength={60}
            onChange={set("title")}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-src`} className={label}>
                Qué productos mostrar
              </label>
              <select
                id={`${id}-src`}
                value={source.type}
                onChange={(e) =>
                  set("source")(
                    e.target.value === "manual"
                      ? { type: "manual", product_ids: [] }
                      : { type: e.target.value },
                  )
                }
                className={control}
              >
                {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            {needsId ? (
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-src-id`} className={label}>
                  {source.type === "category"
                    ? "Categoría"
                    : source.type === "brand"
                      ? "Marca"
                      : "Objetivo"}
                </label>
                <select
                  id={`${id}-src-id`}
                  value={source.id ?? ""}
                  onChange={(e) => set("source")({ type: source.type, id: e.target.value })}
                  className={control}
                >
                  <option value="">Elige una opción</option>
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          {source.type === "manual" ? (
            <ProductPicker
              id={`${id}-picked`}
              products={options.products}
              value={picked}
              onChange={(ids) => set("source")({ type: "manual", product_ids: ids })}
            />
          ) : null}
          <LayoutSelect id={id} value={str("layout")} onChange={set("layout")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-limit`} className={label}>
                Cuántos productos (4 a 12)
              </label>
              <input
                id={`${id}-limit`}
                type="number"
                min={4}
                max={12}
                value={Number(p.limit ?? 8)}
                onChange={(e) => set("limit")(Math.trunc(Number(e.target.value)))}
                className={control}
              />
            </div>
            <label className="flex items-center gap-2 self-end text-sm">
              <input
                type="checkbox"
                checked={p.show_view_all !== false}
                onChange={(e) => set("show_view_all")(e.target.checked)}
              />
              Mostrar «Ver todos»
            </label>
          </div>
        </div>
      );
    }
    case "category_grid":
      return (
        <div className="space-y-3">
          <TextField
            id={`${id}-title`}
            text="Título"
            value={str("title")}
            maxLength={60}
            onChange={set("title")}
          />
          <LayoutSelect id={id} value={str("layout")} onChange={set("layout")} />
          <fieldset>
            <legend className={label}>Categorías (sin marcar: las principales)</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {options.categories.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={list("category_ids").includes(c.id)}
                    onChange={(e) => toggle("category_ids", c.id, e.target.checked)}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      );
    case "promo_banner":
      return (
        <div className="space-y-3">
          <ImagePicker
            id={`${id}-img`}
            value={str("image_media_id")}
            onChange={set("image_media_id")}
            banners={options.banners}
            required
          />
          <TextField
            id={`${id}-heading`}
            text="Título (opcional)"
            value={str("heading")}
            maxLength={80}
            onChange={set("heading")}
          />
          <TextField
            id={`${id}-text`}
            text="Texto (opcional)"
            value={str("text")}
            maxLength={200}
            onChange={set("text")}
          />
          <CtaFields id={id} cta={p.cta as never} onChange={set("cta")} />
        </div>
      );
    case "image_with_text":
      return (
        <div className="space-y-3">
          <ImagePicker
            id={`${id}-img`}
            value={str("image_media_id")}
            onChange={set("image_media_id")}
            banners={options.banners}
            required
          />
          <TextField
            id={`${id}-heading`}
            text="Título"
            value={str("heading")}
            maxLength={80}
            onChange={set("heading")}
          />
          <TextField
            id={`${id}-body`}
            text="Texto"
            value={str("body")}
            maxLength={600}
            multiline
            onChange={set("body")}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-pos`} className={label}>
              Imagen
            </label>
            <select
              id={`${id}-pos`}
              value={str("image_position")}
              onChange={(e) => set("image_position")(e.target.value)}
              className={control}
            >
              <option value="left">A la izquierda</option>
              <option value="right">A la derecha</option>
            </select>
          </div>
          <CtaFields id={id} cta={p.cta as never} onChange={set("cta")} />
        </div>
      );
    case "brand_logos":
      return (
        <div className="space-y-3">
          <TextField
            id={`${id}-title`}
            text="Título"
            value={str("title")}
            maxLength={60}
            onChange={set("title")}
          />
          <fieldset>
            <legend className={label}>Marcas (de 2 a 12, con logo)</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {options.brands
                .filter((b) => b.hasLogo)
                .map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={list("brand_ids").includes(b.id)}
                      onChange={(e) => toggle("brand_ids", b.id, e.target.checked)}
                    />
                    {b.name}
                  </label>
                ))}
            </div>
            {options.brands.some((b) => !b.hasLogo) ? (
              <p className="mt-2 text-[13px] text-fg-muted">
                Las marcas sin logo no aparecen aquí.
              </p>
            ) : null}
          </fieldset>
        </div>
      );
    case "testimonials": {
      const items = (Array.isArray(p.items) ? p.items : []) as {
        quote: string;
        author: string;
        detail?: string;
      }[];
      const setItem = (i: number, patch: Partial<(typeof items)[number]>) =>
        update({ ...p, items: items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
      return (
        <div className="space-y-3">
          <p role="note" className="rounded-md border border-border bg-canvas p-3 text-sm">
            Publica solo opiniones reales de tus clientes y con su permiso. No se muestran estrellas
            ni calificaciones.
          </p>
          <TextField
            id={`${id}-title`}
            text="Título"
            value={str("title")}
            maxLength={60}
            onChange={set("title")}
          />
          {items.map((item, i) => (
            <fieldset key={i} className="space-y-2 rounded-md border border-border p-3">
              <legend className={label}>Opinión {i + 1}</legend>
              <TextField
                id={`${id}-q${i}`}
                text="Opinión"
                value={item.quote}
                maxLength={300}
                multiline
                onChange={(v) => setItem(i, { quote: v })}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  id={`${id}-a${i}`}
                  text="Nombre"
                  value={item.author}
                  maxLength={60}
                  onChange={(v) => setItem(i, { author: v })}
                />
                <TextField
                  id={`${id}-d${i}`}
                  text="Detalle (opcional)"
                  value={item.detail ?? ""}
                  maxLength={60}
                  hint="Por ejemplo, la ciudad."
                  onChange={(v) => setItem(i, { detail: v })}
                />
              </div>
              {items.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => update({ ...p, items: items.filter((_, j) => j !== i) })}
                >
                  Quitar la opinión {i + 1}
                </Button>
              ) : null}
            </fieldset>
          ))}
          {items.length < 6 ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                update({ ...p, items: [...items, { quote: "", author: "", detail: "" }] })
              }
            >
              Agregar una opinión
            </Button>
          ) : null}
        </div>
      );
    }
    case "rich_text":
      return (
        <div className="space-y-3">
          <TextField
            id={`${id}-heading`}
            text="Título (opcional)"
            value={str("heading")}
            maxLength={80}
            onChange={set("heading")}
          />
          <TextField
            id={`${id}-html`}
            text="Contenido"
            value={str("html")}
            maxLength={20000}
            multiline
            hint="Párrafos, listas, negritas y enlaces. Se limpia todo lo demás."
            onChange={set("html")}
          />
        </div>
      );
    case "faq": {
      const items = (Array.isArray(p.items) ? p.items : []) as {
        question: string;
        answer: string;
      }[];
      return (
        <ItemList
          id={id}
          title={str("title")}
          onTitle={set("title")}
          items={items}
          max={12}
          noun="pregunta"
          blank={{ question: "", answer: "" }}
          onItems={(next) => update({ ...p, items: next })}
          render={(item, i, setItem) => (
            <>
              <TextField
                id={`${id}-q${i}`}
                text="Pregunta"
                value={item.question}
                maxLength={150}
                onChange={(v) => setItem({ question: v })}
              />
              <TextField
                id={`${id}-a${i}`}
                text="Respuesta"
                value={item.answer}
                maxLength={1000}
                multiline
                onChange={(v) => setItem({ answer: v })}
              />
            </>
          )}
        />
      );
    }
    case "benefits": {
      const items = (Array.isArray(p.items) ? p.items : []) as {
        icon: BenefitIcon;
        title: string;
        text?: string;
      }[];
      return (
        <ItemList
          id={id}
          title={str("title")}
          titleOptional
          onTitle={set("title")}
          items={items}
          max={6}
          noun="beneficio"
          blank={{ icon: "star", title: "", text: "" }}
          onItems={(next) => update({ ...p, items: next })}
          render={(item, i, setItem) => (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-i${i}`} className={label}>
                  Ícono
                </label>
                <select
                  id={`${id}-i${i}`}
                  value={item.icon}
                  onChange={(e) => setItem({ icon: e.target.value as BenefitIcon })}
                  className={control}
                >
                  {BENEFIT_ICONS.map((k) => (
                    <option key={k} value={k}>
                      {BENEFIT_ICON_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
              <TextField
                id={`${id}-t${i}`}
                text="Título"
                value={item.title}
                maxLength={40}
                onChange={(v) => setItem({ title: v })}
              />
              <TextField
                id={`${id}-x${i}`}
                text="Detalle (opcional)"
                value={item.text ?? ""}
                maxLength={160}
                onChange={(v) => setItem({ text: v })}
              />
            </div>
          )}
        />
      );
    }
    case "goals":
      return (
        <div className="space-y-3">
          <TextField
            id={`${id}-title`}
            text="Título"
            value={str("title")}
            maxLength={60}
            onChange={set("title")}
          />
          {options.goals.length === 0 ? (
            <p className="text-[13px] text-fg-muted">
              Primero crea un filtro (por ejemplo, «Objetivo») en Productos → Atributos.
            </p>
          ) : (
            <fieldset>
              <legend className={label}>Objetivos (de 1 a 12, en este orden)</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {options.goals.map((g) => (
                  <label key={g.id} className="flex min-h-11 items-center gap-2 text-sm md:min-h-0">
                    <input
                      type="checkbox"
                      checked={list("value_ids").includes(g.id)}
                      onChange={(e) => toggle("value_ids", g.id, e.target.checked)}
                    />
                    {g.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      );
    case "reviews":
      return (
        <div className="space-y-3">
          <p role="note" className="rounded-md border border-border bg-canvas p-3 text-sm">
            Muestra solo opiniones reales de compradores, ya aprobadas en Productos → Opiniones. Si
            todavía no hay, el bloque no aparece en la tienda.
          </p>
          <TextField
            id={`${id}-title`}
            text="Título"
            value={str("title")}
            maxLength={60}
            onChange={set("title")}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-limit`} className={label}>
              Cuántas opiniones (3 a 12)
            </label>
            <input
              id={`${id}-limit`}
              type="number"
              min={3}
              max={12}
              value={Number(p.limit ?? 6)}
              onChange={(e) => set("limit")(Math.trunc(Number(e.target.value)))}
              className={control}
            />
          </div>
        </div>
      );
    case "video":
      return (
        <div className="space-y-3">
          <TextField
            id={`${id}-video`}
            text="Enlace del video de YouTube o Vimeo"
            value={str("video_id")}
            maxLength={500}
            hint="Pega el enlace tal cual; guardamos solo el código del video. El reproductor se carga cuando tu cliente lo toca."
            onChange={set("video_id")}
          />
          <TextField
            id={`${id}-title`}
            text="Título del video"
            value={str("title")}
            maxLength={80}
            hint="Lo leen quienes usan lector de pantalla."
            onChange={set("title")}
          />
          <TextField
            id={`${id}-caption`}
            text="Pie (opcional)"
            value={str("caption")}
            maxLength={200}
            onChange={set("caption")}
          />
        </div>
      );
    case "contact_map":
      return (
        <div className="space-y-3">
          <p className="text-[13px] text-fg-muted">
            Muestra la dirección, el horario y el WhatsApp que pusiste en «Redes y contacto», con un
            enlace al mapa.
          </p>
          <TextField
            id={`${id}-title`}
            text="Título"
            value={str("title")}
            maxLength={60}
            onChange={set("title")}
          />
          <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-0">
            <input
              type="checkbox"
              checked={p.show_whatsapp !== false}
              onChange={(e) => set("show_whatsapp")(e.target.checked)}
            />
            Mostrar el botón de WhatsApp
          </label>
        </div>
      );
  }
}

function LayoutSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-layout`} className={label}>
        Diseño
      </label>
      <select
        id={`${id}-layout`}
        value={value || "grid"}
        onChange={(e) => onChange(e.target.value === "grid" ? "" : e.target.value)}
        className={control}
      >
        <option value="grid">Cuadrícula</option>
        <option value="carousel">Carrusel deslizable</option>
      </select>
    </div>
  );
}

function ProductPicker({
  id,
  products,
  value,
  onChange,
}: {
  id: string;
  products: HomeEditorOptions["products"];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const byId = new Map(products.map((p) => [p.id, p]));
  const shown = products.filter((p) => !value.includes(p.id) && p.title.toLowerCase().includes(q));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };
  return (
    <fieldset className="space-y-2">
      <legend className={label}>Productos elegidos ({value.length} de 12, en este orden)</legend>
      {value.length > 0 ? (
        <ol className="space-y-1">
          {value.map((pid, i) => (
            <li key={pid} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="mr-auto">
                {i + 1}. {byId.get(pid)?.title ?? "Producto que ya no existe"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
                aria-label={`Subir ${byId.get(pid)?.title ?? "producto"}`}
              >
                ↑
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(value.filter((x) => x !== pid))}
              >
                Quitar
              </Button>
            </li>
          ))}
        </ol>
      ) : null}
      {value.length < 12 ? (
        <div className="space-y-2">
          <label htmlFor={`${id}-q`} className="sr-only">
            Buscar un producto para agregar
          </label>
          <input
            id={`${id}-q`}
            type="search"
            placeholder="Buscar un producto para agregar"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={control}
          />
          <ul className="max-h-56 space-y-1 overflow-y-auto" aria-label="Resultados">
            {shown.slice(0, 20).map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center rounded px-2 text-left text-sm hover:bg-canvas md:min-h-9"
                  onClick={() => onChange([...value, p.id])}
                >
                  Agregar «{p.title}»
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </fieldset>
  );
}

/** Lista de renglones (preguntas, beneficios): agregar, quitar y editar. */
function ItemList<T extends object>({
  id,
  title,
  titleOptional,
  onTitle,
  items,
  max,
  noun,
  blank,
  onItems,
  render,
}: {
  id: string;
  title: string;
  titleOptional?: boolean;
  onTitle: (v: string) => void;
  items: T[];
  max: number;
  noun: string;
  blank: T;
  onItems: (items: T[]) => void;
  render: (item: T, index: number, setItem: (patch: Partial<T>) => void) => React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <TextField
        id={`${id}-title`}
        text={titleOptional ? "Título (opcional)" : "Título"}
        value={title}
        maxLength={60}
        onChange={onTitle}
      />
      {items.map((item, i) => (
        <fieldset key={i} className="space-y-2 rounded-md border border-border p-3">
          <legend className={label}>
            {noun.charAt(0).toUpperCase() + noun.slice(1)} {i + 1}
          </legend>
          {render(item, i, (patch) =>
            onItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it))),
          )}
          {items.length > 1 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onItems(items.filter((_, j) => j !== i))}
            >
              Quitar {noun} {i + 1}
            </Button>
          ) : null}
        </fieldset>
      ))}
      {items.length < max ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onItems([...items, structuredClone(blank)])}
        >
          Agregar {noun}
        </Button>
      ) : null}
    </div>
  );
}

/** Dónde y cuándo se ve el bloque (ADR-034): comunes a todos. */
function SectionDisplay({
  section,
  onChange,
}: {
  section: EditorSection;
  onChange: (patch: Partial<EditorSection>) => void;
}) {
  const id = `d-${section.id}`;
  return (
    <fieldset className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-3">
      <legend className={label}>Dónde y cuándo se ve</legend>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-vis`} className={label}>
          Dispositivos
        </label>
        <select
          id={`${id}-vis`}
          value={section.visibility ?? "all"}
          onChange={(e) => onChange({ visibility: e.target.value as Visibility })}
          className={control}
        >
          {Object.entries(VISIBILITY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-from`} className={label}>
          Mostrar desde (opcional)
        </label>
        <input
          id={`${id}-from`}
          type="datetime-local"
          value={toLocalInput(section.starts_at)}
          onChange={(e) => onChange({ starts_at: fromLocalInput(e.target.value) })}
          className={control}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-to`} className={label}>
          Mostrar hasta (opcional)
        </label>
        <input
          id={`${id}-to`}
          type="datetime-local"
          value={toLocalInput(section.ends_at)}
          onChange={(e) => onChange({ ends_at: fromLocalInput(e.target.value) })}
          className={control}
        />
      </div>
      <p className="text-[13px] text-fg-muted sm:col-span-3">
        Las fechas usan la hora de este dispositivo. Fuera de esas fechas el bloque no aparece en la
        tienda (tarda hasta un minuto en cambiar).
      </p>
    </fieldset>
  );
}

/** Resumen de una línea de dónde y cuándo se ve, para la lista. */
function displaySummary(section: EditorSection): string | null {
  const parts: string[] = [];
  if (section.visibility === "mobile") parts.push("solo celular");
  if (section.visibility === "desktop") parts.push("solo computadora");
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
  if (section.starts_at) parts.push(`desde ${fmt(section.starts_at)}`);
  if (section.ends_at) parts.push(`hasta ${fmt(section.ends_at)}`);
  return parts.length ? parts.join(", ") : null;
}

function BannerUpload({ storeHandle }: { storeHandle: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [alt, setAlt] = useState("");
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [busy, setBusy] = useState(false);

  async function upload() {
    const file = inputRef.current?.files?.[0];
    setStatus({});
    if (!file) return setStatus({ error: "Elige una imagen." });
    if (!alt.trim()) return setStatus({ error: "Describe la imagen (texto alternativo)." });
    if (
      !(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type) ||
      file.size > MAX_UPLOAD_BYTES
    ) {
      return setStatus({ error: "Usa una imagen JPG, PNG, WebP o AVIF de hasta 10 MB." });
    }
    setBusy(true);
    try {
      const ticket = await requestBannerUpload(storeHandle, {
        mimeType: file.type,
        bytes: file.size,
      });
      if (!ticket.ok) return setStatus({ error: ticket.error });
      const put = await fetch(ticket.signedUrl, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      }).catch(() => null);
      if (!put?.ok) return setStatus({ error: "No se pudo subir la imagen. Inténtalo de nuevo." });
      const done = await finalizeBannerUpload(storeHandle, ticket.mediaId, alt);
      if (!done.ok) return setStatus({ error: done.error ?? "No pudimos procesar la imagen." });
      setStatus({ message: "Imagen subida. En unos segundos aparece para elegirla." });
      setAlt("");
      if (inputRef.current) inputRef.current.value = "";
      setTimeout(() => router.refresh(), 2500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="subir-imagen"
      className="space-y-2 rounded-md border border-border p-4"
    >
      <h3 id="subir-imagen" className="text-sm font-semibold">
        Subir una imagen para la portada
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="banner-file" className={label}>
            Imagen (JPG, PNG, WebP o AVIF, hasta 10 MB)
          </label>
          <input
            id="banner-file"
            ref={inputRef}
            type="file"
            accept={ALLOWED_IMAGE_MIME.join(",")}
            className="block min-h-11 text-sm"
          />
        </div>
        <TextField
          id="banner-alt"
          text="Texto alternativo"
          value={alt}
          maxLength={250}
          hint="Describe lo que se ve, para quien no puede verla."
          onChange={setAlt}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" loading={busy} onClick={upload}>
          Subir imagen
        </Button>
        <FormFeedback
          state={{
            ...(status.error ? { error: status.error } : {}),
            ...(status.message ? { ok: true, message: status.message } : {}),
          }}
        />
      </div>
    </section>
  );
}

export function HomeEditor({
  storeHandle,
  revision,
  initial,
  options,
  save,
  saveLabel = "Guardar portada en el borrador",
  emptyText = "Sin secciones, la portada muestra la plantilla del tema: el nombre de tu tienda, las categorías principales y las novedades.",
}: {
  storeHandle: string;
  revision: number;
  initial: EditorSection[];
  options: HomeEditorOptions;
  /** Otra acción de guardado (los bloques de una página, ADR-034 §3). */
  save?: (state: HomeFormState, formData: FormData) => Promise<HomeFormState>;
  saveLabel?: string;
  emptyText?: string;
}) {
  const [sections, setSections] = useState<EditorSection[]>(
    initial.map((s) => ({ ...s, props: { ...DEFAULTS[s.type], ...s.props } })),
  );
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<HomeSectionType>("hero");
  const [dragging, setDragging] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [state, action, pending] = useSafeActionState<HomeFormState, FormData>(
    save ?? saveHomeDraft.bind(null, storeHandle),
    {},
  );
  const productSections = sections.filter((s) => s.type === "featured_products").length;
  const full = sections.length >= MAX_SECTIONS;
  const productsFull = adding === "featured_products" && productSections >= MAX_PRODUCT_SECTIONS;

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    setSections(next);
    setAnnouncement(
      `${SECTION_LABELS[item!.type]} movida a la posición ${target + 1} de ${next.length}.`,
    );
    // El foco sigue al botón de la sección movida (F9-DESIGN §13 L6).
    requestAnimationFrame(() =>
      document.getElementById(`${item!.id}-${delta < 0 ? "up" : "down"}`)?.focus(),
    );
  }

  /** Arrastrar y soltar (puntero); el teclado usa ↑ y ↓. */
  function drop(target: number) {
    if (dragging === null || dragging === target) return setDragging(null);
    const next = [...sections];
    const [item] = next.splice(dragging, 1);
    next.splice(target, 0, item!);
    setSections(next);
    setDragging(null);
    setAnnouncement(
      `${SECTION_LABELS[item!.type]} movida a la posición ${target + 1} de ${next.length}.`,
    );
  }

  function duplicate(index: number) {
    if (full) return;
    const source = sections[index]!;
    if (source.type === "featured_products" && productSections >= MAX_PRODUCT_SECTIONS) return;
    const copy = { ...structuredClone(source), id: crypto.randomUUID() };
    const next = [...sections];
    next.splice(index + 1, 0, copy);
    setSections(next);
    setOpen(copy.id);
    setAnnouncement(`${SECTION_LABELS[source.type]} duplicada en la posición ${index + 2}.`);
  }

  function patch(id: string, change: Partial<EditorSection>) {
    setSections((all) => all.map((s) => (s.id === id ? { ...s, ...change } : s)));
  }

  function add() {
    if (full || productsFull) return;
    const id = crypto.randomUUID();
    setSections((all) => [
      ...all,
      { id, type: adding, enabled: true, props: structuredClone(DEFAULTS[adding]) },
    ]);
    setOpen(id);
    setAnnouncement(`${SECTION_LABELS[adding]} agregada al final.`);
  }

  return (
    <div className="space-y-6">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <form action={action} onSubmit={submitKeepingState(action)} className="space-y-4" noValidate>
        <input type="hidden" name="revision" value={revision} />
        <input type="hidden" name="sections" value={JSON.stringify(sections)} />
        {sections.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-sm text-fg-muted">
            {emptyText}
          </p>
        ) : null}
        <ol className="space-y-3" aria-label="Bloques de la portada">
          {sections.map((section, index) => {
            const name = SECTION_LABELS[section.type];
            const errors = state.sections?.[section.id];
            const expanded = open === section.id;
            const summary = displaySummary(section);
            return (
              <li
                key={section.id}
                className={`rounded-md border ${dragging === index ? "border-accent opacity-60" : "border-border"}`}
                onDragOver={(e) => {
                  if (dragging !== null) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(index);
                }}
              >
                <div className="flex flex-wrap items-center gap-2 p-3">
                  <span
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(index);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className="cursor-grab select-none px-1 text-fg-muted"
                    title="Arrastra para cambiar el orden"
                    aria-hidden="true"
                  >
                    ⠿
                  </span>
                  <h3 className="mr-auto text-sm font-semibold">
                    {index + 1}. {name}
                    {section.enabled ? null : (
                      <span className="ml-2 font-normal text-fg-muted"> (oculta)</span>
                    )}
                    {summary ? (
                      <span className="ml-2 font-normal text-fg-muted"> ({summary})</span>
                    ) : null}
                  </h3>
                  <Button
                    id={`${section.id}-up`}
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={`Subir ${name} (posición ${index + 1})`}
                  >
                    ↑
                  </Button>
                  <Button
                    id={`${section.id}-down`}
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={index === sections.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={`Bajar ${name} (posición ${index + 1})`}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setSections((all) =>
                        all.map((s) => (s.id === section.id ? { ...s, enabled: !s.enabled } : s)),
                      )
                    }
                  >
                    {section.enabled ? `Ocultar ${name}` : `Mostrar ${name}`}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-expanded={expanded}
                    aria-controls={`panel-${section.id}`}
                    onClick={() => setOpen(expanded ? null : section.id)}
                  >
                    {expanded ? `Cerrar ${name}` : `Editar ${name}`}
                  </Button>
                </div>
                {errors ? (
                  <ul role="alert" className="mx-3 mb-3 list-disc pl-5 text-sm text-danger">
                    {errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                ) : null}
                {expanded ? (
                  <div id={`panel-${section.id}`} className="space-y-4 border-t border-border p-3">
                    <SectionFields
                      section={section}
                      options={options}
                      update={(props) => patch(section.id, { props })}
                    />
                    <SectionDisplay
                      section={section}
                      onChange={(change) => patch(section.id, change)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={full}
                        onClick={() => duplicate(index)}
                      >
                        Duplicar {name}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSections((all) => all.filter((s) => s.id !== section.id));
                          setAnnouncement(`${name} eliminada.`);
                        }}
                      >
                        Eliminar {name}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-border p-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="add-type" className={label}>
              Nuevo bloque
            </label>
            <select
              id="add-type"
              value={adding}
              onChange={(e) => setAdding(e.target.value as HomeSectionType)}
              className={nativeControl}
            >
              {Object.entries(SECTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" variant="secondary" onClick={add} disabled={full || productsFull}>
            Agregar bloque
          </Button>
          <p className="text-[13px] text-fg-muted">
            {full
              ? `La portada admite hasta ${MAX_SECTIONS} bloques.`
              : productsFull
                ? `Hasta ${MAX_PRODUCT_SECTIONS} bloques de productos.`
                : `${sections.length} de ${MAX_SECTIONS} bloques.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={pending}>
            {saveLabel}
          </Button>
          <FormFeedback state={state} />
        </div>
      </form>
      <HomePreview sections={sections} labels={SECTION_LABELS} />
      <BannerUpload storeHandle={storeHandle} />
    </div>
  );
}
