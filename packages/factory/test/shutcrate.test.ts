/**
 * A crate that is full and shut never takes anything (`kinds/say.ts`): a piece whose finished thing has
 * one just ahead is in trouble, and says so, whatever its kind, a mill and a gatherer alike. Open, the
 * full crate may yet let things out and take more: the piece waits, not in trouble.
 */
import { expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { must } from "./yards.ts";

/** A yard with a piece of `kind` at (5, 5) facing east, holding `out` ready, and a full shut crate just ahead: the piece's tile. */
function against(kind: string, out: F.ItemName): { y: F.Yard; i: number } {
  const y = F.create({ land: bareLand(30, 20, [[5, 5, "stone"]], [25, 10]), tier: 8, seed: 1 });
  for (const x of [21, 17, 13, 9, 5]) must(y, { do: "build", kind: "pylon", x, y: 8, dir: 0 });
  must(y, { do: "build", kind, x: 5, y: 5, dir: 0 });
  must(y, { do: "build", kind: "crate", x: 6, y: 5, dir: 0 });
  must(y, { do: "crate", x: 6, y: 5, open: false });
  const crate = F.holderOf(y, F.at(y, 6, 5));
  for (let k = 0; k < y.open.crate; k++) F.put(y.holders, crate, F.item("plank"));
  const i = F.at(y, 5, 5);
  y.holders.out[F.holderOf(y, i)] = F.item(out);
  F.changed(y);
  return { y, i };
}

test("a mill or a gatherer with a full shut crate just ahead is in trouble; opened, it waits", () => {
  const seen = (["mill", "gatherer"] as const).map((kind) => {
    const { y, i } = against(kind, kind === "mill" ? "plank" : "stone");
    const shut = F.status(y, i);
    must(y, { do: "crate", x: 6, y: 5, open: true });
    const open = F.status(y, i);
    return [kind, shut?.state, shut?.trouble, shut?.line, open?.state, open?.trouble];
  });
  expect(seen).toEqual([
    ["mill", "blocked", true, "The crate it points at is full and shut.", "waiting", false],
    ["gatherer", "blocked", true, "The crate it points at is full and shut.", "waiting", false],
  ]);
});
