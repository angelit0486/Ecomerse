"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";

import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES } from "@/lib/media/constants";
import { MAX_PRODUCT_SECTIONS, MAX_SECTIONS, type HomeSectionType } from "@/lib/theme/schema";
import { Button } from "@/ui/primitives/button";

import { FormFeedback } from "../_shared/form-feedback";
import { submitKeepingState } from "../_shared/submit";
import { nativeControl } from "../productos/styles";
import {
  finalizeBannerUpload,
  requestBannerUpload,
  saveHomeDraft,
  type HomeFormState,
} from "./home-actions";

/**
 * Editor de la portada (F9-T02, GATE0 §20.2, F9-DESIGN §7): agregar, editar,
 * ocultar, eliminar y ordenar (con botones, accesible con teclado) las 8
 * secciones del contrato. Se guarda la lista completa en el borrador.
 */
type Props = Record<string, unknown>;
interface EditorSection {
  id: string;
  type: HomeSectionType;
  enabled: boolean;
  props: Props;
}

export interface HomeEditorOptions {
  banners: { id: string; url: string; alt: string | null }[];
  categories: { id: string; name: string }[];
  brands: { id: string; name: string; hasLogo: boolean }[];
  goals: { id: string; label: string }[];
}

export const SECTION_LABELS: Record<HomeSectionType, string> = {
  hero: "Portada principal",
  featured_products: "Productos destacados",
  category_grid: "Categorías",
  promo_banner: "Banner de promoción",
  image_with_text: "Imagen con texto",
  brand_logos: "Marcas",
  testimonials: "Opiniones de clientes",
  rich_text: "Texto con formato",
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
};

const SOURCE_LABELS = {
  newest: "Novedades",
  best_selling: "Más vendidos",
  category: "De una categoría",
  brand: "De una marca",
  attribute_value: "De un objetivo (u otro filtro)",
} as const;

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
              {b.alt ?? "Imagen sin descripción"}
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
      };
      const needsId =
        source.type === "category" || source.type === "brand" || source.type === "attribute_value";
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
                onChange={(e) => set("source")({ type: e.target.value })}
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
  }
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
            className="text-sm"
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
}: {
  storeHandle: string;
  revision: number;
  initial: EditorSection[];
  options: HomeEditorOptions;
}) {
  const [sections, setSections] = useState<EditorSection[]>(
    initial.map((s) => ({ ...s, props: { ...DEFAULTS[s.type], ...s.props } })),
  );
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<HomeSectionType>("hero");
  const [announcement, setAnnouncement] = useState("");
  const [state, action, pending] = useActionState<HomeFormState, FormData>(
    saveHomeDraft.bind(null, storeHandle),
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
            Sin secciones, la portada muestra la plantilla del tema: el nombre de tu tienda, las
            categorías principales y las novedades.
          </p>
        ) : null}
        <ol className="space-y-3" aria-label="Secciones de la portada">
          {sections.map((section, index) => {
            const name = SECTION_LABELS[section.type];
            const errors = state.sections?.[section.id];
            const expanded = open === section.id;
            return (
              <li key={section.id} className="rounded-md border border-border">
                <div className="flex flex-wrap items-center gap-2 p-3">
                  <h3 className="mr-auto text-sm font-semibold">
                    {index + 1}. {name}
                    {section.enabled ? null : (
                      <span className="ml-2 font-normal text-fg-muted">(oculta)</span>
                    )}
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
                      update={(props) =>
                        setSections((all) =>
                          all.map((s) => (s.id === section.id ? { ...s, props } : s)),
                        )
                      }
                    />
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
                ) : null}
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-border p-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="add-type" className={label}>
              Nueva sección
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
            Agregar sección
          </Button>
          <p className="text-[13px] text-fg-muted">
            {full
              ? `La portada admite hasta ${MAX_SECTIONS} secciones.`
              : productsFull
                ? `Hasta ${MAX_PRODUCT_SECTIONS} secciones de productos.`
                : `${sections.length} de ${MAX_SECTIONS} secciones.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={pending}>
            Guardar portada en el borrador
          </Button>
          <FormFeedback state={state} />
        </div>
      </form>
      <BannerUpload storeHandle={storeHandle} />
    </div>
  );
}
