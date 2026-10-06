// Genera docs/phases/golden-cart-cases.md desde tests/fixtures/golden-cart-cases.json.
// Uso: node scripts/docs/golden-cart-cases.mjs   (la prueba de integración falla si el
// documento no coincide con el archivo de casos).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
export const casesPath = fileURLToPath(new URL("tests/fixtures/golden-cart-cases.json", root));
export const docPath = fileURLToPath(new URL("docs/phases/golden-cart-cases.md", root));

const money = (cents) => {
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
};
const pct = (bps) => `${(bps / 100).toString()} %`;

function describeRules(rules) {
  const parts = [
    `IVA ${pct(rules.tax_rate_bps ?? 0)} ${rules.prices_include_tax ? "incluido" : "aparte"}`,
  ];
  if (rules.tax_applies_to_shipping) parts.push("grava el envío");
  const d = rules.discount;
  if (d) {
    parts.push(
      d.type === "percentage"
        ? `descuento ${pct(d.value)}`
        : d.type === "fixed_amount"
          ? `descuento fijo ${money(d.value)}`
          : "cupón de envío gratis",
    );
  }
  const s = rules.shipping;
  if (s) {
    parts.push(
      s.type === "flat"
        ? `envío ${money(s.price)}`
        : s.type === "pickup"
          ? "recoger en tienda"
          : `envío ${money(s.price)}, gratis desde ${money(s.free_over_subtotal)}`,
    );
  }
  return parts.join("; ");
}

export function render(data) {
  const rows = data.cases.map((c) => {
    const lines = c.lines.length
      ? c.lines.map((l) => `${l.quantity} × ${money(l.unit_price)}`).join(" + ")
      : "—";
    const e = c.expected;
    return `| ${c.title} | ${lines} | ${describeRules(c.rules)} | ${money(e.subtotal)} | ${money(e.discount_total)} | ${e.allocations.map(money).join(" / ") || "—"} | ${money(e.shipping_total)} | ${money(e.tax_total)} | **${money(e.total)}** |`;
  });
  return `# Casos dorados del cálculo del carrito

> Generado desde \`tests/fixtures/golden-cart-cases.json\` (\`node scripts/docs/golden-cart-cases.mjs\`).
> Cada fila se verifica contra \`app.cart_totals\` en PostgreSQL (\`tests/integration/golden-cart.test.ts\`).
> Contrato: GATE0 §17.3. **Para el propietario:** si alguna fila no es como tu tienda debe cobrar, indícalo antes de la Fase 7.

Reglas: redondeo **mitad al par** (banquero) en descuentos porcentuales e impuestos; el impuesto se calcula **por línea** sobre lo cobrado y luego se suma; el descuento se reparte entre líneas por **residuo mayor** (la suma es exacta); el envío gratis «desde» se evalúa sobre el subtotal **ya descontado**.

| Caso | Líneas | Reglas | Subtotal | Descuento | Reparto | Envío | Impuesto | Total |
| ---- | ------ | ------ | -------- | --------- | ------- | ----- | -------- | ----- |
${rows.join("\n")}
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(docPath, render(JSON.parse(readFileSync(casesPath, "utf8"))));
  console.log(`Escrito ${docPath}`);
}
