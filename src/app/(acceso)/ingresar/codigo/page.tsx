import type { Metadata } from "next";
import Link from "next/link";

import { verifyLoginCode } from "../../actions";
import { CodeForm } from "../../forms";

export const metadata: Metadata = { title: "Código de acceso" };

export default function LoginCodePage() {
  return (
    <>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Revisa tu email</h1>
        <p className="text-sm text-fg-muted">
          Si el email tiene una cuenta, te enviamos un código de 6 dígitos. Caduca en 10 minutos.
        </p>
      </header>
      <CodeForm action={verifyLoginCode} label="Código" />
      <Link href="/ingresar" className="text-sm underline">
        Usar otro email o pedir un código nuevo
      </Link>
    </>
  );
}
