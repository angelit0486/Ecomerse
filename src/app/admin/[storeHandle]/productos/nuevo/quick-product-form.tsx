"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import {
  suggestBrand,
  suggestCategory,
  TEMPLATES,
  type ProductTemplate,
} from "@/lib/catalog/suggest";
import { ALLOWED_IMAGE_MIME } from "@/lib/media/constants";
import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import { createProductQuick, type QuickProductInput } from "../actions";
import { uploadProductImages } from "../upload-client";

/**
 * Alta rápida de un producto (misión panel, Fase 1): nombre, precio, fotos y
 * existencias a la vista; lo demás plegado en «Más datos». Variantes (sabores,
 * tallas) y ficha sanitaria se agregan en la ficha después de crearlo.
 */
interface Option {
  id: string;
  name: string;
  depth?: number;
}

interface Draft {
  template: ProductTemplate;
  title: string;
  price: string;
  stock: string;
  compareAt: string;
  sku: string;
  description: string;
  brandId: string;
  categoryId: string;
  netContent: string;
  servings: string;
  weightG: string;
  requiresShipping: boolean;
}

const EMPTY: Omit<Draft, "template"> = {
  title: "",
  price: "",
  stock: "",
  compareAt: "",
  sku: "",
  description: "",
  brandId: "",
  categoryId: "",
  netContent: "",
  servings: "",
  weightG: "",
  requiresShipping: true,
};

const MAX_PHOTOS = 20;
const control = "h-11 text-base sm:h-10 sm:text-sm";
const select =
  "h-11 w-full rounded-[var(--radius-control)] border border-control bg-surface px-2 text-base text-fg sm:h-10 sm:text-sm";

