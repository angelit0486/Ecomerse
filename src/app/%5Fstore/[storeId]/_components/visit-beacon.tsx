"use client";

import { useEffect } from "react";

/**
 * ¿Hay que avisar hoy? Función pura (con pruebas): no si ya se avisó este día,
 * ni si el navegador está automatizado (`navigator.webdriver`: Playwright,
 * Selenium, Puppeteer y robots que dibujan páginas; su user-agent puede ser
 * idéntico al de una persona, así que el filtro del servidor no basta).
 */
export function visitDue(lastSent: string | null, today: string, automated: boolean): boolean {
  return !automated && lastSent !== today;
}

/**
 * Cuenta a esta persona como visitante de hoy (una vez al día por tienda). Sin
 * cookies ni identificadores: el navegador recuerda en su propio almacenamiento
 * el último día en que avisó, y el servidor solo suma un número. Si el
 * almacenamiento no está disponible (modo privado), no avisa: mejor no contar
 * que contar de más. No dibuja nada.
 */
export function VisitBeacon({ storeId }: { storeId: string }) {
  useEffect(() => {
    try {
      const key = `pruva:visita:${storeId}`;
      const now = new Date();
      const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      if (!visitDue(window.localStorage.getItem(key), today, navigator.webdriver === true)) return;
      window.localStorage.setItem(key, today);
      const sent = navigator.sendBeacon?.("/visita");
      if (!sent) void fetch("/visita", { method: "POST", keepalive: true }).catch(() => {});
    } catch {
      // Sin almacenamiento o sin red: esta visita no se cuenta.
    }
  }, [storeId]);
  return null;
}
