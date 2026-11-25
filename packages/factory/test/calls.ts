/**
 * What a function of the package's source calls, all the way down, across its files: for the
 * allocation guard, which reads every function the tick reaches for anything that makes an array,
 * an object, a closure, a string or an iterator. The source is read with its types taken off (Bun's
 * transpiler); a function is a `function` declaration or an arrow given a name with `const`.
 */
import { readdirSync, readFileSync } from "node:fs";

const SRC = new URL("../src/", import.meta.url);
const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" });

/** The index just past the bracket that closes the one opening at `from`, strings and templates stepped over. */
function close(js: string, from: number): number {
  const open: string[] = [];
  for (let i = from; i < js.length; i++) {
    const c = js[i] ?? "";
    if (c === '"' || c === "'") {
      for (i++; i < js.length && js[i] !== c; i++) if (js[i] === "\\") i++;
    } else if (c === "`") {
      for (i++; i < js.length && js[i] !== "`"; i++) {
        if (js[i] === "\\") i++;
        else if (js[i] === "$" && js[i + 1] === "{") i = close(js, i + 1) - 1;
      }
    } else if (c === "(" || c === "[" || c === "{") open.push(c);
    else if (c === ")" || c === "]" || c === "}") {
      open.pop();
      if (open.length === 0) return i + 1;
    }
  }
  return js.length;
}

/** The end of an arrow's body that starts at `from`: a block, or an expression up to a comma, semicolon or line's end at its own depth. */
function arrowEnd(js: string, from: number): number {
  let i = from;
  while (js[i] === " ") i++;
  if (js[i] === "{") return close(js, i);
  for (; i < js.length; i++) {
    const c = js[i] ?? "";
    if (c === "(" || c === "[" || c === "{" || c === '"' || c === "'" || c === "`") i = close(js, i) - 1;
    else if (c === "," || c === ";" || c === "\n" || c === ")" || c === "]" || c === "}") return i;
  }
  return i;
}

interface Source {
  /** Each function's body, by name. */
  readonly bodies: Map<string, string>;
  /** Each name it imports, by the file and name it comes from. */
  readonly imports: Map<string, readonly [string, string]>;
}

function read(file: string): Source {
  const js = transpiler.transformSync(readFileSync(new URL(file, SRC), "utf8"));
  const bodies = new Map<string, string>();
  for (const m of js.matchAll(/\bfunction\s+([\w$]+)\s*\(/g)) {
    const params = (m.index ?? 0) + m[0].length - 1;
    const body = js.indexOf("{", close(js, params));
    bodies.set(m[1] ?? "", js.slice(body, close(js, body)));
  }
  for (const m of js.matchAll(/(?:\bconst\s+|,\s*)([\w$]+)\s*=\s*(?:\([^()]*\)|[\w$]+)\s*=>/g)) {
    const from = (m.index ?? 0) + m[0].length;
    bodies.set(m[1] ?? "", js.slice(from, arrowEnd(js, from)));
  }
  const imports = new Map<string, readonly [string, string]>();
  for (const m of js.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/([^"]+)"/g))
    for (const part of (m[1] ?? "").split(",")) {
      const [name = "", local = name] = part.trim().split(/\s+as\s+/);
      if (name) imports.set(local, [m[2] ?? "", name]);
    }
  return { bodies, imports };
}

/** Every source file of the package but its content tables, read. */
function sources(): Map<string, Source> {
  const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));
  return new Map(files.map((f) => [f, read(f)]));
}

/** What in a function's body makes something: the first of each kind found, with a little of the text around it. */
export function makes(body: string): string[] {
  const found: string[] = [];
  const near = (at: number): string => body.slice(Math.max(0, at - 20), at + 20).replace(/\s+/g, " ");
  /** The first match of `pattern` that `keep` keeps, given where the match's last character is. */
  const first = (what: string, pattern: RegExp, keep: (last: number) => boolean = () => true): void => {
    for (const m of body.matchAll(pattern))
      if (keep((m.index ?? 0) + m[0].length - 1)) {
        found.push(`${what}: …${near(m.index ?? 0)}…`);
        return;
      }
  };
  // A bracket a value is taken apart into (`const a = 1, { b } = y`) makes nothing.
  const literal = (open: number): boolean => !/^\s*=(?![=>])/.test(body.slice(close(body, open)));
  first("new", /\bnew\b/g);
  first("an array", /(?:[=(,:?&|]|\breturn|\bof|=>)\s*\[/g, literal);
  first("an object", /(?:[=(,:?&|]|\breturn)\s*\{/g, literal);
  first("a closure", /=>|\bfunction\b/g);
  first("a string", /["'`]/g);
  first("a spread", /\.\.\./g);
  first("an iterator", /\bfor\s*\(\s*(?:const|let|var)\s[^;)]*\bof\b/g);
  first(
    "a copy",
    /\.(?:map|filter|slice|concat|flatMap|from|of|push|unshift|splice|join|split|toSorted|toReversed|with|entries|keys|values|reduce|forEach|bind)\(/g,
  );
  first("a built-in that makes one", /\b(?:Array|Object|String|Map|Set|Symbol|JSON|Promise|Error)\b(?!\.is)/g);
  return found;
}

/**
 * The body of the first loop in a function (`file`, `name`) whose head says `has`: for a guard on
 * what runs for every tile or piece, which `makes` reads on its own. Empty for none.
 */
export function loopIn(file: string, name: string, has: string): string {
  const body = sources().get(file)?.bodies.get(name) ?? "";
  for (const m of body.matchAll(/\bfor\s*\(/g)) {
    const from = (m.index ?? 0) + m[0].length - 1;
    const head = body.slice(from, close(body, from));
    const open = body.indexOf("{", from + head.length);
    if (head.includes(has) && open >= 0) return body.slice(open, close(body, open));
  }
  return "";
}

/**
 * The functions reached from `entry` (in `file`), as `file:name`, but not through `excused`; and what
 * each of them makes. A name a file neither defines nor imports from the package is a built-in.
 */
export function reached(
  file: string,
  entry: string,
  excused: ReadonlySet<string>,
): { readonly reached: string[]; readonly makes: string[] } {
  const all = sources();
  const seen = new Set<string>();
  const out: string[] = [];
  const visit = (f: string, name: string): void => {
    const key = `${f}:${name}`;
    const src = all.get(f);
    const body = src?.bodies.get(name);
    if (!src || body === undefined || seen.has(key) || excused.has(name)) return;
    seen.add(key);
    for (const what of makes(body)) out.push(`${key}: ${what}`);
    for (const m of body.matchAll(/(?<![.\w$])([\w$]+)\s*\(/g)) {
      const called = m[1] ?? "";
      if (src.bodies.has(called)) visit(f, called);
      const from = src.imports.get(called);
      if (from) visit(from[0], from[1]);
    }
  };
  visit(file, entry);
  return { reached: [...seen], makes: out };
}
