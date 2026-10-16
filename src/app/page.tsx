import { parsePreviewLinks } from "@/lib/preview-links";
import { serverEnv } from "@/server/env";

const linkButton =
  "inline-flex h-9 items-center justify-center rounded-[var(--radius-control)] px-4 text-sm font-medium transition-colors duration-150";

export default function HomePage() {
  const env = serverEnv();
  // Solo en la vista previa (D-F9-17): en producción la portada nunca lista tiendas.
  const demoStores = env.APP_ENV === "preview" ? parsePreviewLinks(env.PREVIEW_STORE_LINKS) : [];
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-10 px-4 py-16">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">Panel de tiendas</h1>
        <p className="text-fg-muted">
          Administra tu tienda en línea: productos, inventario, pedidos, clientes y apariencia.
        </p>
        <a
          href="/ingresar"
          className={`${linkButton} bg-accent text-accent-fg hover:bg-accent-hover`}
        >
          Entrar al panel
        </a>
      </header>

      {demoStores.length > 0 ? (
        <section aria-labelledby="demo-stores" className="space-y-3">
          <h2 id="demo-stores" className="text-lg font-semibold">
            Tiendas de demostración
          </h2>
          <p className="text-sm text-fg-muted">
            Ejemplos para revisar el diseño. Los productos no están a la venta y el pago es
            simulado.
          </p>
          <ul className="flex flex-wrap gap-3">
            {demoStores.map((store) => (
              <li key={store.url}>
                <a
                  href={store.url}
                  className={`${linkButton} border border-control bg-surface text-fg hover:bg-canvas`}
                >
                  {store.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
