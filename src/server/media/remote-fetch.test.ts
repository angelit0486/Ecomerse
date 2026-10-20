import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fetchRemoteImage, isPublicAddress } from "./remote-fetch";

describe("isPublicAddress (GATE0 T-08)", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a9fe:a9fe", // NAT64 de 169.254.169.254
    "2001:db8::1",
    "2002:7f00:1::1",
    "2001:0:4136:e378::1",
    "no-es-ip",
  ])("bloquea %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(["8.8.8.8", "151.101.1.69", "23.227.38.65", "2606:4700::6810:84e5", "::ffff:8.8.8.8"])(
    "acepta %s",
    (ip) => {
      expect(isPublicAddress(ip)).toBe(true);
    },
  );
});

describe("fetchRemoteImage · validación antes de conectar", () => {
  const opts = { maxBytes: 1024 };

  it("solo https al puerto 443 y sin credenciales", async () => {
    for (const url of [
      "http://cdn.example.com/a.jpg",
      "ftp://cdn.example.com/a.jpg",
      "https://cdn.example.com:8443/a.jpg",
      "https://user:pw@cdn.example.com/a.jpg",
      "file:///etc/passwd",
      "no es url",
    ]) {
      const result = await fetchRemoteImage(url, opts);
      expect(result, url).toMatchObject({ ok: false, reason: "fetch_blocked", retryable: false });
    }
  });

  it("IP interna escrita en la URL", async () => {
    for (const url of [
      "https://127.0.0.1/a.jpg",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/a.jpg",
      "https://[::ffff:10.0.0.1]/a.jpg",
      "https://[::ffff:7f00:1]/a.jpg",
      // Formas alternativas de escribir 127.0.0.1: el analizador de URL las normaliza.
      "https://2130706433/a.jpg",
      "https://0x7f.1/a.jpg",
      "https://017700000001/a.jpg",
      "https://127.1/a.jpg",
    ]) {
      expect(await fetchRemoteImage(url, opts), url).toMatchObject({
        ok: false,
        reason: "fetch_blocked",
      });
    }
  });

  it("un nombre que resuelve (aunque sea en parte) a una IP interna", async () => {
    const result = await fetchRemoteImage("https://cdn.example.com/a.jpg", {
      ...opts,
      resolve: async () => [
        { address: "151.101.1.69", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ],
    });
    expect(result).toMatchObject({ ok: false, reason: "fetch_blocked", detail: "address" });
  });

  it("un DNS que falla se puede reintentar", async () => {
    const result = await fetchRemoteImage("https://cdn.example.com/a.jpg", {
      ...opts,
      resolve: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "fetch_failed", retryable: true });
  });
});

describe("fetchRemoteImage · respuestas (servidor local de pruebas)", () => {
  let server: Server;
  let origin = "";
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

  beforeAll(async () => {
    server = createServer((req, res) => {
      switch (req.url) {
        case "/ok.png":
          res.writeHead(200, { "content-type": "image/png" }).end(png);
          return;
        case "/same-host":
          res.writeHead(302, { location: "/ok.png" }).end();
          return;
        case "/other-host":
          res.writeHead(302, { location: "https://evil.example.com/ok.png" }).end();
          return;
        case "/loop":
          res.writeHead(302, { location: "/loop" }).end();
          return;
        case "/big":
          res.writeHead(200, { "content-length": "999999" }).end(Buffer.alloc(10));
          return;
        case "/big-chunked":
          res.writeHead(200);
          res.write(Buffer.alloc(800));
          res.end(Buffer.alloc(800));
          return;
        case "/slow":
          res.writeHead(200);
          res.write(Buffer.alloc(10)); // y nunca termina
          return;
        case "/gone":
          res.writeHead(404).end();
          return;
        default:
          res.writeHead(503).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  const run = (path: string, extra: object = {}) =>
    fetchRemoteImage(`${origin}${path}`, { maxBytes: 1024, testOrigin: origin, ...extra });

  it("sin el origen de pruebas, el servidor local está bloqueado", async () => {
    const result = await fetchRemoteImage(`${origin}/ok.png`, { maxBytes: 1024 });
    expect(result).toMatchObject({ ok: false, reason: "fetch_blocked" });
  });

  it("descarga los bytes tal cual", async () => {
    const result = await run("/ok.png");
    expect(result).toMatchObject({ ok: true, contentType: "image/png" });
    expect(result.ok && result.data.equals(png)).toBe(true);
  });

  it("sigue redirecciones al mismo host y rechaza las de otro host", async () => {
    expect(await run("/same-host")).toMatchObject({ ok: true });
    expect(await run("/other-host")).toMatchObject({
      ok: false,
      reason: "fetch_blocked",
      detail: "redirect_host",
    });
    expect(await run("/loop")).toMatchObject({
      ok: false,
      reason: "fetch_blocked",
      detail: "too_many_redirects",
    });
  });

  it("corta por tamaño declarado y por tamaño real", async () => {
    expect(await run("/big")).toMatchObject({ ok: false, reason: "fetch_too_large" });
    expect(await run("/big-chunked")).toMatchObject({ ok: false, reason: "fetch_too_large" });
  });

  it("corta por tiempo y deja reintentar", async () => {
    const result = await run("/slow", { timeoutMs: 300 });
    expect(result).toMatchObject({ ok: false, reason: "fetch_failed", retryable: true });
  });

  it("404 es definitivo; 5xx se reintenta", async () => {
    expect(await run("/gone")).toMatchObject({
      ok: false,
      reason: "fetch_not_found",
      retryable: false,
    });
    expect(await run("/error")).toMatchObject({
      ok: false,
      reason: "fetch_failed",
      retryable: true,
    });
  });
});
