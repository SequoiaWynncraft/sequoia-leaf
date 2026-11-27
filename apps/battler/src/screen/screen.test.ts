import { afterEach, describe, expect, test } from "bun:test";

import { type Ctx, isRefused } from "@sequoia-leaf/core";
import { type Reply, type Sent, type Standin, standin } from "@sequoia-leaf/kit/standin.ts";
import { RAID, type RaidCommand, type RaidNote, type RunView, type Table as Kept, tableView } from "@sequoia-leaf/raid";

import { endedIn, type Event, playbackOf, type Screen, shownCounts, step, type Table, watchable } from "./screen.ts";
import { again, ask, go, openTable, S, tableNow } from "./state.ts";

// ---------- a table played by the rules, for the screen to follow ----------

let rolled = 7;
const ctx = (): Ctx => ({
  now: 0,
  player: { id: "p", guest: false },
  seed: (rolled = (rolled * 48_271) % 2_147_483_647),
  room: 1e9,
  awards: [],
  postcards: {},
});
function must(state: Kept, command: RaidCommand): { state: Kept; notes: RaidNote[] } {
  const done = RAID.apply(state, command, ctx());
  if (isRefused(done)) throw new Error(`${command.do}: ${done.refused}`);
  return { state: done.state, notes: [...done.notes] };
}
/** A table with a run in its first room, its starter on the board. */
const begun = (): Kept =>
  must(must(RAID.create(ctx()), { do: "start", trail: 0 }).state, { do: "choose", option: 0 }).state;
const at = (state: Kept): Table => ({ run: tableView(state, ctx()).run, runs: state.runs });
const runOf = (state: Kept): RunView => {
  const run = tableView(state, ctx()).run;
  if (!run) throw new Error("no run");
  return run;
};
/** The screen after each event in turn. */
const after = (screen: Screen, ...events: Event[]): Screen => events.reduce(step, screen);

