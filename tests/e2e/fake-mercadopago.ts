import { createHmac, randomInt } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * Mercado Pago simulado para las E2E (sin red). Imita lo que la app usa de la
 * API real (src/server/payments/mercadopago.ts) y lo que hace Mercado Pago
 * cuando el comprador paga: guarda el cobro y manda el webhook FIRMADO
 * (x-signature v1 sobre «id;request-id;ts», como el real) a la app.
 * La app arranca con MERCADOPAGO_API_BASE=http://127.0.0.1:4610 (CI y .env.local).
 */
export const FAKE_MP_PORT = 4610;
export const FAKE_MP_SECRET = "e2ewebhooksecret00000000";

interface Pref {
  id: string;
  total: number;
  external_reference: string;
  back_urls: { success: string; pending: string; failure: string };
  payment_methods?: { excluded_payment_types?: { id: string }[] };
}
type Payment = Record<string, unknown> & { id: number; status: string; external_reference: string };

export class FakeMercadoPago {
  readonly preferences = new Map<string, Pref>();
  readonly payments = new Map<string, Payment>();
  private server: Server | null = null;

  /** Cuenta (collector) única por corrida: la base no deja dos tiendas con la misma. */
  readonly collector = String(randomInt(1_000_000_000, 9_999_999_999));

  constructor(private readonly app = process.env.E2E_BASE_URL ?? "http://localhost:3000") {}

  async start() {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(FAKE_MP_PORT, "127.0.0.1", resolve));
  }

  async stop() {
    await new Promise((resolve) => this.server?.close(resolve));
  }

  /** El comprador paga la preferencia: cobro + webhook firmado; devuelve el cobro y su regreso. */
  async pay(
    prefId: string,
    status: string,
    paymentType = "credit_card",
    amount?: number,
    secret = FAKE_MP_SECRET,
  ) {
    const pref = this.preferences.get(prefId);
    if (!pref) throw new Error(`preferencia desconocida ${prefId}`);
    const id = String(randomInt(1_000_000, 9_999_999_999));
    this.payments.set(id, {
      id: Number(id),
      status,
      status_detail:
        status === "rejected"
          ? "cc_rejected_other_reason"
          : status === "pending"
            ? "pending_waiting_payment"
            : "accredited",
      transaction_amount: amount ?? pref.total,
      currency_id: "MXN",
      external_reference: pref.external_reference,
      payment_type_id: paymentType,
      collector_id: Number(this.collector),
      date_created: new Date().toISOString(),
    });
    const webhook = await this.webhook(id, secret);
    const back =
      pref.back_urls[
        status === "approved" ? "success" : status === "rejected" ? "failure" : "pending"
      ];
    return { paymentId: id, webhook, back };
  }

  /** El cobro cambia (OXXO pagado) y Mercado Pago vuelve a avisar. */
  async update(paymentId: string, status: string) {
    const p = this.payments.get(paymentId)!;
    p.status = status;
    if (status === "approved") p.status_detail = "accredited";
    return this.webhook(paymentId);
  }

  /** Manda (o reenvía) el webhook firmado; con otra clave, la firma no vale. */
  async webhook(paymentId: string, secret = FAKE_MP_SECRET): Promise<number> {
    const ts = String(Math.floor(Date.now() / 1000));
    const requestId = `fake-${randomInt(1_000_000_000)}`;
    const v1 = createHmac("sha256", secret)
      .update(`id:${paymentId};request-id:${requestId};ts:${ts};`)
      .digest("hex");
    const res = await fetch(
      `${this.app}/api/webhooks/payments/mercadopago?data.id=${paymentId}&type=payment`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature": `ts=${ts},v1=${v1}`,
          "x-request-id": requestId,
        },
        body: JSON.stringify({
          id: randomInt(1_000_000_000, 9_999_999_999),
          type: "payment",
          action: "payment.updated",
          user_id: Number(this.collector),
          live_mode: false,
          data: { id: paymentId },
        }),
      },
    );
    return res.status;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${FAKE_MP_PORT}`);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (req.method === "POST" && url.pathname === "/checkout/preferences") {
      const body = JSON.parse(raw) as {
        items: { unit_price: number; quantity: number }[];
        external_reference: string;
        back_urls: Pref["back_urls"];
        payment_methods?: Pref["payment_methods"];
      };
      const id = `${this.collector}-${randomInt(100_000_000, 999_999_999)}fake`;
      const total = Number(
        body.items.reduce((s, i) => s + i.unit_price * i.quantity, 0).toFixed(2),
      );
      this.preferences.set(id, {
        id,
        total,
        external_reference: body.external_reference,
        back_urls: body.back_urls,
        payment_methods: body.payment_methods,
      });
      const init = `https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=${id}`;
      return send(201, { id, init_point: init, sandbox_init_point: init });
    }
    if (req.method === "GET" && url.pathname === "/v1/payments/search") {
      const ref = url.searchParams.get("external_reference");
      return send(200, {
        results: [...this.payments.values()].filter((p) => p.external_reference === ref).reverse(),
      });
    }
    const one = /^\/v1\/payments\/(\d+)$/.exec(url.pathname);
    if (req.method === "GET" && one) {
      const p = this.payments.get(one[1]!);
      return p ? send(200, p) : send(404, { message: "not_found" });
    }
    return send(404, { message: "not_found" });
  }
}
