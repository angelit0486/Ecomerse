import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/server/auth/session";

import { requestLoginCode } from "../actions";
import { EmailForm } from "../forms";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(session.aal === "aal2" ? "/admin" : "/seguridad/2fa");
  return (
    <>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Ingresar al panel</h1>
        <p className="text-sm text-fg-muted">Te enviaremos un código de un solo uso a tu email.</p>
      </header>
      <EmailForm action={requestLoginCode} />
    </>
  );
}