describe("the screen", () => {
  test("sitting down plans the room Leaf's run is in, plays the fight it is in, or with no run is the front page", () => {
    const planning = begun();
    const fighting = must(planning, { do: "fight" }).state;
    expect(after({ at: "front" }, { e: "sit", ...at(planning) })).toEqual({ at: "plan", looking: false });
    const fight = after({ at: "front" }, { e: "sit", ...at(fighting) });
    expect(fight.at === "fight" && fight.play.fought).toEqual(fightOf(fighting));
    expect(after({ at: "plan", looking: false }, { e: "sit", run: null, runs: 1 })).toEqual({ at: "front" });
  });

  test("a fight plays to its end whatever Leaf's run does meanwhile, and only its own end moves it on", () => {
    const fighting = must(begun(), { do: "fight" }).state;
    const fight = after({ at: "front" }, { e: "sit", ...at(fighting) });
    if (fight.at !== "fight") throw new Error("no fight");
    const moved = must(fighting, { do: "take" }).state;
    expect(after(fight, { e: "leaf", ...at(moved) }, { e: "front" }, { e: "played", key: "1:0:0" })).toBe(fight);
    const played = after(fight, { e: "played", key: fight.play.key });
    expect(played).toEqual({
      at: "after",
      play: fight.play,
      takings: { notes: null, counted: 0, landed: 0, done: false },
    });
  });

  test("the takings are counted out: each number shows as it was until its line is counted, the acorns as they land", () => {
    const fighting = must(begun(), { do: "fight" }).state;
    const play = playbackOf(runOf(fighting), structuredClone(fightOf(fighting)), fighting.runs);
    const taken = must(fighting, { do: "take" });
    const run = runOf(taken.state);
    const counting: Screen = {
      at: "after",
      play,
      takings: { notes: taken.notes, counted: 0, landed: 0, done: false },
    };
    expect(shownCounts(counting, run)).toEqual(play.before);
    const resolveAt = taken.notes.findIndex((n) => n.t === "resolve");
    const xpAt = taken.notes.findIndex((n) => n.t === "xp");
    const some = after(counting, { e: "count", upTo: Math.max(resolveAt, xpAt) + 1 }, { e: "landed" });
    expect(shownCounts(some, run)).toMatchObject({
      acorns: Math.min(run.acorns, play.before.acorns + 1),
      resolve: run.resolve,
    });
    expect(shownCounts(after(some, { e: "counted" }), run)).toEqual({
      acorns: run.acorns,
      resolve: run.resolve,
      xp: run.xp,
      level: run.level,
    });
    // Counting never goes back.
    expect(after(some, { e: "count", upTo: 1 })).toEqual(some);
  });

  test("Carry on goes to the next room as Leaf has it, or to the end when the takings ended the run", () => {
    const fighting = must(begun(), { do: "fight" }).state;
    const play = playbackOf(runOf(fighting), fightOf(fighting), fighting.runs);
    const taken = must(fighting, { do: "take" });
    const counted: Screen = { at: "after", play, takings: { notes: taken.notes, counted: 0, landed: 0, done: true } };
    expect(after(counted, { e: "carry", ...at(taken.state) })).toEqual({ at: "plan", looking: false });
    const home = must(taken.state, { do: "abandon" });
    const ended = endedIn(home.notes);
    if (!ended) throw new Error("not ended");
    const last: Screen = { ...counted, takings: { ...counted.takings, notes: home.notes } };
    expect(after(last, { e: "carry", ...at(home.state) })).toEqual({ at: "over", ended });
    // Not before Leaf has answered.
    const waiting: Screen = { ...counted, takings: { ...counted.takings, notes: null } };
    expect(after(waiting, { e: "carry", ...at(taken.state) })).toBe(waiting);
  });

  test("the front page is not gone to in the middle of a fight or its takings", () => {
    const fight = after({ at: "front" }, { e: "sit", ...at(must(begun(), { do: "fight" }).state) });
    expect(after(fight, { e: "front" })).toBe(fight);
    expect(after({ at: "plan", looking: true }, { e: "front" })).toEqual({ at: "front" });
  });

  test("while planning, the last fight's sheet opens and is put away; Leaf moving on to a fight plays it", () => {
    const planning: Screen = { at: "plan", looking: false };
    expect(after(planning, { e: "look" })).toEqual({ at: "plan", looking: true });
    expect(after(planning, { e: "look" }, { e: "look" })).toEqual(planning);
    expect(after({ at: "front" }, { e: "look" })).toEqual({ at: "front" });
    const fighting = must(begun(), { do: "fight" }).state;
    expect(after({ at: "plan", looking: true }, { e: "leaf", ...at(fighting) }).at).toBe("fight");
    // A run that has fought nothing has no last fight to keep looking at.
    expect(after({ at: "plan", looking: true }, { e: "leaf", ...at(begun()) })).toEqual(planning);
  });

  test("the last fight is watched again only while the run is planning, and then the room is planned again", () => {
    let planning = must(must(begun(), { do: "fight" }).state, { do: "take" }).state;
    // What the first room left to pick is picked: the next room is planned with nothing waiting.
    for (let n = 0; n < 4 && (runOf(planning).stage.phase !== "plan" || picksWaiting(planning)); n++)
      planning = must(planning, { do: "choose", option: 0 }).state;
    expect(watchable(runOf(planning))).toBe(true);
    const watching = after({ at: "front" }, { e: "watch", ...at(planning) });
    if (watching.at !== "fight") throw new Error("not watching");
    expect(watching.play.again).toBe(true);
    expect(after(watching, { e: "played", key: watching.play.key })).toEqual({ at: "plan", looking: false });
    // Picked up again in a fight Leaf has decided (a reload in the middle of one), the run keeps its
    // last fight but is not planning: there is nothing to watch again, and the front page stays.
    const fighting = must(planning, { do: "fight" }).state;
    expect(runOf(fighting).last).not.toBeNull();
    expect(watchable(runOf(fighting))).toBe(false);
    expect(after({ at: "front" }, { e: "watch", ...at(fighting) })).toEqual({ at: "front" });
    // Nor has a run that has fought no room yet.
    expect(watchable(runOf(begun()))).toBe(false);
    expect(after({ at: "plan", looking: false }, { e: "watch", ...at(begun()) })).toEqual({
      at: "plan",
      looking: false,
    });
  });

  test("a run that ends is shown at its end, from walking home or from the takings", () => {
    const home = must(must(must(begun(), { do: "fight" }).state, { do: "take" }).state, { do: "abandon" });
    const ended = endedIn(home.notes);
    if (!ended) throw new Error("not ended");
    expect(after({ at: "plan", looking: false }, { e: "ended", ended })).toEqual({ at: "over", ended });
    expect(after({ at: "over", ended }, { e: "sit", ...at(home.state) })).toEqual({ at: "front" });
  });
});

