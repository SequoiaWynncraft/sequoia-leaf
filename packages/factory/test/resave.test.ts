/**
 * The dry run of the codec (`tools/resave.ts`) fails on anything a first reading lets go: a piece
 * that does not stand and is paid back, and a yard kept on more land than this Leaf's, which is a
 * newer Leaf's and not read.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as F from "../src/index.ts";
import { outward } from "./ring.ts";
import { staged } from "./yards.ts";

/** The script's output and exit code over a folder of these kept yards. */
function resave(yards: Readonly<Record<string, string>>): { out: string; code: number } {
  const folder = mkdtempSync(join(tmpdir(), "resave-"));
  try {
    for (const [name, text] of Object.entries(yards)) writeFileSync(join(folder, `${name}.json`), text);
    const run = Bun.spawnSync(["bun", join(import.meta.dir, "..", "tools", "resave.ts"), folder]);
    return { out: run.stdout.toString(), code: run.exitCode };
  } finally {
    rmSync(folder, { recursive: true });
  }
}

describe("the dry run of the codec", () => {
  test("passes yards read whole", () => {
    expect(resave({ mid: F.encode(staged("mid")) })).toMatchObject({
      code: 0,
      out: expect.stringContaining("0 differ"),
    });
  });

  test("fails on a piece that did not stand, paid back into the till", () => {
    const y = staged("mid");
    const text = F.encode(y);
    // A gatherer on bare ground beside the depot, where it gathers nothing: it cannot stand, and is paid back.
    const [x, z] = [y.land.depot[0] - 3, y.land.depot[1] + 1];
    const record: unknown = JSON.parse(text);
    const bytes = [1, ...varint(F.at(y, x, z)), F.GATHERER];
    const lost = JSON.stringify(Object.assign({}, record, { cells: F.toBase64(Uint8Array.from(bytes)) }));
    const { out, code } = resave({ lost });
    expect(code).toBe(1);
    expect(out).toContain("did not stand");
    expect(out).toContain("Coins paid back into the till");
  });

  test("goes on past a save whose text is not JSON, and counts it", () => {
    const { out, code } = resave({ broken: JSON.stringify({ text: "not JSON" }), mid: F.encode(staged("mid")) });
    expect([code, out.includes("is not a kept yard"), out.includes("2 yards, 1 differ")]).toEqual([1, true, true]);
  });

  test("fails on a yard kept on more land, which it does not read", () => {
    const { out, code } = resave({ outward: F.encode(outward()) });
    expect([code, out.includes("kept on more land")]).toEqual([1, true]);
  });
});

/** A whole number below 16,384 as the packed bytes write it, seven bits a byte. */
const varint = (v: number): number[] => (v < 128 ? [v] : [(v & 127) | 128, v >> 7]);
