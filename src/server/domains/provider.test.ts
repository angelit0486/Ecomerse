import { describe, expect, it } from "vitest";

import { vercelDomainProvider, verificationRecordName } from "./provider";

function fakeFetch(routes: Record<string, [number, unknown]>, seen: string[] = []) {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    const [status, body] = routes[`${init?.method ?? "GET"} ${url.pathname}`] ?? [500, {}];
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

const base = {
  token: "t".repeat(24),
  projectId: "prj_abcdefghijk",
  apiBase: "https://vercel.test",
};

describe("vercelDomainProvider", () => {
  it("agrega el dominio al proyecto (y tolera que ya esté)", async () => {
    const seen: string[] = [];
    const p = vercelDomainProvider({
      ...base,
      teamId: "team_abcdefghijk",
      fetch: fakeFetch({ "POST /v10/projects/prj_abcdefghijk/domains": [409, {}] }, seen),
    });
    expect(await p.add("www.mitienda.mx")).toEqual({ ref: "prj_abcdefghijk" });
    expect(seen).toEqual(["POST /v10/projects/prj_abcdefghijk/domains?teamId=team_abcdefghijk"]);
  });

  it("listo solo con el dominio verificado y el DNS bien configurado", async () => {
    const make = (verified: boolean, misconfigured: boolean) =>
      vercelDomainProvider({
        ...base,
        fetch: fakeFetch({
          "GET /v9/projects/prj_abcdefghijk/domains/www.mitienda.mx": [200, { verified }],
          "GET /v6/domains/www.mitienda.mx/config": [200, { misconfigured }],
        }),
      });
    expect(await make(true, false).state("www.mitienda.mx")).toBe("ready");
    expect(await make(true, true).state("www.mitienda.mx")).toBe("pending");
    expect(await make(false, false).state("www.mitienda.mx")).toBe("pending");
  });

  it("un error de la API se propaga (el job reintenta)", async () => {
    const p = vercelDomainProvider({ ...base, fetch: fakeFetch({}) });
    await expect(p.add("www.mitienda.mx")).rejects.toThrow("vercel add domain: 500");
  });

  it("el TXT de propiedad sigue el contrato", () => {
    expect(verificationRecordName("www.mitienda.mx")).toBe("_platform-verify.www.mitienda.mx");
  });
});
