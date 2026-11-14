import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * H3 (Orden 10, mensaje 7). Qué páginas y rutas pueden arrancar la cola, directa
 * o indirectamente.
 *
 * Una acción de servidor corre dentro de la función de la página que la usa, con
 * el `maxDuration` de esa página. No basta con buscar llamadas en page.tsx: hay
 * que seguir página → componente → acción → helper, y los layouts que envuelven
 * a la página (las rutas route.ts no tienen layout).
 *
 * El análisis es por FUNCIÓN, no por archivo, para no marcar páginas que solo
 * importan otra acción del mismo módulo (p. ej. «agregar al carrito» vive junto
 * a `checkout`, pero no arranca la cola):
 *  - Semilla: las funciones exportadas por el módulo que define la cola
 *    (`processQueueSoon`, `resumeQueue`, `runQueuedJobs`).
 *  - Una declaración de primer nivel arranca la cola si nombra un identificador
 *    que la arranca: importado, local o un `import()` dinámico de un módulo con
 *    alguna exportación que la arranque.
 *  - Una entrada (page.tsx, route.ts) arranca la cola si alguna de sus
 *    declaraciones, o de sus layouts, la arranca.
 *
 * Sigue siendo conservador: basta con NOMBRAR la función (pasarla a un
 * formulario cuenta). Las cadenas de texto no cuentan.
 */
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
const DECLARATION =
  /^(export\s+)?(default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;

type Binding = { source: string; imported: string };
type Chunk = { name: string; body: string };
type Module = {
  imports: Map<string, Binding>;
  exports: Map<string, string>; // nombre exportado → nombre local
  reexports: Map<string, Binding>;
  starReexports: string[];
  chunks: Chunk[];
  dynamic: Map<string, string[]>; // declaración → módulos importados con import()
};

export type QueueEntry = { entry: string; chain: string[] };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Quita comentarios y el contenido de las cadenas (conserva `${…}` de las plantillas). */
function clean(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const n = source[i + 1];
    if (c === "/" && n === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === "/" && n === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== "\n")
        j += source[j] === "\\" ? 2 : 1;
      out += c + source.slice(i + 1, j).replace(/[^\n]/g, " ") + c;
      i = j + 1;
    } else if (c === "`") {
      let j = i + 1;
      out += "`";
      while (j < source.length && source[j] !== "`") {
        if (source[j] === "\\") {
          out += "  ";
          j += 2;
        } else if (source[j] === "$" && source[j + 1] === "{") {
          let depth = 1;
          let k = j + 2;
          while (k < source.length && depth > 0) {
            if (source[k] === "{") depth += 1;
            if (source[k] === "}") depth -= 1;
            k += 1;
          }
          out += source.slice(j, k);
          j = k;
        } else {
          out += source[j] === "\n" ? "\n" : " ";
          j += 1;
        }
      }
      out += "`";
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

export function createQueueGraph(srcRoot: string, definitions: { file: string; names: string[] }) {
  const src = resolve(srcRoot);
  const appRoot = join(src, "app");
  const seedFile = join(src, definitions.file);
  const modules = new Map<string, Module>();

  function resolveImport(from: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith("@/")) base = join(src, spec.slice(2));
    else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
    else return null;
    for (const ext of EXTENSIONS) {
      const candidate = base + ext;
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  function parse(file: string): Module {
    const hit = modules.get(file);
    if (hit) return hit;
    // Las rutas de import son cadenas: se leen del texto sin comentarios, antes de vaciarlas.
    const raw = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const mod: Module = {
      imports: new Map(),
      exports: new Map(),
      reexports: new Map(),
      starReexports: [],
      chunks: [],
      dynamic: new Map(),
    };
    modules.set(file, mod);

    for (const m of raw.matchAll(
      /^import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["'];?/gm,
    )) {
      const source = resolveImport(file, m[2]!);
      if (!source) continue;
      const clause = m[1]!.trim();
      const named = /\{([\s\S]*)\}/.exec(clause)?.[1];
      const head = clause
        .replace(/\{[\s\S]*\}/, "")
        .replace(/,\s*$/, "")
        .trim();
      const ns = /^\*\s+as\s+([\w$]+)$/.exec(head);
      if (ns) mod.imports.set(ns[1]!, { source, imported: "*" });
      else if (head && head !== ",")
        mod.imports.set(head.replace(/,$/, ""), { source, imported: "default" });
      for (const part of (named ?? "").split(",")) {
        const spec = part.replace(/^\s*type\s+/, "").trim();
        if (!spec) continue;
        const [imported, local] = spec.split(/\s+as\s+/);
        mod.imports.set((local ?? imported)!.trim(), { source, imported: imported!.trim() });
      }
    }
    for (const m of raw.matchAll(
      /^export\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+["']([^"']+)["']/gm,
    )) {
      const source = resolveImport(file, m[2]!);
      if (!source) continue;
      for (const part of m[1]!.split(",")) {
        const [imported, exported] = part.trim().split(/\s+as\s+/);
        if (imported)
          mod.reexports.set((exported ?? imported).trim(), { source, imported: imported.trim() });
      }
    }
    for (const m of raw.matchAll(/^export\s+\*\s+from\s+["']([^"']+)["']/gm)) {
      const source = resolveImport(file, m[1]!);
      if (source) mod.starReexports.push(source);
    }

    const text = clean(
      raw
        .replace(/^import\s[\s\S]*?["'];?$/gm, (s) => s.replace(/[^\n]/g, " "))
        .replace(/^export\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})\s+from\s+["'][^"']+["'];?$/gm, (s) =>
          s.replace(/[^\n]/g, " "),
        ),
    );
    const rawLines = raw.split("\n");
    let current: Chunk | null = null;
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const decl = DECLARATION.exec(line);
      const list = /^export\s+\{([^}]*)\};?$/.exec(line);
      const defaultAlias = /^export\s+default\s+([A-Za-z_$][\w$]*);?$/.exec(line);
      if (decl) {
        current = { name: decl[3]!, body: "" };
        mod.chunks.push(current);
        if (decl[1]) mod.exports.set(decl[2] ? "default" : decl[3]!, decl[3]!);
      } else if (list) {
        for (const part of list[1]!.split(",")) {
          const [local, exported] = part.trim().split(/\s+as\s+/);
          if (local) mod.exports.set((exported ?? local).trim(), local.trim());
        }
        current = null;
        continue;
      } else if (defaultAlias) {
        mod.exports.set("default", defaultAlias[1]!);
        current = null;
        continue;
      } else if (/^export\s+default\b/.test(line)) {
        current = { name: "default", body: "" };
        mod.chunks.push(current);
        mod.exports.set("default", "default");
      } else if (/^\S/.test(line) && !/^[)}\]]/.test(line)) {
        current = { name: `#${index}`, body: "" };
        mod.chunks.push(current);
      }
      if (current) {
        current.body += `${line}\n`;
        for (const d of (rawLines[index] ?? "").matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
          const target = resolveImport(file, d[1]!);
          if (target)
            mod.dynamic.set(current.name, [...(mod.dynamic.get(current.name) ?? []), target]);
        }
      }
    }
    return mod;
  }

  // Memo por «archivo#exportación»: cadena hasta la semilla, o null.
  const memo = new Map<string, string[] | null>();
  const inProgress = new Set<string>();
  const rel = (f: string) => relative(src, f);

  function exportChain(file: string, name: string): string[] | null {
    const key = `${file}#${name}`;
    if (memo.has(key)) return memo.get(key)!;
    if (inProgress.has(key)) return null;
    inProgress.add(key);
    let chain: string[] | null = null;
    if (file === seedFile) {
      chain = definitions.names.includes(name) ? [`${rel(file)}#${name}`] : null;
    } else {
      const mod = parse(file);
      const local = mod.exports.get(name);
      const re = mod.reexports.get(name);
      if (local) chain = localChain(file, local);
      else if (re) chain = bindingChain(re);
      else
        for (const star of mod.starReexports) {
          chain = exportChain(star, name);
          if (chain) break;
        }
    }
    inProgress.delete(key);
    memo.set(key, chain);
    return chain;
  }

  function anyExportChain(file: string): string[] | null {
    if (file === seedFile) return [`${rel(file)}#${definitions.names[0]}`];
    const mod = parse(file);
    for (const name of [...mod.exports.keys(), ...mod.reexports.keys()]) {
      const chain = exportChain(file, name);
      if (chain) return chain;
    }
    return null;
  }

  function bindingChain(binding: Binding): string[] | null {
    return binding.imported === "*"
      ? anyExportChain(binding.source)
      : exportChain(binding.source, binding.imported);
  }

  function localChain(file: string, name: string, seen = new Set<string>()): string[] | null {
    const mod = parse(file);
    if (seen.has(name)) return null;
    seen.add(name);
    const chunk = mod.chunks.find((c) => c.name === name);
    if (!chunk) {
      const binding = mod.imports.get(name);
      return binding ? bindingChain(binding) : null;
    }
    const tail = chunkChain(file, chunk, seen);
    return tail ? [`${rel(file)}#${name}`, ...tail] : null;
  }

  function chunkChain(
    file: string,
    chunk: Chunk,
    seen = new Set<string>([chunk.name]),
  ): string[] | null {
    const mod = parse(file);
    const ids = new Set(chunk.body.match(/(?<![\w$.])[A-Za-z_$][\w$]*/g) ?? []);
    for (const id of ids) {
      if (id === chunk.name) continue;
      const binding = mod.imports.get(id);
      const chain = binding
        ? bindingChain(binding)
        : mod.chunks.some((c) => c.name === id)
          ? localChain(file, id, seen)
          : null;
      if (chain) return chain;
    }
    for (const target of mod.dynamic.get(chunk.name) ?? []) {
      const chain = anyExportChain(target);
      if (chain) return chain;
    }
    return null;
  }

  function moduleChain(file: string): string[] | null {
    const mod = parse(file);
    for (const chunk of mod.chunks) {
      const chain = chunkChain(file, chunk);
      if (chain) return [`${rel(file)}#${chunk.name}`, ...chain];
    }
    return null;
  }

  function layoutsOf(entry: string): string[] {
    if (!entry.endsWith("/page.tsx")) return [];
    const out: string[] = [];
    for (let dir = dirname(entry); dir.startsWith(appRoot); dir = dirname(dir)) {
      for (const name of ["layout.tsx", "template.tsx"]) {
        const file = join(dir, name);
        if (existsSync(file)) out.push(file);
      }
      if (dir === appRoot) break;
    }
    return out;
  }

  return {
    entries(): string[] {
      return walk(appRoot)
        .filter((f) => /\/(page\.tsx|route\.ts)$/.test(f))
        .sort();
    },
    /** Entradas que arrancan la cola, con la cadena de declaraciones que lo demuestra. */
    queueEntries(): QueueEntry[] {
      const out: QueueEntry[] = [];
      for (const entry of this.entries()) {
        for (const start of [entry, ...layoutsOf(entry)]) {
          const chain = moduleChain(start);
          if (chain) {
            out.push({ entry: rel(entry), chain });
            break;
          }
        }
      }
      return out;
    },
    declaresMaxDuration(entry: string): boolean {
      return /^export const maxDuration = 60;$/m.test(readFileSync(join(src, entry), "utf8"));
    },
  };
}
