// =============================================================================
// SOLO DESARROLLO LOCAL. Puerta de enlace mínima que imita las rutas de la API
// de Supabase para que supabase-js funcione contra el stack sin Docker:
//   /auth/v1/*   → Supabase Auth (GoTrue)
//   /rest/v1/*   → PostgREST
//   /templates/* → supabase/templates (GoTrue descarga las plantillas por URL)
// Escucha solo en 127.0.0.1.
// =============================================================================
import { createReadStream, existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const templatesDir = path.join(root, "supabase/templates");

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const AUTH_PORT = Number(process.env.AUTH_PORT ?? 9999);
const REST_PORT = Number(process.env.REST_PORT ?? 3001);
const STORAGE_PORT = Number(process.env.STORAGE_PORT ?? 5000);

const routes = [
  { prefix: "/auth/v1", port: AUTH_PORT },
  { prefix: "/rest/v1", port: REST_PORT },
  { prefix: "/storage/v1", port: STORAGE_PORT },
];

function proxy(req, res, route) {
  const headers = { ...req.headers, host: `127.0.0.1:${route.port}` };
  // Como Kong en Supabase: sin Authorization, la apikey actúa como portador.
  if (!headers.authorization && typeof headers.apikey === "string") {
    headers.authorization = `Bearer ${headers.apikey}`;
  }
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: route.port,
      method: req.method,
      path: req.url.slice(route.prefix.length) || "/",
      headers,
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "upstream unavailable" }));
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  if (url.startsWith("/templates/")) {
    const name = path.basename(url.split("?")[0]);
    const file = path.join(templatesDir, name);
    if (!/^[a-z_]+\.html$/.test(name) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    createReadStream(file).pipe(res);
    return;
  }
  const route = routes.find(
    (r) => url === r.prefix || url.startsWith(`${r.prefix}/`) || url.startsWith(`${r.prefix}?`),
  );
  if (!route) {
    res
      .writeHead(404, { "content-type": "application/json" })
      .end(JSON.stringify({ message: "not found" }));
    return;
  }
  proxy(req, res, route);
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`gateway listening on http://127.0.0.1:${PORT}\n`);
});
