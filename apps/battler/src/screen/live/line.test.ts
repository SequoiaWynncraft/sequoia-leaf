import { afterEach, expect, test } from "bun:test";

import { scope } from "@sequoia-leaf/kit/scope.ts";
import { type Reply, type Standin, standin } from "@sequoia-leaf/kit/standin.ts";
import { type Call, command, openSitting } from "@sequoia-leaf/raid/sitting/commands.ts";
import type { Sitting } from "@sequoia-leaf/raid/sitting/sitting.ts";
import { sittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { openLine } from "./line.ts";

const call = (n: number): Call => ({ now: n, seed: 7 + n, player: { id: `leaf-${n}`, name: `M${n}` } });
const wire = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
/** A sitting's answer as Leaf sends it, at a revision. */
const answer = (rev: number, t: Sitting) => ({
  id: "s1",
  rev,
  now: new Date(1000).toISOString(),
  state: wire(sittingView(t, "leaf-0")),
});

/** An open sitting at three revisions: one member sat, then two, then three. */
function revisions(): Sitting[] {
  const all = [openSitting(call(0))];
  for (let n = 1; n < 3; n++) {
    const sat = command(all[n - 1] ?? all[0] ?? openSitting(call(0)), { do: "sit" }, call(n));
    if (!sat.ok) throw new Error(sat.why);
    all.push(sat.sitting);
  }
  return all;
}

/** Waits until something holds, a millisecond at a time (at most 50). */
async function until(holds: () => boolean, tries = 50): Promise<void> {
  if (tries === 0 || holds()) return;
  await Bun.sleep(1);
  await until(holds, tries - 1);
}

let world: Standin | null = null;
afterEach(() => world?.done());

test("one read at a time: an ask during a read makes one more after it, and an older answer never rolls the table back", async () => {
  const [one, two, three] = revisions();
  if (!one || !two || !three) throw new Error("no sitting");
  const answers: ((reply: Reply) => void)[] = [];
  world = standin({
    "GET /v1/game/sittings/s1": () => new Promise<Reply>((reply) => answers.push(reply)),
  });
  const held = scope();
  const line = openLine(held, "s1", "leaf-0", answer(1, one));
  if (!line) throw new Error("no line");
  // A deadline's ask and the page coming back: one read on its way, and one owed after it.
  line.read();
  await until(() => answers.length >= 1, 500);
  line.read();
  await Bun.sleep(150);
  expect(answers.length).toBe(1);
  answers[0]?.({ status: 200, body: answer(3, three) });
  await until(() => answers.length >= 2, 500);
  expect(line.view).toEqual(sittingView(three, "leaf-0"));
  // The second read is answered with an older revision (as a slow server's might be): it is not taken.
  answers[1]?.({ status: 200, body: answer(2, two) });
  await Bun.sleep(150);
  expect(answers.length).toBe(2);
  expect(line.view).toEqual(sittingView(three, "leaf-0"));
  // A read Leaf answers unchanged changes nothing.
  line.read();
  await until(() => answers.length >= 3, 500);
  answers[2]?.({ status: 200, body: { id: "s1", rev: 3, now: new Date(1000).toISOString(), unchanged: true } });
  await Bun.sleep(150);
  expect(line.view).toEqual(sittingView(three, "leaf-0"));
  line.close();
  held.close();
});

test("putting the line away answers every command still waiting, so nothing waits on it after leaving", async () => {
  const [one] = revisions();
  if (!one) throw new Error("no sitting");
  world = standin({ "POST /v1/game/sittings/s1": () => new Promise<Reply>(() => undefined) });
  const held = scope();
  const line = openLine(held, "s1", "leaf-0", answer(1, one));
  if (!line) throw new Error("no line");
  const sent = line.send({ do: "start" });
  const queued = line.send({ do: "leave" });
  await until(() => (world?.sent.length ?? 0) > 0);
  expect(line.waiting()).toBe(true);
  line.close();
  expect(await sent).toEqual({ refused: "gone", why: "" });
  expect(await queued).toEqual({ refused: "gone", why: "" });
  expect(line.waiting()).toBe(false);
  held.close();
});