/** Whether a pick is waiting in the run in hand. */
const picksWaiting = (state: Kept): boolean => {
  const { stage } = runOf(state);
  return stage.phase === "plan" && stage.picks.length > 0;
};

function fightOf(state: Kept) {
  const run = runOf(state);
  if (run.stage.phase !== "fight") throw new Error("no fight");
  return run.stage.fight;
}

// ---------- the page on a stand-in Leaf ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A stand-in Leaf with the real rules, and another page of the member's (`elsewhere`). */
function fakeLeaf() {
  const leaf = { state: RAID.create(ctx()), rev: 0 };
  const shown = (): unknown => RAID.view(leaf.state, ctx());
  const elsewhere = (command: RaidCommand): void => {
    leaf.state = must(leaf.state, command).state;
    leaf.rev += 1;
  };
  const post = (sent: Sent): Reply => {
    const commands = isRecord(sent.body) && Array.isArray(sent.body.commands) ? sent.body.commands : [];
    const results = commands.map((c: unknown) => {
      const id = isRecord(c) && typeof c.id === "string" ? c.id : "";
      const command = RAID.command(c);
      if (!command) return { id, refused: "invalid" };
      const done = RAID.apply(leaf.state, command, ctx());
      if (isRefused(done)) return { id, refused: done.refused };
      leaf.state = done.state;
      leaf.rev += 1;
      return { id, notes: done.notes };
    });
    return { status: 200, body: { rev: leaf.rev, now: "x", results, state: shown() } };
  };
  const routes = {
    "GET /v1/game/play/raid": (): Reply => ({ status: 200, body: { rev: leaf.rev, now: "x", state: shown() } }),
    "POST /v1/game/play/raid": post,
  };
  return { leaf, routes, elsewhere };
}

let world: Standin | null = null;
afterEach(() => {
  world?.done();
  world = null;
  S.run = null;
  S.screen = { at: "front" };
});
async function until(ok: () => boolean, tries = 300): Promise<void> {
  if (ok() || tries === 0) return;
  await Bun.sleep(1);
  await until(ok, tries - 1);
}

describe("a page whose room another page settled", () => {
  test("plays its fight to the end, and goes on to the next room as Leaf has it (B4)", async () => {
    const fake = fakeLeaf();
    world = standin(fake.routes);
    expect(await openTable("p", () => undefined)).toBeNull();
    expect((await ask({ do: "start", trail: 0 }))?.ok).toBe(true);
    expect((await ask({ do: "choose", option: 0 }))?.ok).toBe(true);
    expect((await ask({ do: "fight" }))?.ok).toBe(true);
    go({ e: "sit", ...tableNow() });
    const fight = S.screen;
    if (fight.at !== "fight") throw new Error(`at ${fight.at}`);
    // Another page of the member's takes the room, and this page hears of it as it wakes.
    fake.elsewhere({ do: "take" });
    await again();
    expect(S.run?.room).toBe(1);
    expect(S.screen).toBe(fight);
    // The fight on screen ends: Leaf will not settle the room twice, and the table goes on.
    go({ e: "played", key: fight.play.key });
    await until(() => S.screen.at !== "after");
    expect(S.screen).toEqual({ at: "plan", looking: false });
    expect(S.run?.room).toBe(1);
  });

  test("on the same page, a fight's end has its room settled, and Carry on goes to the next", async () => {
    const fake = fakeLeaf();
    world = standin(fake.routes);
    expect(await openTable("p", () => undefined)).toBeNull();
    await ask({ do: "start", trail: 0 });
    await ask({ do: "choose", option: 0 });
    await ask({ do: "fight" });
    go({ e: "sit", ...tableNow() });
    const fight = S.screen;
    if (fight.at !== "fight") throw new Error(`at ${fight.at}`);
    go({ e: "played", key: fight.play.key });
    await until(() => S.screen.at === "after" && S.screen.takings.notes !== null);
    const screen = S.screen;
    expect(screen.at === "after" && screen.takings.notes?.[0]).toMatchObject({ t: "result" });
    go({ e: "carry", ...tableNow() });
    expect(S.screen).toEqual({ at: "plan", looking: false });
    expect(fake.leaf.state.run?.room).toBe(1);
  });
});
