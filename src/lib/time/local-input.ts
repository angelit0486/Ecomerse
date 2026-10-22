/**
 * «Ahora» en la zona de la tienda con el formato de `<input type="datetime-local">`
 * (AAAA-MM-DDTHH:mm), para su `min`: el selector ya no ofrece horas pasadas que
 * la base rechazaría (misión Portada/Marcas, Paso 5: ofertas rechazadas en staging).
 */
export function localInputNow(timeZone: string, now: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
