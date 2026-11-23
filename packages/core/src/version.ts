/**
 * The version of a game's rules: a hash of every module its rules run, so that a page and Leaf can
 * tell whether they play by the same rules. A page built with rules other than Leaf's loads again
 * rather than show what its own rules would do (`play.ts` in the kit).
 *
 * The modules are found by following what the game's `Game` needs (`RULES_ENTRY`), by name: a module
 * that makes a name it needs is one of the rules, and everything that module imports is needed in
 * turn; a name a module only passes on (`export { x } from`, `export * from`, as core's index does) is
 * followed to where it is made, and the module passing it on is not one of the rules. What is only a
 * type runs nothing, and is not followed. So a change to a module no game's rules use, the live wire
 * or a page's, leaves every version as it was, and one to a module of a game's leaves the others'.
 * Reading the files is the caller's (`packages/core/build/rules.ts`, a macro run as a page is built
 * and as Leaf starts), since nothing here reads anything.
 */

import type { GameId } from "./play.ts";

/** Where each game's rules begin, from the repository's root: the module that makes its `Game`, and its name. */
export const RULES_ENTRY: Readonly<Record<GameId, { readonly path: string; readonly name: string }>> = {
  raid: { path: "packages/raid/src/game.ts", name: "RAID" },
  works: { path: "packages/factory/src/game.ts", name: "FACTORY" },
  town: { path: "packages/town/src/game.ts", name: "TOWN" },
  pulls: { path: "packages/pulls/src/game.ts", name: "PULLS" },
};

/** Gives a file's text by its path from the repository's root, or null where there is none. */
type Read = (path: string) => string | null;

/** Everything a name means of a module: the names it takes from it, or all of it (`*`). */
type Names = readonly string[] | "all";

/** What a module says of other modules and of itself, read from its text. */
interface Module {
  /** Each module it imports for what runs (not only types), with the names it takes. */
  readonly imports: readonly { readonly from: string; readonly names: Names }[];
  /** Each name it passes on, with the module and the name it is made under there (`*` for all of it). */
  readonly passes: ReadonlyMap<string, { readonly from: string; readonly name: string }>;
  /** The modules it passes everything of on (`export * from`). */
  readonly all: readonly string[];
  /** The names it makes itself. */
  readonly own: ReadonlySet<string>;
}

const WORKSPACE = "@sequoia-leaf/";
/** An import or a passing on, from another module: the word, `type` if only types, the names, and the address. */
const LINK = /(?:^|[\s;])(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*["']([^"']+)["']/g;
/** An import for what it does alone: `import "./x.ts"`. */
const BARE = /(?:^|[\s;])import\s*["']([^"']+)["']/g;
/** A name a module makes itself and gives. */
const OWN =
  /(?:^|[\s;])export\s+(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class|abstract\s+class|enum)\s+([A-Za-z_$][\w$]*)/g;
/** Names a module gives of its own, as a list (`export { a, b as c };`). */
const OWN_LIST = /(?:^|[\s;])export\s+\{([^}]*)\}\s*;?(?!\s*from)/g;

/** A path from `from`'s folder, `..` and `.` worked out: both from the repository's root. */
function beside(from: string, to: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const part of to.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}

/** The file a workspace package's address names, by its `package.json`'s `exports`; null for none. */
function inWorkspace(address: string, read: Read): string | null {
  const [name = "", ...rest] = address.slice(WORKSPACE.length).split("/");
  const sub = rest.length === 0 ? "." : `./${rest.join("/")}`;
  let exports: unknown;
  try {
    const manifest: unknown = JSON.parse(read(`packages/${name}/package.json`) ?? "null");
    exports = typeof manifest === "object" && manifest !== null && "exports" in manifest ? manifest.exports : null;
  } catch {
    return null;
  }
  if (typeof exports !== "object" || exports === null) return null;
  for (const [key, target] of Object.entries(exports)) {
    if (typeof target !== "string") continue;
    const star = key.indexOf("*");
    const matches = star < 0 ? key === sub : sub.startsWith(key.slice(0, star));
    if (matches) return beside(`packages/${name}/package.json`, target.replace("*", sub.slice(star)));
  }
  return null;
}

/** The file an address in `from` names: a relative path, or a workspace package's; null for one outside. */
function fileOf(from: string, address: string, read: Read): string | null {
  if (address.startsWith(".")) return beside(from, address);
  return address.startsWith(WORKSPACE) ? inWorkspace(address, read) : null;
}

/** The names in a list (`a, type B, c as d`), but types: each as `[name there, name here]`. */
function listed(list: string): [string, string][] {
  return list
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "" && !part.startsWith("type "))
    .map((part) => {
      const [there = "", here = there] = part.split(/\s+as\s+/);
      return [there, here];
    });
}

