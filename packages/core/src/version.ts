/**
 * The version of a game's rules: a hash of every file its rules are made of, so that a page and Leaf
 * can tell whether they play by the same rules. A page built with rules other than Leaf's loads
 * again rather than show what its own rules would do (`play.ts` in the kit). The files are found by
 * following imports from the game's own module (`RULES_ENTRY`), through relative paths and the
 * workspace's packages; reading them is the caller's (`packages/core/build/rules.ts`, a macro run as
 * a page is built and as Leaf starts), since nothing here reads anything.
 */

import type { GameId } from "./play.ts";

/** Where each game's rules begin, from the repository's root: the module that makes its `Game`. */
export const RULES_ENTRY: Readonly<Record<GameId, string>> = {
  raid: "packages/raid/src/game.ts",
  works: "packages/factory/src/game.ts",
  town: "packages/town/src/game.ts",
  pulls: "packages/pulls/src/game.ts",
};

/** What a module imports, by the address it names. */
const IMPORTS = /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g;
const WORKSPACE = "@sequoia-leaf/";

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
function inWorkspace(address: string, read: (path: string) => string | null): string | null {
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
 * The version of a game's rules: a hash of the path and text of every file followed from its entry,
 * in the order of their paths. `read` gives a file's text by its path from the repository's root,
 * or null where there is none; addresses outside the repository (no `./` and not the workspace's)
 * are left out.
 */
export function rulesVersion(game: GameId, read: (path: string) => string | null): string {
  const seen = new Map<string, string>();
  const waiting = [RULES_ENTRY[game]];
  for (let path = waiting.pop(); path !== undefined; path = waiting.pop()) {
    if (seen.has(path)) continue;
    const text = read(path);
    seen.set(path, text ?? "");
    for (const [, address = ""] of (text ?? "").matchAll(IMPORTS)) {
      const next = address.startsWith(".")
        ? beside(path, address)
        : address.startsWith(WORKSPACE)
          ? inWorkspace(address, read)
          : null;
      if (next !== null) waiting.push(next);
    }
  }
  return hash(
    [...seen]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([path, text]) => `${path}\n${text}`)
      .join("\0"),
  );
}

/** Every game's rules' version. */
export const rulesVersions = (read: (path: string) => string | null): Readonly<Record<GameId, string>> => ({
  raid: rulesVersion("raid", read),
  works: rulesVersion("works", read),
  town: rulesVersion("town", read),
  pulls: rulesVersion("pulls", read),
});
