# Casos dorados del cálculo del carrito

> Generado desde `tests/fixtures/golden-cart-cases.json` (`node scripts/docs/golden-cart-cases.mjs`).
> Cada fila se verifica contra `app.cart_totals` en PostgreSQL (`tests/integration/golden-cart.test.ts`).
> Contrato: GATE0 §17.3. **Para el propietario:** si alguna fila no es como tu tienda debe cobrar, indícalo antes de la Fase 7.

Reglas: redondeo **mitad al par** (banquero) en descuentos porcentuales e impuestos; el impuesto se calcula **por línea** sobre lo cobrado y luego se suma; el descuento se reparte entre líneas por **residuo mayor** (la suma es exacta); el envío gratis «desde» se evalúa sobre el subtotal **ya descontado**.

| Caso | Líneas | Reglas | Subtotal | Descuento | Reparto | Envío | Impuesto | Total |
| ---- | ------ | ------ | -------- | --------- | ------- | ----- | -------- | ----- |
| Una línea, IVA 16 % incluido en el precio | 1 × $116.00 | IVA 16 % incluido | $116.00 | $0.00 | $0.00 | $0.00 | $16.00 | **$116.00** |
| Una línea, IVA 16 % aparte (se suma al total) | 1 × $100.00 | IVA 16 % aparte | $100.00 | $0.00 | $0.00 | $0.00 | $16.00 | **$116.00** |
| Impuesto de 1.5 centavos: mitad al par → 2 | 1 × $0.10 | IVA 15 % aparte | $0.10 | $0.00 | $0.00 | $0.00 | $0.02 | **$0.12** |
| Impuesto de 4.5 centavos: mitad al par → 4 (no 5) | 1 × $0.30 | IVA 15 % aparte | $0.30 | $0.00 | $0.00 | $0.00 | $0.04 | **$0.34** |
| El impuesto se redondea por línea y luego se suma (2 + 2 = 4, no 3) | 1 × $0.10 + 1 × $0.10 | IVA 15 % aparte | $0.20 | $0.00 | $0.00 / $0.00 | $0.00 | $0.04 | **$0.24** |
| 10 % de 15 centavos = 1.5 → 2 | 1 × $0.15 | IVA 0 % incluido; descuento 10 % | $0.15 | $0.02 | $0.02 | $0.00 | $0.00 | **$0.13** |
| 10 % de 25 centavos = 2.5 → 2 | 1 × $0.25 | IVA 0 % incluido; descuento 10 % | $0.25 | $0.02 | $0.02 | $0.00 | $0.00 | **$0.23** |
| $1.00 fijo entre tres líneas iguales: 34 + 33 + 33 (empate → primera línea) | 1 × $1.00 + 1 × $1.00 + 1 × $1.00 | IVA 0 % incluido; descuento fijo $1.00 | $3.00 | $1.00 | $0.34 / $0.33 / $0.33 | $0.00 | $0.00 | **$2.00** |
| 10 % de $20.00 entre líneas de $10.00, $9.99 y $0.01: 100 + 100 + 0 (el centavo sobrante va al mayor residuo) | 1 × $10.00 + 3 × $3.33 + 1 × $0.01 | IVA 0 % incluido; descuento 10 % | $20.00 | $2.00 | $1.00 / $1.00 / $0.00 | $0.00 | $0.00 | **$18.00** |
| Descuento fijo mayor que la mercancía: se limita al subtotal; el envío se cobra | 1 × $5.00 | IVA 0 % incluido; descuento fijo $10.00; envío $99.00 | $5.00 | $5.00 | $5.00 | $99.00 | $0.00 | **$99.00** |
| IVA aparte también sobre el envío: 1600 + 160 | 1 × $100.00 | IVA 16 % aparte; grava el envío; envío $10.00 | $100.00 | $0.00 | $0.00 | $10.00 | $17.60 | **$127.60** |
| Envío gratis desde $500: con $600 no se cobra (IVA incluido: 8275.86 → 8276) | 1 × $600.00 | IVA 16 % incluido; envío $150.00, gratis desde $500.00 | $600.00 | $0.00 | $0.00 | $0.00 | $82.76 | **$600.00** |
| Envío gratis desde $500 se evalúa tras el descuento: $550 − 20 % = $440 → se cobra | 1 × $550.00 | IVA 0 % incluido; descuento 20 %; envío $150.00, gratis desde $500.00 | $550.00 | $110.00 | $110.00 | $150.00 | $0.00 | **$590.00** |
| Cupón de envío gratis: el envío fijo pasa a 0 y la mercancía no cambia | 1 × $10.00 | IVA 0 % incluido; cupón de envío gratis; envío $99.00 | $10.00 | $0.00 | $0.00 | $0.00 | $0.00 | **$10.00** |
| Recoger en tienda: sin costo de envío | 2 × $10.00 | IVA 0 % incluido; recoger en tienda | $20.00 | $0.00 | $0.00 | $0.00 | $0.00 | **$20.00** |
| IVA incluido con 10 % de descuento y envío gravado: 2880 + 1600 | 2 × $116.00 | IVA 16 % incluido; grava el envío; descuento 10 %; envío $116.00 | $232.00 | $23.20 | $23.20 | $116.00 | $44.80 | **$324.80** |
| Carrito vacío: todo en 0 | — | IVA 16 % incluido | $0.00 | $0.00 | — | $0.00 | $0.00 | **$0.00** |
