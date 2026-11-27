/**
 * What a function of the package's source calls, all the way down, across its files: for the
 * allocation guard, which reads every function the tick reaches for anything that makes an array,
 * an object, a closure, a string or an iterator. The source is read with its types taken off (Bun's
 * transpiler); a function is a `function` declaration or an arrow given a name with `const`, and a
 * hook a function written in a kind's `rules`, as an arrow or as a method.
 *
 * Each kind of piece plays by hooks in its own module (`src/kinds/`), called through a table by the
 * kind's number, so no name in the caller says which: a table of a hook (`const HANDS = RULES.map((r)
 * => r.hands)`) read, or a call whose first argument is the kit (`KIT`), is that hook's, and reaches
 * that hook of every kind (as its module has it in `rules`, or as
 * `rulesOf` fills it in). What a hook calls on the kit (`k.passTo(`) reaches the kit's member, as
 * `KIT` in `wire.ts` has it. A function named where it is not called (handed to another) is reached
 * too.
 */
import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";

/** The package's source: what the guard reads, unless it is given another folder laid out the same. */
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
  /** The names each function's body declares for itself, its parameters among them, by the function's name. */
  readonly locals: Map<string, ReadonlySet<string>>;
  /** Each name it imports, by the file and name it comes from. */
  readonly imports: Map<string, readonly [string, string]>;
  /**
   * For a kind's module, each hook it plays by and the function that is, in the file (under "" the
   * name of the hooks it imports whole, as a machine its maker's); for `kinds/list.ts`, what each hook
   * left out is filled in with.
   */
  readonly hooks: Map<string, string>;
  /** Hooks written whole as a value of their own (`MAKER`), each by its name: each hook and the function that is. */
  readonly sets: Map<string, Map<string, string>>;
  /** Each table of a hook by the kind's number it makes (`const HANDS = RULES.map((r) => r.hands)`): the hook, by the table's name. */
  readonly tables: Map<string, string>;
  /** For `wire.ts`, each member of the kit and the function that is. */
  readonly kit: Map<string, string>;
}

/** The index just past the string or template that opens at `from`. */
function pastString(js: string, from: number): number {
  const q = js[from] ?? "";
  for (let i = from + 1; i < js.length; i++) {
    if (js[i] === "\\") i++;
    else if (q === "`" && js[i] === "$" && js[i + 1] === "{") i = close(js, i + 1) - 1;
    else if (js[i] === q) return i + 1;
  }
  return js.length;
}

/**
 * The entries of an object literal whose text (`{...}`, braces and all) is `obj`, at its own depth:
 * each key and the text of its value. A method (`work(k, y) { ... }`) is read as the arrow it is
 * the same as (`(k, y) => { ... }`).
 */
function entries(obj: string): [string, string][] {
  const out: [string, string][] = [];
  let from = 1;
  const push = (to: number): void => {
    const text = obj.slice(from, to).trim();
    const method = /^([\w$]+)\s*\(/.exec(text);
    if (method) {
      const open = method[0].length - 1;
      const end = close(text, open);
      out.push([method[1] ?? "", `(${text.slice(open + 1, end - 1)}) => ${text.slice(end).trim()}`]);
      return;
    }
    const m = /^([\w$]+)\s*(?::\s*([\s\S]*))?$/.exec(text);
    if (m) out.push([m[1] ?? "", (m[2] ?? m[1] ?? "").trim()]);
  };
  for (let i = 1; i < obj.length - 1; i++) {
    const c = obj[i] ?? "";
    if (c === '"' || c === "'" || c === "`") i = pastString(obj, i) - 1;
    else if (c === "(" || c === "[" || c === "{") i = close(obj, i) - 1;
    else if (c === ",") {
      push(i);
      from = i + 1;
    }
  }
  if (obj.length > 1) push(obj.length - 1);
  return out;
}

/**
 * The function a value in an object literal is, as a name in its file: a name it already has, or for
 * an arrow written there, a name made for it (`<object>.<key>`), its body added to `bodies`.
 */
function named(src: Bodies, object: string, key: string, value: string): string | null {
  const arrow = /^\(?\s*(?:\(([^()]*)\)|([\w$]+))\s*=>\s*/.exec(value);
  if (arrow) {
    const name = `${object}.${key}`;
    src.add(name, arrow[1] ?? arrow[2] ?? "", value.slice(arrow[0].length));
    return name;
  }
  return /^[\w$]+$/.test(value) ? value : null;
}

/** The names a body declares, and its parameters. */
function declared(params: string, body: string): Set<string> {
  const names = new Set(params.match(/[\w$]+/g) ?? []);
  // The transpiler writes declarations one after another as one: `const a = 1, b = 2`. A function
  // declared in a body is one of the file's own (`read`), and is reached as one.
  for (const m of body.matchAll(
    /(?:\b(?:const|let|var)\s+|,\s*)([\w$]+)\s*=(?![=>])(?!\s*(?:\([^()]*\)|[\w$]+)\s*=>)/g,
  ))
    names.add(m[1] ?? "");
  for (const m of body.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]]*)[}\]]\s*=/g))
    for (const n of (m[1] ?? "").match(/[\w$]+/g) ?? []) names.add(n);
  for (const m of body.matchAll(/(?:\(([^()]*)\)|([\w$]+))\s*=>/g))
    for (const n of (m[1] ?? m[2] ?? "").match(/[\w$]+/g) ?? []) names.add(n);
  return names;
}

