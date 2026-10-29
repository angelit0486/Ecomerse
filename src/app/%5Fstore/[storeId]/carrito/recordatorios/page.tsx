import type { Metadata } from "next";
import Link from "next/link";

import { serverEnv } from "@/server/env";
import { verifyOptout } from "@/server/notifications/cart-recovery-links";
import { getStorefront } from "@/server/storefront/context";

import { optOutFromReminders } from "../reminder-actions";

export const metadata: Metadata = {
  title: "Recordatorios de carrito",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const button =
  "inline-flex h-12 items-center justify-center rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-8 font-bold text-[var(--sf-btn-fg)]";

/** ADR-048: baja de los recordatorios de carrito de esta tienda (con el enlace firmado). */
export default async function CartRemindersPage({ params, searchParams }: Props) {
  const { store } = await getStorefront((await params).storeId);
  const sp = await searchParams;
  const h = typeof sp.h === "string" ? sp.h : "";
  const s = typeof sp.s === "string" ? sp.s : "";
  const state = typeof sp.estado === "string" ? sp.estado : null;
  const valid = verifyOptout(serverEnv().ORDER_LINK_SECRET, store.id, h, s);

  let title: string;
  let body: React.ReactNode;
  if (state === "listo") {
    title = "Listo: ya no recibirás recordatorios";
    body = (
      <p className="text-[var(--sf-muted)]">
        {store.name} no te enviará más recordatorios de carritos. Los correos de tus pedidos no
        cambian.
      </p>
    );
  } else if (state === "error") {
    title = "No pudimos darte de baja";
    body = (
      <p className="text-[var(--sf-muted)]">
        Inténtalo de nuevo desde el enlace del correo en unos minutos.
      </p>
    );
  } else if (!valid) {
    title = "Este enlace no es válido";
    body = (
      <p className="text-[var(--sf-muted)]">
        Abre el enlace completo que viene al final del correo de recordatorio.
      </p>
    );
  } else {
    title = "¿Dejar de recibir recordatorios?";
    body = (
      <form action={optOutFromReminders.bind(null, store.id)} className="space-y-4">
        <input type="hidden" name="h" value={h} />
        <input type="hidden" name="s" value={s} />
        <p className="text-[var(--sf-muted)]">
          {store.name} no te volverá a escribir cuando dejes productos en tu carrito. Los correos de
          tus pedidos no cambian.
        </p>
        <button type="submit" className={button}>
          No quiero recibir recordatorios
        </button>
      </form>
    );
  }
  return (
    <section className="mx-auto max-w-md space-y-5 py-6 text-center">
      <h1 className="text-2xl font-extrabold tracking-tight text-balance">{title}</h1>
      {body}
      {state === "listo" || !valid ? (
        <Link prefetch={false} href="/" className="inline-block underline">
          Ir a la tienda
        </Link>
      ) : null}
    </section>
  );
}