/** What a module's text says of other modules and of itself. */
function moduleOf(path: string, text: string, read: Read): Module {
  const imports: { from: string; names: Names }[] = [];
  const passes = new Map<string, { from: string; name: string }>();
  const all: string[] = [];
  const own = new Set<string>();
  for (const [, word, onlyTypes, clause = "", address = ""] of text.matchAll(LINK)) {
    const from = fileOf(path, address, read);
    if (from === null || onlyTypes !== undefined) continue;
    const braces = /\{([^}]*)\}/.exec(clause);
    if (word === "import") {
      // `* as ns` is all of it; a default is the name `default`; braces name the rest.
      if (clause.includes("*")) imports.push({ from, names: "all" });
      else {
        const names = braces ? listed(braces[1] ?? "").map(([there]) => there) : [];
        if (/^[A-Za-z_$][\w$]*/.test(clause.trim()) && !clause.trim().startsWith("{")) names.push("default");
        if (names.length > 0) imports.push({ from, names });
      }
    } else if (braces) {
      for (const [there, here] of listed(braces[1] ?? "")) passes.set(here, { from, name: there });
    } else {
      const as = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
      if (as?.[1]) passes.set(as[1], { from, name: "*" });
      else all.push(from);
    }
  }
  for (const [, address = ""] of text.matchAll(BARE)) {
    const from = fileOf(path, address, read);
    if (from !== null) imports.push({ from, names: "all" });
  }
  for (const [, name = ""] of text.matchAll(OWN)) own.add(name);
  for (const [, list = ""] of text.matchAll(OWN_LIST)) for (const [, here] of listed(list)) own.add(here);
  if (/(?:^|[\s;])export\s+default\b/.test(text)) own.add("default");
  return { imports, passes, all, own };
}

/**
 * The modules a game's rules run: from its `Game` (`RULES_ENTRY`), every module that makes a name
 * needed, and what those import, by name. A name found nowhere needs the module it was asked of.
 */
export function rulesModules(game: GameId, read: Read): Map<string, string> {
  const modules = new Map<string, Module>();
  /** The rules' modules, with their texts. */
  const run = new Map<string, string>();
  /** Whether each name looked for in a module was found, so that a module importing its importer ends. */
  const looked = new Map<string, boolean>();

  const module = (path: string): Module => {
    let found = modules.get(path);
    if (!found) modules.set(path, (found = moduleOf(path, read(path) ?? "", read)));
    return found;
  };

  /** The module is one of the rules: its text is kept, and all it imports is needed. */
  function runs(path: string): void {
    if (run.has(path)) return;
    run.set(path, read(path) ?? "");
    for (const { from, names } of module(path).imports) need(from, names);
  }

  /** A name of a module's is needed: where it is made is one of the rules. Says whether it was found. */
  function find(path: string, name: string): boolean {
    const key = `${path}#${name}`;
    const before = looked.get(key);
    if (before !== undefined) return before;
    // Looked for again while still looking (modules passing names round): not here.
    looked.set(key, false);
    const m = module(path);
    const passed = m.passes.get(name);
    let found = true;
    if (m.own.has(name)) runs(path);
    else if (passed) need(passed.from, passed.name === "*" ? "all" : [passed.name]);
    else found = m.all.some((from) => find(from, name));
    looked.set(key, found);
    return found;
  }

  function need(path: string, names: Names): void {
    if (names === "all") {
      runs(path);
      const m = module(path);
      for (const { from, name } of m.passes.values()) need(from, name === "*" ? "all" : [name]);
      for (const from of m.all) need(from, "all");
      return;
    }
    for (const name of names) if (!find(path, name)) runs(path);
  }

  need(RULES_ENTRY[game].path, [RULES_ENTRY[game].name]);
  return run;
}

/** A hash of a text, as 14 hexadecimal digits (cyrb53). */
function hash(text: string): string {
  let a = 0xdeadbeef;
  let b = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 2_654_435_761);
    b = Math.imul(b ^ c, 1_597_334_677);
  }
  a = Math.imul(a ^ (a >>> 16), 2_246_822_507) ^ Math.imul(b ^ (b >>> 13), 3_266_489_909);
  b = Math.imul(b ^ (b >>> 16), 2_246_822_507) ^ Math.imul(a ^ (a >>> 13), 3_266_489_909);
  return (4_294_967_296 * (2_097_151 & b) + (a >>> 0)).toString(16).padStart(14, "0");
}

/**
 * The version of a game's rules: a hash of the path and text of each module its rules run
 * (`rulesModules`), in the order of their paths.
 */
export function rulesVersion(game: GameId, read: Read): string {
  return hash(
    [...rulesModules(game, read)]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([path, text]) => `${path}\n${text}`)
      .join("\0"),
  );
}

/** Every game's rules' version. */
export const rulesVersions = (read: Read): Readonly<Record<GameId, string>> => ({
  raid: rulesVersion("raid", read),
  works: rulesVersion("works", read),
  town: rulesVersion("town", read),
  pulls: rulesVersion("pulls", read),
});
