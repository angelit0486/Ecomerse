"use client";

import { useActionState } from "react";

import {
  deleteAddress,
  requestCode,
  saveAddress,
  saveProfile,
  signOut,
  verifyCode,
  type AccountState,
} from "./actions";

const input =
  "h-11 w-full rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] px-3 text-sm";
const primary =
  "h-11 rounded-[var(--sf-radius-btn)] bg-[var(--sf-primary)] px-5 text-sm font-medium text-[var(--sf-on-primary)] disabled:opacity-60";
const secondary =
  "h-10 rounded-[var(--sf-radius-btn)] border border-[var(--sf-border-strong)] px-4 text-sm font-medium";

function Feedback({ state }: { state: AccountState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-[var(--sf-danger,#b91c1c)]">
        {state.error}
      </p>
    );
  }
  if (state.ok)
    return (
      <p role="status" className="text-sm">
        {state.message}
      </p>
    );
  return null;
}

function Input({
  label,
  name,
  ...rest
}: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <input name={name} className={input} {...rest} />
    </label>
  );
}

export function LoginForm({ storeId }: { storeId: string }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(
    requestCode.bind(null, storeId),
    {},
  );
  return (
    <form action={action} className="max-w-sm space-y-4" noValidate>
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
      />
      <button type="submit" className={primary} disabled={pending}>
        Enviarme un código
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function CodeForm({ storeId }: { storeId: string }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(
    verifyCode.bind(null, storeId),
    {},
  );
  return (
    <form action={action} className="max-w-sm space-y-4" noValidate>
      <Input
        label="Código de 6 dígitos"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        required
      />
      <button type="submit" className={primary} disabled={pending}>
        Entrar
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function SignOutButton({ storeId }: { storeId: string }) {
  return (
    <form action={signOut.bind(null, storeId)}>
      <button type="submit" className={secondary}>
        Cerrar sesión
      </button>
    </form>
  );
}

export function ProfileForm({
  storeId,
  initial,
}: {
  storeId: string;
  initial: { first_name: string; last_name: string; phone: string };
}) {
  const [state, action, pending] = useActionState<AccountState, FormData>(
    saveProfile.bind(null, storeId),
    {},
  );
  const v = { ...initial, ...state.values };
  return (
    <form action={action} className="grid max-w-lg gap-4 sm:grid-cols-2" noValidate>
      <Input label="Nombre" name="first_name" maxLength={80} defaultValue={v.first_name} />
      <Input label="Apellidos" name="last_name" maxLength={80} defaultValue={v.last_name} />
      <Input label="Teléfono" name="phone" type="tel" maxLength={20} defaultValue={v.phone} />
      <div className="flex items-end gap-3 sm:col-span-2">
        <button type="submit" className={secondary} disabled={pending}>
          Guardar datos
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function AddressForm({ storeId, country }: { storeId: string; country: string }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(
    saveAddress.bind(null, storeId),
    {},
  );
  const v = state.values ?? {};
  return (
    <form action={action} className="grid max-w-lg gap-4 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <Input
          label="Nombre de quien recibe"
          name="recipient_name"
          defaultValue={v.recipient_name}
        />
      </div>
      <div className="sm:col-span-2">
        <Input label="Calle y número" name="line1" defaultValue={v.line1} />
      </div>
      <div className="sm:col-span-2">
        <Input label="Colonia, interior (opcional)" name="line2" defaultValue={v.line2} />
      </div>
      <Input label="Ciudad" name="city" defaultValue={v.city} />
      <Input label="Estado" name="region" defaultValue={v.region} />
      <Input label="Código postal" name="postal_code" defaultValue={v.postal_code} />
      <Input
        label="País (código de 2 letras)"
        name="country"
        maxLength={2}
        defaultValue={v.country ?? country}
      />
      <Input label="Teléfono (opcional)" name="phone" type="tel" defaultValue={v.phone} />
      <label className="flex items-center gap-2 self-end text-sm">
        <input type="checkbox" name="is_default" value="1" />
        Usar como principal
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" className={secondary} disabled={pending}>
          Agregar dirección
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function DeleteAddressButton({
  storeId,
  addressId,
}: {
  storeId: string;
  addressId: string;
}) {
  const [state, action, pending] = useActionState<AccountState>(
    deleteAddress.bind(null, storeId, addressId),
    {},
  );
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <button type="submit" className="text-sm underline" disabled={pending}>
        Eliminar
      </button>
      <Feedback state={state} />
    </form>
  );
}
