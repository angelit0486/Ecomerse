import type { Metadata } from "next";
import Link from "next/link";

import { visibleStatus } from "@/lib/orders/visible-status";
import { accountOverview } from "@/server/storefront/account";
import { getStorefront } from "@/server/storefront/context";

import { money } from "../_components/format";
import { AddressForm, DeleteAddressButton, LoginForm, ProfileForm, SignOutButton } from "./forms";

export const metadata: Metadata = { title: "Mi cuenta", robots: { index: false, follow: false } };

type Props = { params: Promise<{ storeId: string }> };

/** Cuenta del comprador (F8-T01): sin caché; depende de la sesión de esta tienda (§44.7). */
export default async function AccountPage({ params }: Props) {
  const { store } = await getStorefront((await params).storeId);
  const account = await accountOverview(store.id);

  if (!account) {
    return (
      <section className="mx-auto max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">Mi cuenta</h1>
        <p className="text-sm text-[var(--sf-muted)]">
          Te enviaremos un código a tu email para entrar. Sin contraseñas. Verás tus pedidos de{" "}
          {store.name}, incluidos los que hiciste sin cuenta con ese email.
        </p>
        <LoginForm storeId={store.id} />
      </section>
    );
  }

  const c = account.customer;
  return (
    <section className="mx-auto max-w-3xl space-y-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Mi cuenta</h1>
          <p className="text-sm text-[var(--sf-muted)]">{c.email}</p>
        </div>
        <SignOutButton storeId={store.id} />
      </header>

      <section aria-labelledby="mis-pedidos" className="space-y-3">
        <h2 id="mis-pedidos" className="text-lg font-semibold">
          Mis pedidos
        </h2>
        {account.orders.length === 0 ? (
          <p className="text-sm">Aún no tienes pedidos en esta tienda.</p>
        ) : (
          <ul className="divide-y divide-[var(--sf-border)]">
            {account.orders.map((o) => (
              <li
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <Link href={`/cuenta/pedidos/${o.id}`} className="font-medium underline">
                  Pedido {o.display_number}
                </Link>
                <span>{new Date(o.placed_at).toLocaleDateString(store.locale)}</span>
                <span>{visibleStatus(o)}</span>
                <span>{money(o.total, store)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="mis-datos" className="space-y-3">
        <h2 id="mis-datos" className="text-lg font-semibold">
          Mis datos
        </h2>
        <ProfileForm
          storeId={store.id}
          initial={{
            first_name: c.first_name ?? "",
            last_name: c.last_name ?? "",
            phone: c.phone ?? "",
          }}
        />
      </section>

      <section aria-labelledby="mis-direcciones" className="space-y-3">
        <h2 id="mis-direcciones" className="text-lg font-semibold">
          Mis direcciones
        </h2>
        {account.addresses.length > 0 ? (
          <ul className="space-y-3 text-sm">
            {account.addresses.map((a) => (
              <li
                key={a.id}
                className="rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-3"
              >
                <p className="font-medium">
                  {a.recipient_name}
                  {a.is_default ? " · principal" : ""}
                </p>
                <p>
                  {a.line1}
                  {a.line2 ? `, ${a.line2}` : ""}, {a.postal_code} {a.city}, {a.region}, {a.country}
                </p>
                <DeleteAddressButton
                  storeId={store.id}
                  addressId={a.id}
                  label={`${a.line1}, ${a.city}`}
                />
              </li>
            ))}
          </ul>
        ) : null}
        <AddressForm storeId={store.id} country={store.country} />
      </section>
    </section>
  );
}
