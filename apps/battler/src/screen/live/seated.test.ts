import { afterEach, describe, expect, test } from "bun:test";

import { isRecord } from "@sequoia-leaf/kit/net.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";
import { type Reply, type Route, type Sent, type Standin, standin } from "@sequoia-leaf/kit/standin.ts";
import { foughtOf, newTable, type RaidNote, startRun, tableView } from "@sequoia-leaf/raid";
import { advance } from "@sequoia-leaf/raid/sitting/clock.ts";
import { type Call, command, openSitting } from "@sequoia-leaf/raid/sitting/commands.ts";
import { CLOCK, type Sitting } from "@sequoia-leaf/raid/sitting/sitting.ts";
import { sittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { ask, go, onNotes, onRefused, openTable, S, tableNow } from "../state.ts";
import { openLine } from "./line.ts";
import { CLOSED_UNSTARTED, NOT_SEATED } from "./reads.ts";
import { liveLine, liveView, onDone, paidFor, shownRun, sitAt, stepBack, takeUp } from "./seated.ts";

const ME = { id: "leaf-0", name: "Mossback" };
const call = (now: number, seed: number): Call => ({ now, seed, player: ME });
const wire = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
/** A sitting's answer as Leaf sends it, at a revision and a moment. */
const answer = (id: string, rev: number, t: Sitting, now: number, results: unknown[] = []) => ({
  id,
  rev,
  now: new Date(now).toISOString(),
  state: wire(sittingView(t, ME.id)),
  results,
});

/** The member and seven regulars, at the first room's planning, and a moment early in it. */
function planning(): { t: Sitting; now: number } {
  let t = openSitting(call(0, 3));
  const started = command(t, { do: "start" }, call(1000, 4));
  if (!started.ok) throw new Error(started.why);
  t = started.sitting;
  for (let guard = 0; guard < 10 && t.stage.at !== "plan"; guard++)
    t = advance(t, t.stage.at === "over" ? 0 : t.stage.until);
  if (t.stage.at !== "plan") throw new Error("not planning");
  return { t, now: t.stage.until - 25_000 };
}

/** The solo raid as Leaf has it: a run of its own. */
function soloTable(): unknown {
  const table = newTable({ seed: 1 });
  table.run = startRun(5);
  return { state: wire(tableView(table, { awards: [], now: 0 })), rev: 0 };
}

const heard: RaidNote[] = [];
const refused: string[] = [];
onNotes((notes) => heard.push(...notes));
onRefused((why) => refused.push(why));

/** Waits until something holds, a millisecond at a time (at most 50). */
async function until(holds: () => boolean, tries = 50): Promise<void> {
  if (tries === 0 || holds()) return;
  await Bun.sleep(1);
  await until(holds, tries - 1);
}

let world: Standin | null = null;
afterEach(() => {
  stepBack();
  world?.done();
  heard.length = 0;
  refused.length = 0;
});

/** Leaf for the sitting: the rustle the member sends is answered when the test says, by the rules. */
function sittingLeaf(t: Sitting, now: number) {
  const posted: { sent: Sent; reply: (r: Reply) => void }[] = [];
  const rustled = command(t, { do: "rustle" }, call(now, 9));
  if (!rustled.ok) throw new Error(rustled.why);
  const answerRustle = (): void => {
    const p = posted[0];
    const commands = p && isRecord(p.sent.body) && Array.isArray(p.sent.body.commands) ? p.sent.body.commands : [];
    const id = isRecord(commands[0]) ? commands[0].id : "";
    p?.reply({ status: 200, body: answer("s1", 2, rustled.sitting, now, [{ id, notes: wire(rustled.notes) }]) });
  };
  const routes: Record<string, Route | Reply> = {
    "GET /v1/game/play/raid": { status: 200, body: soloTable() },
    "GET /v1/game/sittings/s1": {
      status: 200,
      body: { id: "s1", rev: 1, now: new Date(now).toISOString(), unchanged: true },
    },
    "POST /v1/game/sittings/s1": (sent: Sent) => new Promise<Reply>((reply) => posted.push({ sent, reply })),
  };
  return { routes, posted, answerRustle, after: sittingView(rustled.sitting, ME.id) };
}

async function seated(t: Sitting, now: number, routes: Record<string, Route | Reply>) {
  world = standin(routes);
  expect(await openTable("solo-player", () => undefined)).toBeNull();
  const line = openLine(scope(), "s1", ME.id, answer("s1", 1, t, now));
  if (!line) throw new Error("no line");
  takeUp(line);
  expect(sitAt()).toBe(true);
  go({ e: "sit", ...tableNow() });
  expect(S.run).toEqual(shownRun(line.view));
  return line;
}

describe("an answer for the live seat", () => {
  test("arrives after the member went to the front page: the solo run and its strip are as they were", async () => {
    const { t, now } = planning();
    const leaf = sittingLeaf(t, now);
    await seated(t, now, leaf.routes);
    const pending = ask({ do: "rustle" });
    await until(() => leaf.posted.length > 0);
    stepBack();
    const solo = S.run;
    expect(solo?.stall).toEqual(startRun(5).stall);
    leaf.answerRustle();
    expect(await pending).toBeNull();
    // The line took Leaf's answer; the solo raid heard nothing of it.
    expect(liveView()).toEqual(leaf.after);
    expect(S.run).toBe(solo);
    expect(tableNow().run).toEqual(solo);
    expect(heard).toEqual([]);
    expect(refused).toEqual([]);
  });

  test("arrives while the member is at the table: it is shown, and its notes heard", async () => {
    const { t, now } = planning();
    const leaf = sittingLeaf(t, now);
    await seated(t, now, leaf.routes);
    const pending = ask({ do: "rustle" });
    await until(() => leaf.posted.length > 0);
    leaf.answerRustle();
    expect((await pending)?.ok).toBe(true);
    expect(S.run).toEqual(shownRun(leaf.after));
    expect(heard.some((n) => n.t === "rustled")).toBe(true);
  });
});

test("a table that closed before it started lets the member go, and says so", async () => {
  const open = openSitting(call(0, 5));
  const closed = advance(open, CLOCK.open + 1);
  expect(closed.stage.at).toBe("over");
  world = standin({ "GET /v1/game/sittings/s2": { status: 200, body: answer("s2", 2, closed, CLOCK.open + 1) } });
  const line = openLine(scope(), "s2", ME.id, answer("s2", 1, open, 1000));
  if (!line) throw new Error("no line");
  takeUp(line);
  const told: (string | null)[] = [];
  onDone((why) => told.push(why));
  line.read();
  await until(() => liveLine() === null, 500);
  expect(liveLine()).toBeNull();
  expect(told).toEqual([CLOSED_UNSTARTED]);
});

test("opened during a fight, the room's takings are told when the table goes on", async () => {
  const { t } = planning();
  const fight = advance(t, t.stage.at === "plan" ? t.stage.until : 0);
  if (fight.stage.at !== "fight") throw new Error("not fighting");
  const after = advance(fight, fight.stage.until);
  world = standin({
    "GET /v1/game/sittings/s3": { status: 200, body: answer("s3", 3, after, fight.stage.until + 10) },
  });
  const line = openLine(scope(), "s3", ME.id, answer("s3", 2, fight, fight.stage.until - 5000));
  if (!line) throw new Error("no line");
  takeUp(line);
  // The page is opened now: the member sits down to the fight already being fought.
  expect(sitAt()).toBe(true);
  line.read();
  await until(() => liveView()?.stage.at !== "fight", 500);
  const view = liveView();
  if (!view) throw new Error("no sitting");
  const paid = paidFor(view);
  const setOut = sittingView(fight, ME.id).run;
  const fought = setOut ? foughtOf(setOut) : null;
  if (!fought) throw new Error("the seat is not fighting");
  expect(paid?.result).toBe(fought.outcome.result);
  expect(paid?.lines[0]).toMatch(/^(Room won|Room lost|A draw)$/);
  // Told once.
  expect(paidFor(view)).toBeNull();
});

test("left in another tab: the next read shows the member without a seat, and the page lets the table go", async () => {
  // Somebody opened the table, and the member sat; in another tab the member then got up.
  const opened = openSitting({ now: 0, seed: 11, player: { id: "leaf-9", name: "Sootpaw" } });
  const sat = command(opened, { do: "sit" }, call(10, 12));
  if (!sat.ok) throw new Error(sat.why);
  const left = command(sat.sitting, { do: "leave" }, call(20, 13));
  if (!left.ok) throw new Error(left.why);
  expect(left.sitting.stage.at).toBe("open");
  world = standin({ "GET /v1/game/sittings/s4": { status: 200, body: answer("s4", 3, left.sitting, 30) } });
  const line = openLine(scope(), "s4", ME.id, answer("s4", 2, sat.sitting, 15));
  if (!line) throw new Error("no line");
  takeUp(line);
  const told: (string | null)[] = [];
  onDone((why) => told.push(why));
  line.read();
  await until(() => liveLine() === null, 500);
  expect(liveLine()).toBeNull();
  expect(told).toEqual([NOT_SEATED]);
});
