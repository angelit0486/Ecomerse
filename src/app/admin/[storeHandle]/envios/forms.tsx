"use client";

import { useState } from "react";

import { Button } from "@/ui/primitives/button";
import { ConfirmButton } from "@/ui/primitives/confirm-button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import type { FormState } from "../_shared/action-state";
import { FormFeedback } from "../_shared/form-feedback";
import { nativeControl } from "../productos/styles";
import { deleteRate, deleteZone, saveRate, saveZone } from "./actions";
import { useSafeActionState } from "@/ui/use-safe-action-state";

export function ZoneForm({
  storeHandle,
  zone,
}: {
  storeHandle: string;
  zone?: { id: string; name: string; countries: string[]; regions: string[] | null };
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    saveZone.bind(null, storeHandle),
    {},
  );
  const v = (k: string, d: string) => state.values?.[k] ?? d;
  const p = zone ? `zone-${zone.id}` : "zone-new";
  return (
    <form
      action={action}
      className="grid gap-3 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end"
      noValidate
    >
      {zone ? <input type="hidden" name="id" value={zone.id} /> : null}
      <Field
        label={zone ? `Nombre de la zona ${zone.name}` : "Nombre de la zona"}
        id={`${p}-name`}
        required
        error={state.fields?.name}
      >
        {(c) => (
          <Input {...c} name="name" defaultValue={v("name", zone?.name ?? "")} maxLength={80} />
        )}
      </Field>
      <Field
        label="Países"
        id={`${p}-countries`}
        hint="Códigos de dos letras, p. ej. MX"
        error={state.fields?.countries}
      >
        {(c) => (
          <Input
            {...c}
            name="countries"
            defaultValue={v("countries", zone?.countries.join(", ") ?? "MX")}
          />
        )}
      </Field>
      <Field
        label="Regiones (opcional)"
        id={`${p}-regions`}
        hint="Vacío = todo el país"
        error={state.fields?.regions}
      >
        {(c) => (
          <Input
            {...c}
            name="regions"
            defaultValue={v("regions", zone?.regions?.join(", ") ?? "")}
          />
        )}
      </Field>
      <Button type="submit" size="sm" variant={zone ? "secondary" : "primary"} loading={pending}>
        {zone ? "Guardar zona" : "Crear zona"}
      </Button>
      <div className="sm:col-span-4">
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function DeleteButton({
  storeHandle,
  kind,
  id,
  label,
}: {
  storeHandle: string;
  kind: "zone" | "rate";
  id: string;
  label: string;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    (kind === "zone" ? deleteZone : deleteRate).bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <ConfirmButton
        size="sm"
        loading={pending}
        aria-label={`Eliminar ${label}`}
        question={`¿Eliminar ${label}?`}
        detail={kind === "zone" ? "También se eliminan sus tarifas." : undefined}
      >
        Eliminar
      </ConfirmButton>
      <FormFeedback state={state} />
    </form>
  );
}

export interface RateValues {
  id: string;
  zone_id: string;
  name: string;
  type: "flat" | "free_over" | "pickup";
  price: string;
  free_over_subtotal: string;
  est_days_min: string;
  est_days_max: string;
  is_active: boolean;
}

export function RateForm({
  storeHandle,
  zoneId,
  rate,
  currency,
}: {
  storeHandle: string;
  zoneId: string;
  rate?: RateValues;
  currency: string;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    saveRate.bind(null, storeHandle),
    {},
  );
  const [type, setType] = useState(rate?.type ?? "flat");
  const v = (k: keyof RateValues, d: string) => state.values?.[k] ?? d;
  const p = rate ? `rate-${rate.id}` : `rate-new-${zoneId}`;
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-4 sm:items-end" noValidate>
      {rate ? <input type="hidden" name="id" value={rate.id} /> : null}
      <input type="hidden" name="zone_id" value={zoneId} />
      <Field
        label={rate ? `Nombre de la tarifa ${rate.name}` : "Nombre de la tarifa"}
        id={`${p}-name`}
        required
      >
        {(c) => (
          <Input {...c} name="name" defaultValue={v("name", rate?.name ?? "")} maxLength={80} />
        )}
      </Field>
      <Field label="Tipo" id={`${p}-type`}>
        {(c) => (
          <select
            {...c}
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as RateValues["type"])}
            className={nativeControl}
          >
            <option value="flat">Precio fijo</option>
            <option value="free_over">Gratis desde un monto</option>
            <option value="pickup">Recoger en tienda</option>
          </select>
        )}
      </Field>
      {type !== "pickup" ? (
        <Field label={`Precio (${currency})`} id={`${p}-price`}>
          {(c) => (
            <Input
              {...c}
              name="price"
              defaultValue={v("price", rate?.price ?? "")}
              inputMode="decimal"
            />
          )}
        </Field>
      ) : null}
      {type === "free_over" ? (
        <Field label={`Gratis desde (${currency})`} id={`${p}-free`}>
          {(c) => (
            <Input
              {...c}
              name="free_over_subtotal"
              defaultValue={v("free_over_subtotal", rate?.free_over_subtotal ?? "")}
              inputMode="decimal"
            />
          )}
        </Field>
      ) : null}
      <Field label="Días (mín.)" id={`${p}-dmin`}>
        {(c) => (
          <Input
            {...c}
            name="est_days_min"
            defaultValue={v("est_days_min", rate?.est_days_min ?? "")}
            inputMode="numeric"
          />
        )}
      </Field>
      <Field label="Días (máx.)" id={`${p}-dmax`}>
        {(c) => (
          <Input
            {...c}
            name="est_days_max"
            defaultValue={v("est_days_max", rate?.est_days_max ?? "")}
            inputMode="numeric"
          />
        )}
      </Field>
      <label className="flex h-11 md:h-9 items-center gap-2 text-sm">
        <input type="hidden" name="is_active" value="0" />
        <input
          type="checkbox"
          name="is_active"
          value="1"
          defaultChecked={state.values ? state.values.is_active === "1" : (rate?.is_active ?? true)}
        />
        Activa
      </label>
      <Button type="submit" size="sm" variant={rate ? "secondary" : "primary"} loading={pending}>
        {rate ? "Guardar tarifa" : "Agregar tarifa"}
      </Button>
      <div className="sm:col-span-4">
        <FormFeedback state={state} />
      </div>
    </form>
  );
}
