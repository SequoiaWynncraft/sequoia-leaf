/**
 * Blueprint codes on the page, by what the line over the dock prints, against a stand-in Leaf: Copy
 * code for an area blueprint in hand (never a plan of the whole yard), Paste code with Select in hand
 * and nothing marked, and a pasted code kept in the place chosen, on the page and on Leaf alike: at
 * once in an empty place, on a second press over a kept one; a broken code is refused with the rules'
 * sentence and sends nothing.
 */
import { describe, expect, test } from "bun:test";

import { blueprintCode, create, play, readCommand, within, type Yard } from "@sequoia-leaf/factory";
import { asking, pressedTwice } from "@sequoia-leaf/kit/dom.ts";
import { press } from "@sequoia-leaf/kit/standin.ts";

import { ctx, opened, until, useFakeLeaf } from "../test/fake-leaf.ts";
import { codeIn, pasteIn, pasteKey } from "./plans.ts";
import { handSession, S } from "./state.ts";
import { cancel, hold, setTool } from "./tools.ts";
import { handPrint } from "./ui/dock.ts";

useFakeLeaf();

/** Plays a command on a yard as the rules take it, or the test fails. */
function must(y: Yard, c: Record<string, unknown>): void {
  const read = readCommand({ tick: y.tick, ...c });
  const did = read ? play(y, read) : null;
  if (!did || "refused" in did) throw new Error(`${JSON.stringify(c)} was not done`);
}

/** A yard Leaf has at a tier, every goal below it done, with a mill and a belt kept in place 0 and, at tier 5, the whole yard in place 1. */
function yard(tier = 5): Yard {
  const y = create({ seed: 5, tier });
  must(y, { do: "build", kind: "mill", x: 29, y: 20, dir: 2 });
  must(y, { do: "build", kind: "belt", x: 28, y: 20, dir: 2 });
  if (y.open.blueprints > 0) must(y, { do: "saveBlueprint", slot: 0, tiles: within(y, 28, 20, 29, 20) });
  if (tier === 5) must(y, { do: "saveYard", slot: 1 });
  y.history = [];
  y.at = ctx().now;
  return y;
}

/** The code of a blueprint of two belts, kept in a yard somewhere else. */
function twoBelts(): string {
  const y = create({ seed: 9, tier: 5 });
  must(y, { do: "build", kind: "belt", x: 21, y: 15, dir: 0 });
  must(y, { do: "build", kind: "belt", x: 22, y: 15, dir: 0 });
  must(y, { do: "saveBlueprint", slot: 0, tiles: within(y, 21, 15, 22, 15) });
  const kept = y.blueprints[0];
  const code = kept ? blueprintCode(kept) : null;
  if (code === null) throw new Error("no code");
  return code;
}

/** The commands Leaf was sent, by what each did. */
const sent = (leaf: { commands: unknown[] }): unknown[] =>
  leaf.commands.map((c) => (typeof c === "object" && c !== null && "do" in c ? c.do : null));

describe("Copy code", () => {
  test("is offered for a blueprint of an area in hand, and not for a plan of the whole yard", async () => {
    await opened(yard(), 1000);
    setTool("select");
    expect(handPrint().copy).toBeNull();
    hold(0);
    expect(handPrint().copy).toEqual({ slot: 0, copied: false });
    const kept = S.world.blueprints[0];
    expect(codeIn(0)).toBe(kept ? blueprintCode(kept) : "");
    cancel();
    hold(1);
    expect([handPrint().bin?.slot, handPrint().copy, codeIn(1)]).toEqual([1, null, null]);
  });
});

describe("Paste code", () => {
  test("is not offered before the yard keeps blueprints", async () => {
    await opened(yard(2), 1000);
    setTool("select");
    expect(handPrint().paste).toBe(false);
  });

  test("is offered with Select in hand and nothing marked", async () => {
    await opened(yard(), 1000);
    setTool("select");
    expect(handPrint().paste).toBe(true);
    hold(0);
    expect(handPrint().paste).toBe(false);
  });

  test("keeps the pasted blueprint in an empty place at once, on the page and on Leaf alike", async () => {
    const fake = await opened(yard(), 1000);
    setTool("select");
    const code = twoBelts();
    expect(pasteIn(2, `  ${code}\n`)).toBeNull();
    expect(codeIn(2)).toBe(code);
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(5);
    expect(sent(fake.leaf)).toEqual(["pasteBlueprint"]);
    expect(fake.leaf.yard.blueprints[2]).toEqual(S.world.blueprints[2]);
  });

  test("over a kept place, asks again for what it pastes there, and keeps it on a second press", async () => {
    await opened(yard(), 1000);
    setTool("select");
    const code = twoBelts();
    const key = pasteKey(0, code);
    expect(key.on).toMatch(/^paste:0:area:\d+:\d+@\d+$/);
    press();
    expect([pressedTwice(handSession(), key, () => {}), asking(key)]).toEqual([false, true]);
    // Another code over the same place is another question.
    expect(asking(pasteKey(0, `${code}A`))).toBe(false);
    press();
    expect(pressedTwice(handSession(), key, () => {})).toBe(true);
    expect(pasteIn(0, code)).toBeNull();
    expect(codeIn(0)).toBe(code);
  });

  test("a broken code is refused with the rules' sentence and sends nothing", async () => {
    const fake = await opened(yard(), 1000);
    setTool("select");
    const kept = S.world.blueprints[0];
    expect(pasteIn(0, "wb1.nothing")).toBe("That is not a blueprint code.");
    expect(S.world.blueprints[0]).toBe(kept);
    await Bun.sleep(20);
    expect(sent(fake.leaf)).toEqual([]);
  });
});
