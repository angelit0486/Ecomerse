import Link from "next/link";

import { mediaUrl, type MenuEntry } from "@/server/storefront/catalog";
import type { StorePublic } from "@/server/storefront/store-public";

export function StoreHeader({ store, menu }: { store: StorePublic; menu: MenuEntry[] }) {
  return (
    <header className="border-b border-[var(--sf-border)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
          {store.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- logo re-codificado servido por Storage
            <img
              src={mediaUrl(store.logo.path)}
              alt={store.name}
              width={store.logo.width ?? 160}
              height={store.logo.height ?? 48}
              className="h-10 w-auto max-w-40 object-contain"
            />
          ) : null}
          {store.logo ? null : <span>{store.name}</span>}
        </Link>
        <form
          method="get"
          action="/buscar"
          role="search"
          className="order-last flex w-full gap-2 sm:order-none sm:ml-auto sm:w-auto"
        >
          <label htmlFor="sf-search" className="sr-only">
            Buscar productos
          </label>
          <input
            id="sf-search"
            name="q"
            type="search"
            placeholder="Buscar productos"
            className="h-10 min-w-0 flex-1 rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] px-3 text-sm sm:w-64"
          />
          <button
            type="submit"
            className="h-10 rounded-[var(--sf-radius-btn)] bg-[var(--sf-primary)] px-4 text-sm font-medium text-[var(--sf-on-primary)]"
          >
            Buscar
          </button>
        </form>
      </div>
      {menu.length > 0 ? (
        <nav aria-label="Principal" className="mx-auto max-w-6xl px-4 pb-3">
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <li>
              <Link href="/productos" className="hover:underline">
                Todos los productos
              </Link>
            </li>
            {menu.map((item) => (
              <li key={item.href + item.label} className="group relative">
                <Link href={item.href} className="hover:underline">
                  {item.label}
                </Link>
                {item.children.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-1 pl-3 text-[var(--sf-muted)] sm:absolute sm:z-10 sm:hidden sm:min-w-40 sm:rounded-[var(--sf-radius-control)] sm:border sm:border-[var(--sf-border)] sm:bg-[var(--sf-bg)] sm:p-2 sm:group-focus-within:flex sm:group-hover:flex">
                    {item.children.map((child) => (
                      <li key={child.href + child.label}>
                        <Link href={child.href} className="hover:underline">
                          {child.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>
      ) : (
        <nav aria-label="Principal" className="mx-auto max-w-6xl px-4 pb-3 text-sm">
          <Link href="/productos" className="hover:underline">
            Todos los productos
          </Link>
        </nav>
      )}
    </header>
  );
}

export function StoreFooter({ store, menu }: { store: StorePublic; menu: MenuEntry[] }) {
  return (
    <footer className="mt-16 border-t border-[var(--sf-border)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm sm:flex-row sm:justify-between">
        <p className="font-medium">{store.name}</p>
        {menu.length > 0 ? (
          <nav aria-label="Pie de página">
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[var(--sf-muted)]">
              {menu
                .flatMap((item) => [item, ...item.children])
                .map((item) => (
                  <li key={item.href + item.label}>
                    <Link href={item.href} className="hover:underline">
                      {item.label}
                    </Link>
                  </li>
                ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </footer>
  );
}
