import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/server/auth/session";

import { signInWithPassword } from "../../actions";
import { PasswordLoginForm } from "../../forms";

export const metadata: Metadata = { title: "Ingresar con contraseña" };

/** ADR-031: alternativa al código por email; la app de autenticación se sigue pidiendo. */
export default async function PasswordLoginPage() {
  const session = await getSession();
  if (session) redirect(session.aal === "aal2" ? "/admin" : "/seguridad/2fa");
  return (
    <>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Ingresar con contraseña</h1>
        <p className="text-sm text-fg-muted">
          Después te pediremos el código de tu app de autenticación.
        </p>
      </header>
      <PasswordLoginForm action={signInWithPassword} />
      <p className="text-sm">
        ¿No tienes contraseña o la olvidaste?{" "}
        <Link href="/ingresar" className="underline">
          Entra con un código por email
        </Link>{" "}
        y créala en «Contraseña».
      </p>
    </>
  );
}
