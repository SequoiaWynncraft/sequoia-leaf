/**
 * The allocation guard's reading of hooks (`calls.ts`), on a folder laid out as the package's source:
 * a tick that calls each kind's `work` through its table, and two kinds whose `work` makes an array,
 * one written as an arrow and one as a method. The guard finds both.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { reached } from "./calls.ts";

const TICK = `import { RULES } from "./kinds/list.ts";
const KIT = {};
const WORK = RULES.map((r) => r.work);
export function step(y: { kind: number[] }): void {
  for (let i = 0; i < y.kind.length; i++) WORK[y.kind[i] ?? 0]?.(KIT, y, i);
}
`;
const LIST = `import { lean } from "./lean.ts";
import { bare } from "./bare.ts";
export const RULES = [lean.rules, bare.rules];
`;
const ARROW = `export const lean = {
  name: "lean",
  rules: {
    work: (_k: unknown, y: { kind: number[] }) => {
      const made = new Uint8Array(3);
      y.kind[0] = made[0] ?? 0;
    },
  },
};
`;
const METHOD = `export const bare = {
  name: "bare",
  rules: {
    work(_k: unknown, y: { kind: number[] }) {
      const made = new Uint8Array(3);
      y.kind[0] = made[0] ?? 0;
    },
  },
};
`;

describe("the allocation guard", () => {
  test("reads a kind's hook written as a method as it reads one written as an arrow: what each makes is found", () => {
    const at = mkdtempSync(join(tmpdir(), "calls-"));
    try {
      mkdirSync(join(at, "kinds"));
      for (const [file, text] of [
        ["tick.ts", TICK],
        ["kinds/list.ts", LIST],
        ["kinds/lean.ts", ARROW],
        ["kinds/bare.ts", METHOD],
      ] as const)
        writeFileSync(join(at, file), text);
      const found = reached("tick.ts", "step", new Set(), pathToFileURL(`${at}/`));
      expect(found.reached.toSorted()).toEqual([
        "kinds/bare.ts:rules.work",
        "kinds/lean.ts:rules.work",
        "tick.ts:step",
      ]);
      expect(found.makes.map((m) => m.split(": …")[0] ?? "").toSorted((a, b) => a.localeCompare(b))).toEqual([
        "kinds/bare.ts:rules.work: new",
        "kinds/lean.ts:rules.work: new",
      ]);
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  });
});
