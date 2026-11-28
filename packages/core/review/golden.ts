/**
 * A game's goldens, as plain lines: what each golden is, what it came to in words, and its hashes,
 * each named (`start 3f… end 9a…`), one golden a line, `id | says | hashes`. A game's review writes
 * its own (the Works' `review/golden.ts`); these are what every one of them reads, writes and
 * compares them by, so that a golden that moved says which of its hashes did.
 */

/** One golden: what it is, what it came to in words, and its hashes, each named. */
export interface Golden {
  readonly id: string;
  readonly says: string;
  readonly hashes: string;
}

const SEP = " | ";
export const goldenLine = (g: Golden): string => [g.id, g.says, g.hashes].join(SEP);
export const goldensText = (goldens: readonly Golden[]): string => goldens.map((g) => `${goldenLine(g)}\n`).join("");
export function goldensIn(text: string): Golden[] {
  const out: Golden[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const [id = "", says = "", hashes = ""] = line.split(SEP);
    out.push({ id, says, hashes });
  }
  return out;
}

/** A short hash of plain values, each written out as JSON as it is added. */
export class Hash {
  readonly #sha = new Bun.CryptoHasher("sha1");
  add(v: unknown): this {
    this.#sha.update(JSON.stringify(v));
    return this;
  }
  short(): string {
    return this.#sha.digest("hex").slice(0, 12);
  }
}
export const hashOf = (...parts: readonly unknown[]): string =>
  parts.reduce<Hash>((h, part) => h.add(part), new Hash()).short();

/** Hashes by name, from `start a end b`. */
function hashesBy(hashes: string): Map<string, string> {
  const by = new Map<string, string>();
  const words = hashes.split(" ");
  for (let at = 0; at + 1 < words.length; at += 2) by.set(words[at] ?? "", words[at + 1] ?? "");
  return by;
}

/**
 * How two sets of goldens differ, a line each: one changed (what it said and says, or which of its
 * hashes moved when its words did not), one new (`+`), one gone (`-`).
 */
export function changes(was: readonly Golden[], now: readonly Golden[]): string[] {
  const before = new Map(was.map((g) => [g.id, g] as const));
  const ids = new Set(now.map((g) => g.id));
  const out: string[] = [];
  for (const g of now) {
    const b = before.get(g.id);
    if (b === undefined) out.push(`+ ${goldenLine(g)}`);
    else if (b.says !== g.says) out.push(`  ${g.id}: ${b.says} -> ${g.says}`);
    else if (b.hashes !== g.hashes) {
      const old = hashesBy(b.hashes);
      const names = [...hashesBy(g.hashes)].filter(([name, h]) => old.get(name) !== h).map(([name]) => name);
      out.push(`  ${g.id}: ${g.says} (${names.join(" and ")} ${names.length === 1 ? "differs" : "differ"})`);
    }
  }
  out.push(...was.filter((g) => !ids.has(g.id)).map((g) => `- ${goldenLine(g)}`));
  return out;
}

/** Says how a set of goldens stands against those written: how many, and the first 40 that differ. */
export function tell(name: string, was: readonly Golden[], now: readonly Golden[]): void {
  const diff = changes(was, now);
  const shown = diff.slice(0, 40);
  const more = diff.length - shown.length;
  const head = `${name}: ${now.length}, ${diff.length === 0 ? "all as written" : `${diff.length} differ`}.`;
  console.log([head, ...shown, ...(more > 0 ? [`  and ${more} more`] : [])].join("\n"));
}
