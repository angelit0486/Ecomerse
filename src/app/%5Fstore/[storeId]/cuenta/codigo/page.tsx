import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getStorefront } from "@/server/storefront/context";

import { CodeForm } from "../forms";

export const metadata: Metadata = {
  title: "Código de acceso",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ storeId: string }> };

export default async function AccountCodePage({ params }: Props) {
  const { store } = await getStorefront((await params).storeId);
  if (!(await cookies()).get("buyer_login_email")) redirect("/cuenta");
  return (
    <section className="mx-auto max-w-md space-y-4">
      <h1 className="text-3xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-5xl">
        Revisa tu email
      </h1>
      <p className="text-sm text-[var(--sf-muted)]">
        Te enviamos un código de 6 dígitos. Caduca en 10 minutos.
      </p>
      <CodeForm storeId={store.id} />
      <p className="text-sm">
        <Link prefetch={false} href="/cuenta" className="underline">
          Usar otro email
        </Link>
      </p>
    </section>
  );
}
