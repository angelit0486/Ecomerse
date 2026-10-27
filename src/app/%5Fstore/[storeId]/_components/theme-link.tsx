import Link from "next/link";
import type { ReactNode } from "react";

import { isExternalLink, isValidLink } from "@/lib/theme/links";

/** Enlace de la tienda: interno con Link; externo con rel seguro (F9-DESIGN §2.4). */
export function ThemeLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  if (!isValidLink(href)) return <span className={className}>{children}</span>;
  return isExternalLink(href) ? (
    <a href={href} rel="noopener noreferrer" className={className}>
      {children}
    </a>
  ) : (
    <Link prefetch={false} href={href} className={className}>
      {children}
    </Link>
  );
}