// Borrador en este navegador: si se cierra la pestaña o se pierde la señal, lo
// escrito no se pierde (las fotos sí: el navegador no las puede guardar).
const noSubscribe = () => () => {};
function readDraft(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeDraft(key: string, draft: Draft | null) {
  try {
    if (draft) window.localStorage.setItem(key, JSON.stringify(draft));
    else window.localStorage.removeItem(key);
  } catch {
    /* modo privado o almacenamiento bloqueado: se sigue sin borrador */
  }
}

export function QuickProductForm({
  storeHandle,
  brands,
  categories,
  netContents,
  servingsHint,
  defaultTemplate,
  canStock,
  canReadCost,
}: {
  storeHandle: string;
  brands: Option[];
  categories: Option[];
  /** Contenidos netos ya capturados en la tienda, para sugerirlos. */
  netContents: string[];
  /** Porciones más comunes por contenido neto ya capturado (en minúsculas). */
  servingsHint: Record<string, number>;
  defaultTemplate: ProductTemplate;
  canStock: boolean;
  canReadCost: boolean;
}) {
  const router = useRouter();
  const draftKey = `pruva:producto-nuevo:${storeHandle}`;
  const [draft, setDraft] = useState<Draft>({ template: defaultTemplate, ...EMPTY });
  const [touched, setTouched] = useState({ brand: false, category: false });
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"form" | "creating" | "uploading" | "done">("form");
  const [progress, setProgress] = useState({ done: 0, failed: 0 });
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dismissedDraft, setDismissedDraft] = useState(false);
  // Las vistas previas (blob:) se liberan al salir de la pantalla.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);
  const savedDraft = useSyncExternalStore(
    noSubscribe,
    () => readDraft(draftKey),
    () => null,
  );
  const busy = phase !== "form";

  const suggestedBrand = useMemo(() => suggestBrand(draft.title, brands), [draft.title, brands]);
  const suggestedCategory = useMemo(
    () => suggestCategory(draft.title, categories),
    [draft.title, categories],
  );
  // Mientras no las toque, marca y categoría siguen la sugerencia del nombre.
  const brandId = touched.brand ? draft.brandId : (suggestedBrand?.id ?? "");
  const categoryId = touched.category ? draft.categoryId : (suggestedCategory?.id ?? "");

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => {
      const next = { ...prev, [key]: value };
      writeDraft(draftKey, next);
      return next;
    });
    if (fields[key as string]) setFields(({ [key as string]: _, ...rest }) => rest);
  }

  function addPhotos(list: FileList | null) {
    const images = Array.from(list ?? []).filter((f) =>
      (ALLOWED_IMAGE_MIME as readonly string[]).includes(f.type),
    );
    setPhotos((prev) =>
      [...prev, ...images.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(
        0,
        MAX_PHOTOS,
      ),
    );
  }

  function movePhoto(index: number, delta: -1 | 1) {
    setPhotos((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item!);
      return next;
    });
  }

  function removePhoto(index: number) {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[index]!.url);
      return prev.filter((_, i) => i !== index);
    });
  }

  const missing = [
    !draft.title.trim() ? "el nombre" : null,
    !draft.price.trim() ? "el precio" : null,
    photos.length === 0 ? "al menos una foto" : null,
    draft.template === "supplement" ? "la ficha sanitaria (en la ficha, después de crearlo)" : null,
  ].filter(Boolean) as string[];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setFields({});
    // Cada intento crea un producto distinto: su ajuste de existencias lleva su propia clave.
    const stockKey = crypto.randomUUID();
    setPhase("creating");
    const input: QuickProductInput = {
      title: draft.title,
      price: draft.price,
      compareAt: draft.compareAt || undefined,
      sku: draft.sku || undefined,
      description: draft.description || undefined,
      brandId: brandId || undefined,
      categoryId: categoryId || undefined,
      netContent: draft.template === "supplement" ? draft.netContent || undefined : undefined,
      servings: draft.template === "supplement" ? draft.servings || undefined : undefined,
      weightG: draft.weightG || undefined,
      requiresShipping: draft.requiresShipping,
      stock: canStock ? draft.stock || undefined : undefined,
      stockKey,
    };
    const result = await createProductQuick(storeHandle, input).catch(() => null);
    if (!result || !result.ok) {
      setPhase("form");
      setError(result?.error ?? "Se perdió la conexión. Inténtalo de nuevo.");
      setFields(result && !result.ok ? (result.fields ?? {}) : {});
      return;
    }
    writeDraft(draftKey, null);
    setCreatedId(result.productId);
    const target = `/admin/${storeHandle}/productos/${result.productId}?creado=1`;
    if (photos.length === 0) {
      router.push(target);
      return;
    }
    setPhase("uploading");
    let failed = 0;
    await uploadProductImages(
      storeHandle,
      photos.map((p) => ({ productId: result.productId, file: p.file })),
      (_, outcome) => {
        if (!outcome.ok) failed += 1;
        setProgress((prev) => ({
          done: prev.done + 1,
          failed: prev.failed + (outcome.ok ? 0 : 1),
        }));
      },
    );
    if (failed === 0 && !result.warning) {
      router.push(target);
      return;
    }
    if (result.warning) setError(result.warning);
    setPhase("done");
  }

  if (phase === "done" && createdId) {
    return (
      <div role="status" className="space-y-3 rounded-md border border-warning p-4 text-sm">
        <p className="font-medium">Producto creado.</p>
        {progress.failed > 0 ? (
          <p>
            {progress.failed === 1
              ? "1 foto no se pudo subir."
              : `${progress.failed} fotos no se pudieron subir.`}{" "}
            Vuelve a subirlas desde la ficha.
          </p>
        ) : null}
        {error ? <p>{error}</p> : null}
        <Link
          href={`/admin/${storeHandle}/productos/${createdId}?creado=1`}
          className="inline-flex h-11 items-center underline"
        >
          Ir a la ficha del producto
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-2xl space-y-6">
      {savedDraft && !dismissedDraft && !draft.title ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3 text-sm"
        >
          <p className="grow">Tienes un producto a medio capturar en este dispositivo.</p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              try {
                const restored = {
                  template: defaultTemplate,
                  ...EMPTY,
                  ...JSON.parse(savedDraft),
                } as Draft;
                setDraft(restored);
                setTouched({
                  brand: Boolean(restored.brandId),
                  category: Boolean(restored.categoryId),
                });
              } catch {
                writeDraft(draftKey, null);
              }
              setDismissedDraft(true);
            }}
          >
            Recuperarlo
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              writeDraft(draftKey, null);
              setDismissedDraft(true);
            }}
          >
            Empezar de cero
          </Button>
        </div>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">¿Qué vas a vender?</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TEMPLATES) as ProductTemplate[]).map((key) => (
            <label
              key={key}
              className={`inline-flex h-11 cursor-pointer items-center rounded-full border px-4 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ${
                draft.template === key ? "border-fg bg-fg text-canvas" : "border-control"
              }`}
            >
              <input
                type="radio"
                name="template"
                value={key}
                checked={draft.template === key}
                onChange={() => update("template", key)}
                className="sr-only"
              />
              {TEMPLATES[key].label}
            </label>
          ))}
        </div>
        <p className="text-[13px] text-fg-muted">{TEMPLATES[draft.template].hint}</p>
      </fieldset>

      <Field label="Nombre" required error={fields.title} hint="Como lo verán tus clientes.">
        {(p) => (
          <Input
            {...p}
            className={control}
            value={draft.title}
            maxLength={200}
            autoComplete="off"
            onChange={(e) => update("title", e.target.value)}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Precio" required error={fields.price} hint="En pesos, por ejemplo 499.50.">
          {(p) => (
            <Input
              {...p}
              className={control}
              inputMode="decimal"
              value={draft.price}
              onChange={(e) => update("price", e.target.value)}
            />
          )}
        </Field>
        {canStock ? (
          <Field label="Existencias" error={fields.stock} hint="Cuántas piezas tienes hoy.">
            {(p) => (
              <Input
                {...p}
                className={control}
                inputMode="numeric"
                value={draft.stock}
                onChange={(e) => update("stock", e.target.value.replace(/[^0-9]/g, ""))}
              />
            )}
          </Field>
        ) : null}
      </div>

      <section
        aria-labelledby="fotos-nuevo"
        onDragOver={(e) => {
          if (busy) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) addPhotos(e.dataTransfer.files);
        }}
        className={`space-y-3 rounded-md border p-4 ${dragging ? "border-2 border-dashed border-accent" : "border-border"}`}
      >
        <h2 id="fotos-nuevo" className="text-sm font-medium">
          Fotos
        </h2>
        <p className="text-[13px] text-fg-muted">
          Elige varias a la vez desde tu galería o arrástralas aquí. La primera es la principal;
          cambia el orden con las flechas.
        </p>
        <label className="inline-flex h-11 cursor-pointer items-center rounded-[var(--radius-control)] border border-control px-4 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus">
          Agregar fotos
          <input
            type="file"
            accept={ALLOWED_IMAGE_MIME.join(",")}
            multiple
            disabled={busy || photos.length >= MAX_PHOTOS}
            onChange={(e) => {
              addPhotos(e.target.files);
              e.target.value = "";
            }}
            className="sr-only"
          />
        </label>
        {photos.length > 0 ? (
          <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {photos.map((photo, i) => (
              <li key={photo.url} className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) */}
                <img
                  src={photo.url}
                  alt={`Foto ${i + 1}${i === 0 ? " (principal)" : ""}`}
                  className="aspect-square w-full rounded-md border border-border object-cover"
                />
                <div className="flex gap-1">
                  <IconButton
                    label={`Mover la foto ${i + 1} antes`}
                    disabled={busy || i === 0}
                    onClick={() => movePhoto(i, -1)}
                  >
                    ←
                  </IconButton>
                  <IconButton
                    label={`Mover la foto ${i + 1} después`}
                    disabled={busy || i === photos.length - 1}
                    onClick={() => movePhoto(i, 1)}
                  >
                    →
                  </IconButton>
                  <IconButton
                    label={`Quitar la foto ${i + 1}`}
                    disabled={busy}
                    onClick={() => removePhoto(i)}
                  >
                    ✕
                  </IconButton>
                </div>
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      <details className="rounded-md border border-border p-4">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">
          Más datos (opcional): descripción, marca, categoría, precio antes…
        </summary>
        <div className="mt-4 space-y-4">
          <Field
            label="Descripción"
            hint="Para qué sirve, cómo se usa. Separa párrafos con una línea en blanco."
          >
            {(p) => (
              <textarea
                {...p}
                rows={5}
                value={draft.description}
                onChange={(e) => update("description", e.target.value)}
                className="w-full rounded-[var(--radius-control)] border border-control bg-surface px-3 py-2 text-base text-fg sm:text-sm"
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Marca"
              hint={
                brands.length === 0
                  ? "Aún no hay marcas. Las creas en Productos → Marcas."
                  : suggestedBrand && !touched.brand
                    ? `Sugerida por el nombre: ${suggestedBrand.name}.`
                    : undefined
              }
            >
              {(p) => (
                <select
                  {...p}
                  className={select}
                  value={brandId}
                  onChange={(e) => {
                    setTouched((t) => ({ ...t, brand: true }));
                    update("brandId", e.target.value);
                  }}
                >
                  <option value="">Sin marca</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field
              label="Categoría"
              hint={
                categories.length === 0
                  ? "Aún no hay categorías. Las creas en Productos → Categorías."
                  : suggestedCategory && !touched.category
                    ? `Sugerida por el nombre: ${suggestedCategory.name}.`
                    : undefined
              }
            >
              {(p) => (
                <select
                  {...p}
                  className={select}
                  value={categoryId}
                  onChange={(e) => {
                    setTouched((t) => ({ ...t, category: true }));
                    update("categoryId", e.target.value);
                  }}
                >
                  <option value="">Sin categoría</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {"— ".repeat(c.depth ?? 0)}
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          {draft.template === "supplement" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Contenido neto" hint="Como viene en la etiqueta: 907 g, 60 cápsulas…">
                {(p) => (
                  <>
                    <Input
                      {...p}
                      className={control}
                      list="contenidos-tienda"
                      value={draft.netContent}
                      maxLength={100}
                      onChange={(e) => {
                        update("netContent", e.target.value);
                        // Mismo contenido que otro producto: se proponen sus porciones.
                        const hint = servingsHint[e.target.value.trim().toLowerCase()];
                        if (hint && !draft.servings) update("servings", String(hint));
                      }}
                    />
                    <datalist id="contenidos-tienda">
                      {netContents.map((n) => (
                        <option key={n} value={n} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
              <Field label="Porciones por envase" error={fields.servings}>
                {(p) => (
                  <Input
                    {...p}
                    className={control}
                    inputMode="numeric"
                    value={draft.servings}
                    onChange={(e) => update("servings", e.target.value.replace(/[^0-9]/g, ""))}
                  />
                )}
              </Field>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Precio antes"
              error={fields.compareAt}
              hint="Si está en oferta: el precio anterior, mayor al actual."
            >
              {(p) => (
                <Input
                  {...p}
                  className={control}
                  inputMode="decimal"
                  value={draft.compareAt}
                  onChange={(e) => update("compareAt", e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Código interno (SKU)"
              hint="Tu clave para identificarlo; sirve para nombrar fotos."
            >
              {(p) => (
                <Input
                  {...p}
                  className={control}
                  value={draft.sku}
                  maxLength={64}
                  autoCapitalize="characters"
                  onChange={(e) => update("sku", e.target.value)}
                />
              )}
            </Field>
            <Field label="Peso para envío (gramos)" error={fields.weightG}>
              {(p) => (
                <Input
                  {...p}
                  className={control}
                  inputMode="numeric"
                  value={draft.weightG}
                  onChange={(e) => update("weightG", e.target.value.replace(/[^0-9]/g, ""))}
                />
              )}
            </Field>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={draft.requiresShipping}
              onChange={(e) => update("requiresShipping", e.target.checked)}
              className="size-5"
            />
            Se envía a domicilio (desmárcalo si es digital o un servicio)
          </label>
          {canReadCost ? (
            <p className="text-[13px] text-fg-muted">
              El costo, la dirección web, las etiquetas y los datos para buscadores los editas en la
              ficha después de crearlo.
            </p>
          ) : null}
        </div>
      </details>

      <div className="space-y-3">
        {missing.length > 0 ? (
          <p className="text-sm text-fg-muted">
            Para publicarlo te falta: {missing.join(", ")}. Puedes crearlo ya como borrador.
          </p>
        ) : (
          <p className="text-sm text-success">Tiene lo necesario para publicarse.</p>
        )}
        {draft.template !== "general" ? (
          <p className="text-[13px] text-fg-muted">
            ¿Tiene {draft.template === "supplement" ? "sabores o tamaños" : "tallas o colores"}?
            Créalo y agrégalos en la ficha, en «Opciones y variantes».
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" loading={busy} className="w-full px-6 sm:w-auto md:h-11">
          {phase === "creating"
            ? "Creando…"
            : phase === "uploading"
              ? `Subiendo fotos ${progress.done} de ${photos.length}…`
              : "Crear producto"}
        </Button>
        <p className="text-[13px] text-fg-muted">
          Se guarda como borrador; lo publicas cuando quieras. Lo que escribes se guarda solo en
          este dispositivo hasta que lo crees.
        </p>
      </div>
    </form>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-11 items-center justify-center rounded-[var(--radius-control)] border border-control text-base disabled:opacity-40"
    >
      {children}
    </button>
  );
}
