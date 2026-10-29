import type { Metadata } from "next";
import Link from "next/link";

import { getStorefront } from "@/server/storefront/context";

import { recoverFromReminder } from "../reminder-actions";

export const metadata: Metadata = {
  title: "Recuperar mi carrito",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** ADR-048: enlace del recordatorio de carrito; se confirma con un botón. */
export default async function RecoverCartPage({ params, searchParams }: Props) {
  const { store } = await getStorefront((await params).storeId);
  const sp = await searchParams;
  const token = typeof sp.t === "string" && TOKEN_RE.test(sp.t) ? sp.t : null;
  const expired = sp.estado === "vencido" || !token;
  return (
    <section className="mx-auto max-w-md space-y-5 py-6 text-center">
      <h1 className="text-2xl font-extrabold tracking-tight text-balance">
        {expired ? "Este enlace ya no sirve" : "Tu carrito te espera"}
      </h1>
      {expired ? (
        <>
          <p className="text-[var(--sf-muted)]">
            El enlace del correo solo funciona una vez y mientras el carrito siga vigente.
          </p>
          <Link
            prefetch={false}
            href="/productos"
            className="inline-flex h-12 items-center justify-center rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-8 font-bold text-[var(--sf-btn-fg)]"
          >
            Ver productos
          </Link>
        </>
      ) : (
        <form action={recoverFromReminder.bind(null, store.id)} className="space-y-4">
          <input type="hidden" name="t" value={token} />
          <p className="text-[var(--sf-muted)]">
            Guardamos los productos que dejaste en {store.name}. Los precios y las existencias se
            confirman al pagar.
          </p>
          <button
            type="submit"
            className="inline-flex h-12 items-center justify-center rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-8 font-bold text-[var(--sf-btn-fg)]"
          >
            Volver a mi carrito
          </button>
        </form>
      )}
    </section>
  );
}
