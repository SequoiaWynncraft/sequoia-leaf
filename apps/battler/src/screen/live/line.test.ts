import { afterEach, expect, test } from "bun:test";

import { scope } from "@sequoia-leaf/kit/scope.ts";
import { type Reply, type Standin, standin, until } from "@sequoia-leaf/kit/standin.ts";
import { type Call, command, openSitting } from "@sequoia-leaf/raid/sitting/commands.ts";
import type { Sitting } from "@sequoia-leaf/raid/sitting/sitting.ts";
import { sittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { CAROUSEL_EVERY, openLine } from "./line.ts";

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
  await until(() => answers.length >= 1, "the first read");
  line.read();
  await Bun.sleep(150);
  expect(answers.length).toBe(1);
  answers[0]?.({ status: 200, body: answer(3, three) });
  await until(() => answers.length >= 2, "the read owed after it");
  expect(line.view).toEqual(sittingView(three, "leaf-0"));
  // The second read is answered with an older revision (as a slow server's might be): it is not taken.
  answers[1]?.({ status: 200, body: answer(2, two) });
  await Bun.sleep(150);
  expect(answers.length).toBe(2);
  expect(line.view).toEqual(sittingView(three, "leaf-0"));
  // A read Leaf answers unchanged changes nothing.
  line.read();
  await until(() => answers.length >= 3, "the third read");
  answers[2]?.({ status: 200, body: { id: "s1", rev: 3, now: new Date(1000).toISOString(), unchanged: true } });
  await Bun.sleep(150);
  expect(line.view).toEqual(sittingView(three, "leaf-0"));
  line.close();
  held.close();
});

test("a stage's deadline is read within 100 ms after it, never before", async () => {
  const opened = command(openSitting(call(0)), { do: "start" }, { ...call(0), now: 1000 });
  if (!opened.ok || opened.sitting.stage.at === "over") throw new Error("not started");
  const due = opened.sitting.stage.until;
  const reads: number[] = [];
  world = standin({
    "GET /v1/game/sittings/s1": () => {
      reads.push(performance.now());
      return new Promise<Reply>(() => undefined);
    },
  });
  const held = scope();
  // Leaf's clock, as its answer says, is 200 ms short of the deadline.
  const began = performance.now();
  const line = openLine(held, "s1", "leaf-0", { ...answer(1, opened.sitting), now: new Date(due - 200).toISOString() });
  if (!line) throw new Error("no line");
  await until(() => reads.length > 0, "the read at the deadline");
  const after = (reads[0] ?? Infinity) - began - 200;
  expect(after).toBeGreaterThanOrEqual(0);
  expect(after).toBeLessThan(100);
  line.close();
  held.close();
});

test("Leaf's answer for a sitting in a shape this page cannot read (an older Leaf's, mid-deploy) loads the page again, opening as when reading", () => {
  const [one] = revisions();
  if (!one) throw new Error("no sitting");
  world = standin({});
  const started = command(one, { do: "start" }, { ...call(0), now: 1000 });
  if (!started.ok) throw new Error(started.why);
  const plan = { ...answer(1, started.sitting) };
  const state = Object(plan.state);
  // A carousel as an older Leaf shows it: no `ends`.
  delete state.stage.ends;
  expect(openLine(scope(), "s1", "leaf-0", plan)).toBeNull();
  expect(world.reloaded.count).toBe(1);
  // Something that is no sitting's answer at all loads nothing.
  expect(openLine(scope(), "s1", "leaf-0", { nonsense: true })).toBeNull();
  expect(world.reloaded.count).toBe(1);
});

test("a carousel the member has still to take from is read every take's length while the live room is down, so their turn is never missed", async () => {
  const opened = command(openSitting(call(0)), { do: "start" }, { ...call(0), now: 1000 });
  if (!opened.ok || opened.sitting.stage.at !== "carousel") throw new Error("no carousel");
  const reads: number[] = [];
  world = standin({
    "GET /v1/game/sittings/s1": () => {
      reads.push(performance.now());
      return { status: 200, body: { id: "s1", rev: 1, now: new Date(1100).toISOString(), unchanged: true } };
    },
  });
  const held = scope();
  const began = performance.now();
  // The live room is down, and the carousel's next moment is 11.9 seconds off.
  const line = openLine(
    held,
    "s1",
    "leaf-0",
    { ...answer(1, opened.sitting), now: new Date(1100).toISOString() },
    () => false,
  );
  if (!line) throw new Error("no line");
  await until(() => reads.length >= 2, "two reads of the carousel");
  expect((reads[0] ?? Infinity) - began).toBeLessThan(CAROUSEL_EVERY + 300);
  expect((reads[1] ?? Infinity) - (reads[0] ?? 0)).toBeLessThan(CAROUSEL_EVERY + 300);
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
  await until(() => (world?.sent.length ?? 0) > 0, "the command to be sent");
  expect(line.waiting()).toBe(true);
  line.close();
  expect(await sent).toEqual({ refused: "gone", why: "" });
  expect(await queued).toEqual({ refused: "gone", why: "" });
  expect(line.waiting()).toBe(false);
  held.close();
});