/** A file's functions as they are read: each body and the names it declares, by the function's name. */
interface Bodies {
  readonly bodies: Map<string, string>;
  readonly locals: Map<string, ReadonlySet<string>>;
  add(name: string, params: string, body: string): void;
}
function bodiesOf(): Bodies {
  const bodies = new Map<string, string>();
  const locals = new Map<string, ReadonlySet<string>>();
  return {
    bodies,
    locals,
    add(name, params, body) {
      bodies.set(name, body);
      locals.set(name, declared(params, body));
    },
  };
}

/** The object literal given to `name` (`name = {`, or `name: {`) in a file's text, braces and all; empty for none. */
function objectAt(js: string, name: RegExp): string {
  const m = name.exec(js);
  if (!m) return "";
  const open = js.indexOf("{", (m.index ?? 0) + m[0].length - 1);
  return open < 0 ? "" : js.slice(open, close(js, open));
}

function read(file: string, root: URL): Source {
  const js = transpiler.transformSync(readFileSync(new URL(file, root), "utf8"));
  const src = bodiesOf();
  const { bodies, locals } = src;
  for (const m of js.matchAll(/\bfunction\s+([\w$]+)\s*\(/g)) {
    const params = (m.index ?? 0) + m[0].length - 1;
    const end = close(js, params);
    const body = js.indexOf("{", end);
    src.add(m[1] ?? "", js.slice(params + 1, end - 1), js.slice(body, close(js, body)));
  }
  for (const m of js.matchAll(/(?:\bconst\s+|,\s*)([\w$]+)\s*=\s*(?:\(([^()]*)\)|([\w$]+))\s*=>/g)) {
    const from = (m.index ?? 0) + m[0].length;
    src.add(m[1] ?? "", m[2] ?? m[3] ?? "", js.slice(from, arrowEnd(js, from)));
  }
  const imports = new Map<string, readonly [string, string]>();
  for (const m of js.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(\.\.?\/[^"]+)"/g))
    for (const part of (m[1] ?? "").split(",")) {
      const [name = "", local = name] = part.trim().split(/\s+as\s+/);
      if (name) imports.set(local, [posix.join(posix.dirname(file), m[2] ?? ""), name]);
    }
  // A kind's hooks: its `rules`, an object written there or one named there; the kit, in `wire.ts`;
  // and the hooks a kind leaves out, as `rulesOf` fills them in (`kinds/list.ts`).
  const hooks = new Map<string, string>();
  const rules = /\brules:\s*([\w$]+)\s*[,}]/.exec(js)?.[1];
  for (const [key, value] of entries(objectAt(js, /\brules:\s*\{/))) {
    const name = named(src, "rules", key, value);
    if (name) hooks.set(key, name);
  }
  if (rules) hooks.set("", rules);
  // Hooks written whole as a value of their own, for kinds to play by (a maker's).
  const sets = new Map<string, Map<string, string>>();
  for (const m of js.matchAll(/\bconst\s+([A-Z][A-Z_]*)\s*=\s*\{/g)) {
    const set = new Map<string, string>();
    for (const [key, value] of entries(objectAt(js.slice(m.index ?? 0), /=\s*\{/)))
      if (key !== "") set.set(key, named(src, m[1] ?? "", key, value) ?? "");
    sets.set(m[1] ?? "", set);
  }
  for (const [key, value] of entries(objectAt(js, /\bconst\s+rulesOf\s*=\s*\(h\)\s*=>\s*\(\{/))) {
    const name = named(src, "rulesOf", key, value.replace(/^h\.[\w$]+\s*\?\?\s*/, ""));
    if (name) hooks.set(key, name);
  }
  const tables = new Map<string, string>();
  for (const m of js.matchAll(/(?:\bconst\s+|,\s*)([A-Z_]+)\s*=\s*RULES\.map\(\(r\)\s*=>\s*r\.([\w$]+)\)/g))
    tables.set(m[1] ?? "", m[2] ?? "");
  const kit = new Map<string, string>();
  for (const [key, value] of entries(objectAt(js, /\bconst\s+KIT\s*=\s*\{/))) {
    const name = named(src, "KIT", key, value);
    if (name) kit.set(key, name);
  }
  return { bodies, locals, imports, hooks, sets, tables, kit };
}

/** Every source file of the package but its content tables, read: its own folder's and the kinds'. */
function sources(root: URL = SRC): Map<string, Source> {
  const files = [
    ...readdirSync(root).filter((f) => f.endsWith(".ts")),
    ...readdirSync(new URL("kinds/", root))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => `kinds/${f}`),
  ];
  return new Map(files.map((f) => [f, read(f, root)]));
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
 * each of them makes. A name a file neither defines nor imports from the package is a built-in. The
 * package's source is read, or a folder laid out as it is (`root`), for the guard's own test.
 */
export function reached(
  file: string,
  entry: string,
  excused: ReadonlySet<string>,
  root: URL = SRC,
): { readonly reached: string[]; readonly makes: string[] } {
  const all = sources(root);
  const seen = new Set<string>();
  const out: string[] = [];
  /** Each kind's function for a hook, as `file:name`: its module's, or `rulesOf`'s where it leaves the hook out. */
  const hookOf = (hook: string): (readonly [string, string])[] =>
    [...all].flatMap(([f, src]): (readonly [string, string])[] => {
      const own = src.hooks.get(hook);
      if (own) return [[f, own]];
      // A kind that plays by hooks written whole elsewhere (a machine, by the maker's).
      const set = src.hooks.get("") ?? "";
      const whole = src.imports.get(set) ?? [f, set];
      const theirs = all.get(whole[0])?.sets.get(whole[1])?.get(hook);
      return theirs ? [[whole[0], theirs]] : [];
    });
  const visit = (f: string, name: string): void => {
    const key = `${f}:${name}`;
    const src = all.get(f);
    const body = src?.bodies.get(name);
    const imported = src?.imports.get(name);
    if (body === undefined && imported) return visit(imported[0], imported[1]);
    if (!src || body === undefined || seen.has(key) || excused.has(name)) return;
    seen.add(key);
    for (const what of makes(body)) out.push(`${key}: ${what}`);
    // Every function it calls, then every one it hands on: but a name it declares for itself.
    const own = src.locals.get(name);
    for (const pattern of [/(?<![.\w$])([\w$]+)\s*\(/g, /(?<![.\w$])([\w$]+)\b/g])
      for (const m of body.matchAll(pattern)) {
        const called = m[1] ?? "";
        if (own?.has(called)) continue;
        if (src.bodies.has(called)) visit(f, called);
        const from = src.imports.get(called);
        if (from) visit(from[0], from[1]);
      }
    // What it calls on the kit, as the kit has it.
    const kit = all.get("wire.ts")?.kit;
    for (const m of body.matchAll(/\bk\.([\w$]+)\b/g)) {
      const member = kit?.get(m[1] ?? "");
      if (member) visit("wire.ts", member);
    }
    // A hook, called with the kit or read from its table: that hook of every kind.
    for (const m of body.matchAll(/([\w$]+)\s*\(\s*KIT\b/g)) for (const [g, h] of hookOf(m[1] ?? "")) visit(g, h);
    for (const m of body.matchAll(/\b([A-Z_]+)\[/g)) {
      const hook = src.tables.get(m[1] ?? "");
      if (hook) for (const [g, h] of hookOf(hook)) visit(g, h);
    }
  };
  visit(file, entry);
  return { reached: [...seen], makes: out };
}
