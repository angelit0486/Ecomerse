import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { serverEnv } from "@/server/env";
import { verifyFakePaymentSignature } from "@/server/payments/order-links";
import { getStorefront } from "@/server/storefront/context";

import { SimulateForm } from "./simulate-form";

export const metadata: Metadata = {
  title: "Pago de prueba",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ storeId: string; paymentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Pasarela simulada (D-F6-06): solo fuera de producción y con el enlace firmado. */
export default async function SimulatedPaymentPage({ params, searchParams }: Props) {
  const { storeId, paymentId } = await params;
  const { store } = await getStorefront(storeId);
  const sp = await searchParams;
  const returnPath = typeof sp.volver === "string" ? sp.volver : "";
  const signature = typeof sp.firma === "string" ? sp.firma : "";
  const env = serverEnv();
  if (
    env.APP_ENV === "production" ||
    !verifyFakePaymentSignature(env.ORDER_LINK_SECRET, paymentId, returnPath, signature)
  ) {
    notFound();
  }
  return (
    <section className="mx-auto max-w-md space-y-5 rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-6">
      <h1 className="text-xl font-semibold">Pago de prueba</h1>
      <p className="text-sm">
        Esta pasarela es simulada: no se cobra dinero real. Elige el resultado para continuar con tu
        pedido en {store.name}.
      </p>
      <SimulateForm
        storeId={store.id}
        paymentId={paymentId}
        returnPath={returnPath}
        signature={signature}
      />
    </section>
  );
}
