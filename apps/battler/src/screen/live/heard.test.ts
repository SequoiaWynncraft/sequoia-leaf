import { afterEach, expect, jest, test } from "bun:test";

import type { LiveEars, LiveRoom } from "@sequoia-leaf/kit/realtime.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";
import { type Reply, type Standin, standin } from "@sequoia-leaf/kit/standin.ts";
import { type Call, command, openSitting } from "@sequoia-leaf/raid/sitting/commands.ts";
import type { Sitting } from "@sequoia-leaf/raid/sitting/sitting.ts";
import { sittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { GATHER_MS, hearFresh, hearing, hearLive, LINGER_MS, POLL_EVERY } from "./heard.ts";
import { openLine } from "./line.ts";
import { followTables, T } from "./listing.ts";
import { doneWithTable } from "./seated.ts";

const ME = { id: "leaf-0", name: "Mossback" };
const call = (n: number): Call => ({ now: n, seed: 7 + n, player: { id: `leaf-${n}`, name: `M${n}` } });
const wire = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
/** A sitting's answer as Leaf sends it, at a revision. */
const answer = (rev: number, t: Sitting) => ({
  id: "s1",
  rev,
  now: new Date(1000).toISOString(),
  state: wire(sittingView(t, ME.id)),
});
const unchanged = (rev: number) => ({ id: "s1", rev, now: new Date(1000).toISOString(), unchanged: true });

/** An open sitting at four revisions: one member sat, then two, three and four. */
function revisions(): Sitting[] {
  const all = [openSitting(call(0))];
  for (let n = 1; n < 4; n++) {
    const sat = command(all[n - 1] ?? openSitting(call(0)), { do: "sit" }, call(n));
    if (!sat.ok) throw new Error(sat.why);
    all.push(sat.sitting);
  }
  return all;
}

/** Lets what was asked of the stand-in land: a few turns of the microtasks. */
async function landed(): Promise<void> {
  // oxlint-disable-next-line no-await-in-loop -- one turn of the microtasks at a time
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

/** Time passes, for the page's clock and its timers alike, a second at a most at a time (the card's look). */
async function pass(ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= 1000) {
    const step = Math.min(1000, left);
    if (world) world.clock.now += step;
    jest.advanceTimersByTime(step);
    // oxlint-disable-next-line no-await-in-loop -- each second's reads land before the next second's look
    await landed();
  }
}

/** A live room that only says what it is told to, with what the page gave it to hear on (`ears`). */
function fakeRoom(): { room: LiveRoom; ears: () => LiveEars; opened: () => number; closed: () => number } {
  const made: { ears: LiveEars; opened: number; closed: number } = { ears: {}, opened: 0, closed: 0 };
  const room: LiveRoom = {
    members: () => new Map(),
    you: () => null,
    move: () => undefined,
    act: () => undefined,
    sample: () => null,
    serverNow: () => 0,
    rtt: () => null,
    go: () => undefined,
    state: () => ({ at: "joining" }),
    close: () => {
      made.closed++;
    },
  };
  hearFresh((_room, ears) => {
    made.ears = ears;
    made.opened++;
    return room;
  });
  return { room, ears: () => made.ears, opened: () => made.opened, closed: () => made.closed };
}

let world: Standin | null = null;
afterEach(() => {
  jest.useRealTimers();
  doneWithTable();
  hearFresh();
  world?.done();
  world = null;
});

/** The reads of the sitting the page asked for, by the `rev` each sent. */
const reads = (): string[] =>
  (world?.sent ?? []).filter((s) => s.method === "GET" && s.path.startsWith("/v1/game/sittings/s1")).map((s) => s.path);

test("two nudges close together make one read; one for the `rev` the page has, or older, makes none", async () => {
  jest.useFakeTimers();
  const [one, , , four] = revisions();
  if (!one || !four) throw new Error("no sitting");
  world = standin({ "GET /v1/game/sittings/s1": { status: 200, body: answer(4, four) } });
  const line = openLine(scope(), "s1", ME.id, answer(1, one), () => true);
  if (!line) throw new Error("no line");
  line.heard(1);
  line.heard(0);
  jest.advanceTimersByTime(GATHER_MS * 5);
  await landed();
  expect(reads()).toEqual([]);
  line.heard(2);
  line.heard(3);
  jest.advanceTimersByTime(GATHER_MS);
  await landed();
  // One read, sending the `rev` the page had; its answer is newer than either word.
  expect(reads()).toEqual(["/v1/game/sittings/s1?rev=1"]);
  expect(line.view).toEqual(sittingView(four, ME.id));
  line.heard(4);
  jest.advanceTimersByTime(GATHER_MS * 5);
  await landed();
  expect(reads()).toHaveLength(1);
  line.close();
});

test("a word newer than the answer to the read it made is read again: the read went before the change", async () => {
  jest.useFakeTimers();
  const [one, two, three] = revisions();
  if (!one || !two || !three) throw new Error("no sitting");
  const answers = [answer(2, two), answer(3, three)];
  world = standin({ "GET /v1/game/sittings/s1": () => ({ status: 200, body: answers.shift() ?? unchanged(3) }) });
  const line = openLine(scope(), "s1", ME.id, answer(1, one), () => true);
  if (!line) throw new Error("no line");
  line.heard(3);
  jest.advanceTimersByTime(GATHER_MS);
  await landed();
  expect(reads()).toEqual(["/v1/game/sittings/s1?rev=1"]);
  jest.advanceTimersByTime(GATHER_MS);
  await landed();
  expect(reads()).toEqual(["/v1/game/sittings/s1?rev=1", "/v1/game/sittings/s1?rev=2"]);
  expect(line.view).toEqual(sittingView(three, ME.id));
  line.close();
});

test("in the live room the sitting is not read on a timer; out of it, every 5 seconds; back in, read once", async () => {
  jest.useFakeTimers();
  const [one] = revisions();
  if (!one) throw new Error("no sitting");
  world = standin({ "GET /v1/game/sittings/s1": { status: 200, body: unchanged(1) } });
  const live = { now: false };
  // An open sitting, which the page read every 2 seconds before Leaf said when it changed.
  const line = openLine(scope(), "s1", ME.id, answer(1, one), () => live.now);
  if (!line) throw new Error("no line");
  jest.advanceTimersByTime(POLL_EVERY - 1);
  await landed();
  expect(reads()).toHaveLength(0);
  jest.advanceTimersByTime(1);
  await landed();
  expect(reads()).toHaveLength(1);
  jest.advanceTimersByTime(POLL_EVERY);
  await landed();
  expect(reads()).toHaveLength(2);
  // Into the room: what Leaf said before was not heard, so once now; then nothing for a minute.
  live.now = true;
  line.liveMoved(true);
  await landed();
  expect(reads()).toHaveLength(3);
  jest.advanceTimersByTime(60_000);
  await landed();
  expect(reads()).toHaveLength(3);
  // Out of it again: every 5 seconds once more.
  live.now = false;
  line.liveMoved(false);
  jest.advanceTimersByTime(POLL_EVERY);
  await landed();
  expect(reads()).toHaveLength(4);
  line.close();
});

test("the connection is held while wanted and let go of once nothing has wanted it for a while; told it is replaced, none is opened again", () => {
  world = standin({});
  const fake = fakeRoom();
  hearLive(true);
  hearLive(true);
  expect(fake.opened()).toBe(1);
  // Unwanted, it lingers, and wanted again meanwhile, it stays.
  hearLive(false);
  world.clock.now += LINGER_MS - 1;
  hearLive(false);
  expect(fake.closed()).toBe(0);
  hearLive(true);
  world.clock.now += LINGER_MS;
  hearLive(false);
  expect(fake.closed()).toBe(0);
  world.clock.now += LINGER_MS;
  hearLive(false);
  expect(fake.closed()).toBe(1);
  // Opened again, welcomed, then replaced by another page: not hearing, and nothing opened after.
  hearLive(true);
  expect(fake.opened()).toBe(2);
  fake.ears().welcome?.(1, "sittings/1", [], false);
  expect(hearing()).toBe(true);
  fake.ears().status?.("replaced");
  expect(hearing()).toBe(false);
  world.clock.now += LINGER_MS;
  hearLive(false);
  hearLive(true);
  expect(fake.opened()).toBe(2);
});

test("the open tables are read on Leaf's word, once for two, not on a timer while heard, every 5 seconds while not", async () => {
  jest.useFakeTimers();
  const fake = fakeRoom();
  world = standin({
    "GET /v1/game/sittings": (): Reply => ({
      status: 200,
      body: { now: new Date(0).toISOString(), open: [], yours: null },
    }),
  });
  const lists = (): number => (world?.sent ?? []).filter((s) => s.path === "/v1/game/sittings").length;
  const held = scope();
  followTables(
    held,
    ME,
    () => undefined,
    () => true,
  );
  await landed();
  // The page's first read; the card is up, so the connection opens at the first look.
  expect(lists()).toBe(1);
  await pass(1000);
  expect(fake.opened()).toBe(1);
  // Not in the room yet: 5 seconds after the last read, another.
  await pass(POLL_EVERY - 1000);
  expect(lists()).toBe(2);
  // Welcomed: read once for what was not heard, then nothing on a timer.
  fake.ears().welcome?.(1, "sittings/1", [], false);
  await pass(GATHER_MS);
  expect(lists()).toBe(3);
  await pass(60_000);
  expect(lists()).toBe(3);
  // Two words close together: one read.
  fake.ears().nudged?.({ t: "sittings" });
  fake.ears().nudged?.({ t: "sittings" });
  await pass(GATHER_MS);
  expect(lists()).toBe(4);
  // A word of somebody's sitting the page does not follow is not the list's.
  fake.ears().nudged?.({ t: "sitting", id: "elsewhere", rev: 4 });
  await pass(GATHER_MS * 5);
  expect(lists()).toBe(4);
  // Dropped: every 5 seconds until it is back.
  fake.ears().status?.("closed");
  await pass(POLL_EVERY);
  expect(lists()).toBe(5);
  await pass(POLL_EVERY);
  expect(lists()).toBe(6);
  held.close();
  T.shown = () => false;
});

test("a table on the list is read again as it closes, by Leaf's clock rather than the page's", async () => {
  jest.useFakeTimers();
  const fake = fakeRoom();
  const leafNow = Date.UTC(2026, 10, 27, 12);
  const listed = [{ id: "t1", by: { id: "leaf-3", name: "Sootpaw" }, sat: 1, closes: new Date(leafNow + 10_000) }];
  world = standin({
    "GET /v1/game/sittings": (): Reply => ({
      status: 200,
      body: { now: new Date(leafNow).toISOString(), open: wire(listed), yours: null },
    }),
  });
  const lists = (): number => (world?.sent ?? []).filter((s) => s.path === "/v1/game/sittings").length;
  const held = scope();
  followTables(
    held,
    ME,
    () => undefined,
    () => true,
  );
  await pass(1000);
  fake.ears().welcome?.(1, "sittings/1", [], false);
  await pass(GATHER_MS);
  expect(lists()).toBe(2);
  listed.length = 0;
  // The page's clock is far from Leaf's; the table closes 10 seconds after Leaf's `now` all the same.
  await pass(9000);
  expect(lists()).toBe(2);
  await pass(2000);
  expect(lists()).toBe(3);
  // Nothing more to close: nothing more read.
  await pass(60_000);
  expect(lists()).toBe(3);
  held.close();
  T.shown = () => false;
});
