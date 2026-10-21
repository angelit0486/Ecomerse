"use client";

import { useState, useTransition } from "react";

import { hasUnrenderedFieldError } from "@/lib/form-values";
import { Button } from "@/ui/primitives/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/ui/primitives/dialog";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";
import { Select } from "@/ui/primitives/select";

import {
  addStore,
  createTenant,
  grantSupport,
  revokeSupport,
  setOrganizationStatus,
  type ConsoleState,
} from "./actions";
import { useSafeActionState } from "@/ui/use-safe-action-state";

function Feedback({ state, rendered = [] }: { state: ConsoleState; rendered?: readonly string[] }) {
  if (state.ok)
    return (
      <p role="status" className="text-sm text-success">
        {state.message}
      </p>
    );
  if (state.error && hasUnrenderedFieldError(state.fields, rendered))
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    );
  return null;
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      rows={3}
      className="w-full rounded-[var(--radius-control)] border border-control bg-surface px-3 py-2 text-sm aria-[invalid=true]:border-danger"
    />
  );
}

export function StatusButton({
  organizationId,
  organizationName,
  status,
}: {
  organizationId: string;
  organizationName: string;
  status: "active" | "suspended";
}) {
  const [state, action, pending] = useSafeActionState(
    setOrganizationStatus.bind(null, organizationId, status),
    {},
  );
  const verb = status === "suspended" ? "Suspender" : "Reactivar";
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant={status === "suspended" ? "danger" : "secondary"}>
          {verb}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`${verb} ${organizationName}`}
        description={
          status === "suspended"
            ? "El equipo pierde el acceso y sus tiendas muestran mantenimiento al instante."
            : "El equipo recupera el acceso; las tiendas vuelven a su estado anterior."
        }
      >
        <form action={action} className="flex flex-col gap-4">
          <Field label="Motivo" required error={state.fields?.reason}>
            {(c) => <Textarea {...c} name="reason" />}
          </Field>
          <Feedback state={state} rendered={["reason"]} />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Cerrar</Button>
            </DialogClose>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? "Guardando…" : verb}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CreateTenantForm({ plans }: { plans: { value: string; label: string }[] }) {
  const [state, action, pending] = useSafeActionState(createTenant, {});
  return (
    <form action={action} className="grid max-w-lg gap-4" noValidate>
      <Field label="Nombre de la organización" required>
        {(c) => <Input {...c} name="org_name" defaultValue={state.values?.org_name} />}
      </Field>
      <Field label="Slug de la organización" hint="Minúsculas, números y guiones." required>
        {(c) => <Input {...c} name="org_slug" defaultValue={state.values?.org_slug} />}
      </Field>
      <Field label="Email del dueño" hint="Recibirá la invitación para activar su cuenta." required>
        {(c) => (
          <Input {...c} name="owner_email" defaultValue={state.values?.owner_email} type="email" />
        )}
      </Field>
      <Field label="Nombre de la tienda" required>
        {(c) => <Input {...c} name="store_name" defaultValue={state.values?.store_name} />}
      </Field>
      <Field label="Dirección de la tienda (handle)" hint="Será su subdominio." required>
        {(c) => <Input {...c} name="store_handle" defaultValue={state.values?.store_handle} />}
      </Field>
      <Field label="Plan" required error={state.fields?.plan}>
        {(c) => <Select {...c} name="plan" options={plans} />}
      </Field>
      <input type="hidden" name="country" value="MX" />
      <Feedback state={state} rendered={["plan"]} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creando…" : "Crear organización y tienda"}
        </Button>
      </div>
    </form>
  );
}

export function AddStoreForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useSafeActionState(addStore.bind(null, organizationId), {});
  return (
    <form action={action} className="grid max-w-lg gap-4" noValidate>
      <Field label="Nombre de la tienda" required>
        {(c) => <Input {...c} name="store_name" defaultValue={state.values?.store_name} />}
      </Field>
      <Field
        label="Dirección de la tienda (handle)"
        hint="Minúsculas, números y guiones. Será su subdominio mientras no tenga dominio propio."
        required
      >
        {(c) => <Input {...c} name="store_handle" defaultValue={state.values?.store_handle} />}
      </Field>
      <Feedback state={state} rendered={[]} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creando…" : "Agregar tienda"}
        </Button>
      </div>
    </form>
  );
}

export function GrantSupportForm({
  stores,
  staff,
}: {
  stores: { value: string; label: string }[];
  staff: { value: string; label: string }[];
}) {
  const [state, action, pending] = useSafeActionState(grantSupport, {});
  return (
    <form action={action} className="grid max-w-lg gap-4" noValidate>
      <Field label="Tienda" required>
        {(c) => <Select {...c} name="store_id" options={stores} />}
      </Field>
      <Field label="Persona de soporte" required error={state.fields?.grantee}>
        {(c) => <Select {...c} name="grantee" options={staff} />}
      </Field>
      <Field label="Duración" required error={state.fields?.minutes}>
        {(c) => (
          <Select
            {...c}
            name="minutes"
            defaultValue="30"
            options={[
              { value: "15", label: "15 minutos" },
              { value: "30", label: "30 minutos" },
              { value: "60", label: "60 minutos (máximo)" },
            ]}
          />
        )}
      </Field>
      <Field
        label="Motivo"
        hint="Mínimo 20 caracteres. Lo verá el dueño de la tienda."
        required
        error={state.fields?.reason}
      >
        {(c) => <Textarea {...c} name="reason" defaultValue={state.values?.reason} />}
      </Field>
      <Field label="Ticket (opcional)" error={state.fields?.ticket_ref}>
        {(c) => <Input {...c} name="ticket_ref" defaultValue={state.values?.ticket_ref} />}
      </Field>
      <Feedback state={state} rendered={["grantee", "minutes", "reason", "ticket_ref"]} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Concediendo…" : "Conceder acceso de solo lectura"}
        </Button>
      </div>
    </form>
  );
}

export function RevokeButton({ grantId }: { grantId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await revokeSupport(grantId);
            setError(result.error ?? null);
          })
        }
      >
        {pending ? "Revocando…" : "Revocar"}
      </Button>
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
