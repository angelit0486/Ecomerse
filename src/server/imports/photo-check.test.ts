import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { fetchRemoteImage } from "@/server/media/remote-fetch";

import { checkPhotoLinks, displayLink, PHOTO_CHECK_LABELS } from "./photo-check";

vi.mock("server-only", () => ({}));

let server: Server;
let origin = "";
let png: Buffer;
const requests: string[] = [];

beforeAll(async () => {
  png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#0b2d5b" } })
    .png()
    .toBuffer();
  server = createServer((req, res) => {
    requests.push(req.url ?? "");
    switch (req.url) {
      case "/ok.png":
        res.writeHead(200, { "content-type": "image/png" }).end(png);
        return;
      case "/grande.jpg":
        res.writeHead(200, { "content-length": String(20 * 1024 * 1024) });
        res.end();
        return;
      case "/pagina.html":
        res.writeHead(200, { "content-type": "image/png" }).end("<html>no soy una foto</html>");
        return;
      case "/redirige":
        res.writeHead(302, { location: "/ok.png" }).end();
        return;
      case "/a-otro-host":
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" }).end();
        return;
      case "/lenta.jpg":
        res.writeHead(200);
        res.write(Buffer.from([0xff])); // y no termina
        return;
      default:
        res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const link = (path: string, row: number) => ({ url: `${origin}${path}`, row, handle: `p-${row}` });

describe("checkPhotoLinks contra un servidor real", () => {
  it("clasifica cada enlace por lo que de verdad responde", async () => {
    const result = await checkPhotoLinks(
      [
        link("/ok.png", 2),
        link("/no-existe.jpg", 3),
        link("/grande.jpg", 4),
        link("/pagina.html", 5),
        link("/redirige", 6),
        link("/a-otro-host", 7),
        link("/ok.png", 8), // repetido: se revisa una vez
      ],
      { testOrigin: origin, limits: { perLinkTimeoutMs: 2_000 } },
    );
    expect(result.total).toBe(6);
    expect(result.checked).toBe(6);
    expect(result.counts).toMatchObject({
      ok: 2,
      not_found: 1,
      too_large: 1,
      not_image: 1,
      blocked: 1,
    });
    expect(result.problems.map((p) => [p.row, p.status])).toEqual([
      [3, "not_found"],
      [4, "too_large"],
      [5, "not_image"],
      [7, "blocked"],
    ]);
    expect(requests.filter((r) => r === "/ok.png").length).toBeGreaterThanOrEqual(1);
  });

  it("sin el origen de pruebas, el servidor local es una dirección interna y se bloquea", async () => {
    const result = await checkPhotoLinks([link("/ok.png", 2)]);
    expect(result.counts.blocked).toBe(1);
  });

  it("una foto lenta no frena la revisión: falla por tiempo", async () => {
    const result = await checkPhotoLinks([link("/lenta.jpg", 2)], {
      testOrigin: origin,
      limits: { perLinkTimeoutMs: 300 },
    });
    expect(result.counts.failed).toBe(1);
  });
});

describe("checkPhotoLinks: seguridad del descargador", () => {
  it.each([
    "http://example.com/a.jpg",
    "https://127.0.0.1/a.jpg",
    "https://10.0.0.5/a.jpg",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/a.jpg",
    "https://[fe80::1]/a.jpg",
    "https://192.168.1.10/a.jpg",
    "https://0.0.0.0/a.jpg",
    "https://user:pass@example.com/a.jpg",
    "https://example.com:8443/a.jpg",
    "ftp://example.com/a.jpg",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ])("bloquea %s sin conectarse", async (url) => {
    const result = await checkPhotoLinks([{ url, row: 2, handle: "x" }]);
    expect(result.problems[0]!.status).toBe("blocked");
  });

  it("un nombre que resuelve a una IP interna (o a una mezcla) se bloquea", async () => {
    const fetch = (url: string, options: Parameters<typeof fetchRemoteImage>[1]) =>
      fetchRemoteImage(url, {
        ...options,
        resolve: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "10.1.2.3", family: 4 },
        ],
      });
    const result = await checkPhotoLinks(
      [{ url: "https://fotos.ejemplo.mx/a.jpg", row: 2, handle: "x" }],
      { fetch },
    );
    expect(result.problems[0]!.status).toBe("blocked");
  });
});

describe("checkPhotoLinks: límites", () => {
  it("respeta la concurrencia y el máximo de enlaces; lo demás queda sin revisar", async () => {
    let active = 0;
    let peak = 0;
    const fetch = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return { ok: true as const, data: png, contentType: "image/png", partial: true };
    };
    const links = Array.from({ length: 30 }, (_, i) => ({
      url: `https://fotos.ejemplo.mx/${i}.png`,
      row: i + 2,
      handle: `p${i}`,
    }));
    const result = await checkPhotoLinks(links, {
      fetch,
      limits: { concurrency: 3, maxLinks: 20 },
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(result.checked).toBe(20);
    expect(result.counts.not_checked).toBe(10);
    expect(result.problems.every((p) => p.status === "not_checked")).toBe(true);
  });

  it("se detiene al agotar el tiempo total", async () => {
    let clock = 0;
    const fetch = async () => {
      clock += 1_000;
      return { ok: true as const, data: png, contentType: "image/png" };
    };
    const links = Array.from({ length: 10 }, (_, i) => ({
      url: `https://fotos.ejemplo.mx/${i}.png`,
      row: i + 2,
      handle: `p${i}`,
    }));
    const result = await checkPhotoLinks(links, {
      fetch,
      now: () => clock,
      limits: { concurrency: 1, budgetMs: 3_000 },
    });
    expect(result.checked).toBe(3);
    expect(result.counts.not_checked).toBe(7);
  });

  it("muestra el enlace sin su consulta y cada estado con problema tiene su texto", () => {
    expect(displayLink("https://cdn.ejemplo.mx/a/b.jpg?firma=secreta")).toBe(
      "cdn.ejemplo.mx/a/b.jpg",
    );
    expect(displayLink("no es url")).toBe("enlace no válido");
    expect(Object.keys(PHOTO_CHECK_LABELS).sort()).toEqual(
      ["blocked", "failed", "not_checked", "not_found", "not_image", "too_large"].sort(),
    );
  });
});
