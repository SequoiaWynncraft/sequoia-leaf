/**
 * A handle on `window.raid` for looking at the game from outside, where a headless browser draws
 * about a frame a second: start a run, let the bot play some rooms, jump to a pick or to the end,
 * hold the clock and step it (and a fight's clock) by hand, pick a figure up, open a card or a page.
 *
 * The table is Leaf's, so whatever plays goes to Leaf as commands, as the member's own do: the bot
 * plans on the page's copy (`planCommands`) and sends what it would do. Staging a moment that play
 * does not reach (more acorns, a figure handed over, a run from a chosen seed, a new member) asks
 * the play server the tours run against (`apps/api/test/play.ts`), which alone answers
 * `/test/play/raid`; the guild's own Leaf has no such route, and there they do nothing.
 *
 * `copy()` is the page's own copy of the run, to change by hand and see that Leaf's next answer
 * puts it back.
 */
import { ask as askLeaf } from "@sequoia-leaf/kit/net.ts";
import { balance } from "@sequoia-leaf/kit/purse.ts";
import {
  HZ,
  isBossId,
  MEASURES,
  picksOf,
  pieceAt,
  pieces,
  planCommands,
  type RaidCommand,
  ROOMS,
  type RunView,
  SENSIBLE,
  type TableView,
} from "@sequoia-leaf/raid";

import { fightState } from "../src/screen/fightview.ts";
import { carryOn, enterRun, lookBack, setOut, startNew, toFront } from "../src/screen/flow.ts";
import { grab, hover, tapPawn, unpick } from "../src/screen/hand.ts";
import { heldRow, heldTop } from "../src/screen/held.ts";
import { NUDGES } from "../src/screen/logic.ts";
import { pawns, syncPawns } from "../src/screen/pawns.ts";
import { arrive } from "../src/screen/scene.ts";
import * as stage from "../src/screen/stage.ts";
import {
  again,
  ask,
  changed,
  type Did,
  doNow,
  go,
  leafView,
  prefsChanged,
  S,
  tableNow,
  waitingForLeaf,
} from "../src/screen/state.ts";
import { sheetUp } from "../src/screen/ui/fightsheet.ts";
import { type PageId, showPage } from "../src/screen/ui/pages.ts";
import { redrawTallies, TV } from "../src/screen/ui/tally.ts";

type Jump = "front" | "boon" | "component" | "spar" | "boss" | "lastboss" | "end";

export interface Handle {
  /** Starts a run on a trail, at its first pick; from a chosen seed where the play server stages it. */
  start(seed: number, trail?: number): Promise<string>;
  /** A new member: the play server forgets the table, and the page takes the new one. */
  fresh(): Promise<void>;
  /** The bot plays this many whole rooms, unseen, and the table shows the room after them. */
  bot(rooms?: number): Promise<string>;
  /** The bot plans the room that is up (shops, seats, hands out items) and stops before the fight. */
  plan(): Promise<string>;
  /** Plays on with the bot to a moment worth looking at. */
  to(where: Jump): Promise<string>;
  /** Has whoever is waiting walk in again from the trees. */
  arrive(): void;
  /** Sets out, as the button does. */
  fight(): Promise<string>;
  /** Moves a fight's clock on by this many of its steps. */
  tick(steps: number): string;
  /** Moves a fight on until an ability has hexes lit and something is in the air (or a number of steps has passed). */
  busy(most?: number): string;
  /** Counts every first-time nudge as given, so that none shows. */
  taught(): void;
  /** Stops the stage's clock, so that only `skip` and `tick` move it; and runs it on by hand. */
  hold(on: boolean): void;
  skip(seconds: number): void;
  /** Milliseconds to work out and draw a frame. */
  bench(): number;
  state(): unknown;
  /** The party's figures, with their numbers, for the calls below. */
  party(): { id: number; kind: string; stars: number; on: string; at: number }[];
  /** Picks a figure up as a drag would, holding it over a point measured from the board's corner; or lets go. */
  grab(id: number | null, x?: number, y?: number): void;
  /** Taps a figure, as a finger would. */
  tap(id: number): void;
  /** Where on the page one of the party's figures stands (its body), for a pointer or a finger to go to. */
  at(id: number): { x: number; y: number } | null;
  /** Where on the page the middle of the picture of the `i`th item a figure holds is. */
  heldAt(id: number, i: number): { x: number; y: number } | null;
  /** What is on the rack, and what each of the party's figures holds. */
  rack(): string[];
  held(): Record<number, string[]>;
  /** For staging a moment: every figure lets go of what it holds. */
  strip(): Promise<void>;
  /** Holds the item at a place on the rack over a figure; and hands it over. */
  hover(itemAt: number, id: number): void;
  hand(itemAt: number, id: number): void;
  drop(): void;
  page(id: PageId | null): void;
  /** Goes on from a fight's sheet, as "Carry on" does. */
  carry(): string;
  /** Opens the last fight's sheet while planning, as "Last fight" does, or puts it away. */
  last(): string;
  /** Shows a tab of the tally ("damage", "tanked", "healing"), and on a phone one party (0 for yours, 1 for theirs). */
  tally(measure: string, side?: number): string;
  /** For staging a moment: more acorns, a figure onto the bench, a figure onto the stall, an item onto the rack. */
  acorns(n: number): Promise<void>;
  give(kind: string, stars?: number): Promise<number>;
  offer(at: number, kind: string): Promise<void>;
  item(id: string): Promise<void>;
  /** The page's own copy of the run, to change by hand. */
  copy(): RunView | null;
  /** Draws the table again from the copy as it stands. */
  redraw(): void;
  /** Leaf's table as the page last heard it, and whether anything sent is still waiting for an answer. */
  leaf(): TableView | null;
  waiting(): boolean;
  /** Waits until Leaf has answered everything sent, and the page has shown it. */
  settled(): Promise<string>;
  /** Sends one command as the page would, and gives back what it did. */
  send(command: RaidCommand): Promise<Did | null>;
}

declare global {
  interface Window {
    raid?: Handle;
  }
}

/** Asks the play server to stage a moment, then takes the table as Leaf now has it. Gives back the numbers of figures it made. */
async function staged(...ops: unknown[]): Promise<number[]> {
  const answer = await askLeaf("/test/play/raid", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage: ops }),
  });
  await again();
  const body = answer.body;
  return typeof body === "object" && body !== null && "made" in body && Array.isArray(body.made)
    ? body.made.filter((n): n is number => typeof n === "number")
    : [];
}

/** Waits until Leaf has answered everything sent. */
async function settled(tries = 400): Promise<void> {
  if (tries === 0 || !waitingForLeaf()) return;
  await new Promise((resolve) => setTimeout(resolve, 5));
  await settled(tries - 1);
}

/** Sends a command as the page does: at once where the rules can say, and otherwise waiting for Leaf. */
async function send(c: RaidCommand): Promise<Did | null> {
  const now = doNow(c);
  if (now) {
    await settled();
    return now;
  }
  return ask(c);
}

/** The bot plans the room that is up, through commands, until it has nothing left to do. */
async function plan(rounds = 30): Promise<void> {
  const view = leafView();
  if (rounds === 0 || !view) return;
  const commands = planCommands(view, SENSIBLE);
  if (commands.length === 0) return;
  for (const c of commands) {
    // oxlint-disable-next-line no-await-in-loop -- in order, each after the one before
    await send(c);
  }
  await plan(rounds - 1);
}

/** One whole room played by the bot through the same commands the member's actions send. */
async function botRoom(): Promise<boolean> {
  // What the page has sent first (the takings of a fight just watched); a fight not yet taken is taken.
  await settled();
  if (S.run?.stage.phase === "fight" && !(await ask({ do: "take" }))?.ok) return false;
  if (S.run?.stage.phase !== "plan") return false;
  await plan();
  const begun = await ask({ do: "fight" });
  if (!begun?.ok) return false;
  return (await ask({ do: "take" }))?.ok === true;
}

/** Sits down to the table as Leaf has it now, and says where it is. */
function settle(): string {
  enterRun();
  const run = S.run;
  if (!run || S.screen.at === "front") return S.screen.at;
  return `room ${run.room + 1}, ${ROOMS[run.room]?.kind ?? ""}, ${picksOf(run)[0]?.kind ?? "planning"}`;
}

/** Whether the run is at the room a jump is for. */
const there = (run: RunView, where: Jump): boolean =>
  where === "lastboss"
    ? run.room === ROOMS.length - 1
    : where === "boss" || where === "spar"
      ? ROOMS[run.room]?.kind === where
      : false;

async function playTo(where: Jump, guard = 60): Promise<void> {
  await settled();
  const run = S.run;
  if (guard === 0 || !run || run.stage.phase === "over") return;
  if (where === "boon" || where === "component") {
    // Whatever is waiting ahead of the pick that is wanted is settled plainly; the pick itself is left.
    if (picksOf(run)[0]?.kind === where) return;
    if (picksOf(run).some((c) => c.kind === where)) {
      await ask({ do: "choose", option: 0 });
      return playTo(where, guard - 1);
    }
  } else if (where !== "end" && there(run, where)) {
    if (picksOf(run).length > 0) await plan();
    return;
  }
  if (!(await botRoom())) return;
  return playTo(where, guard - 1);
}

async function bot(rooms: number): Promise<void> {
  if (rooms <= 0 || !S.run || S.run.stage.phase === "over") return;
  if (!(await botRoom())) return;
  return bot(rooms - 1);
}

export function openHandle(): void {
  window.raid = {
    async start(seed, trail = 0) {
      // From the chosen seed where the play server stages it; otherwise as the front page sets out.
      const staging = await staged({ start: { seed, trail } });
      if (staging.length === 0) await startNew(trail);
      return settle();
    },
    async fresh() {
      await staged({ fresh: true });
      S.prefs.taught = [];
      prefsChanged();
      go({ e: "sit", ...tableNow() });
    },
    async bot(rooms = 1) {
      await bot(rooms);
      return settle();
    },
    async plan() {
      const run = S.run;
      if (!run || run.stage.phase !== "plan") return "not planning";
      await plan();
      return settle();
    },
    async to(where) {
      if (where === "front") {
        toFront();
        return S.screen.at;
      }
      await playTo(where);
      return settle();
    },
    arrive() {
      if (S.run && S.screen.at === "plan") arrive(S.run);
    },
    async fight() {
      await setOut();
      return S.screen.at;
    },
    tick(steps) {
      stage.skip(steps / (HZ * S.prefs.speed));
      const f = fightState();
      return `${f.stage} ${f.tick}`;
    },
    busy(most = 400) {
      for (let i = 0; i < most; i++) {
        stage.skip(1 / (HZ * S.prefs.speed));
        const f = fightState();
        if (f.over || (f.lit >= 5 && f.thrown >= 1)) break;
      }
      stage.skip(2 / (HZ * S.prefs.speed));
      const f = fightState();
      return `${f.stage} ${f.tick}: ${f.lit} lit, ${f.thrown} thrown`;
    },
    taught() {
      for (const id of NUDGES) if (!S.prefs.taught.includes(id)) S.prefs.taught.push(id);
      prefsChanged();
    },
    hold: stage.hold,
    skip: stage.skip,
    bench: stage.bench,
    state() {
      const run = S.run;
      return {
        mode: S.screen.at,
        room: run ? run.room + 1 : 0,
        kind: run ? ROOMS[run.room]?.kind : "",
        phase: run?.stage.phase,
        acorns: run?.acorns,
        level: run?.level,
        resolve: run?.resolve,
        choice: (run && picksOf(run)[0]?.kind) ?? null,
        boss: run?.foe.figures.some((p) => isBossId(p.kind)) ?? false,
        coins: balance().coins,
        fight: fightState(),
        view: { z: stage.V.z, w: stage.V.w, h: stage.V.h, bx: stage.V.bx, by: stage.V.by },
      };
    },
    party() {
      return [...pawns.values()].map((p) => ({
        id: p.id,
        kind: p.kind,
        stars: p.stars,
        on: p.spot?.on ?? "",
        at: p.spot?.at ?? -1,
      }));
    },
    grab(id, x, y) {
      grab(id, x !== undefined && y !== undefined ? { x, y } : undefined);
    },
    tap: tapPawn,
    at(id) {
      const p = pawns.get(id);
      return p ? stage.boardToPage(p.x, p.y - 8) : null;
    },
    heldAt(id, i) {
      const p = pawns.get(id);
      const piece = S.run && p?.spot ? pieceAt(S.run, p.spot) : null;
      const at = p && piece ? heldRow(piece.items, p.x, heldTop(p.y, false))[i] : undefined;
      return at ? stage.boardToPage(at.x + at.w / 2, at.y + at.h / 2) : null;
    },
    rack() {
      return [...(S.run?.items ?? [])];
    },
    held() {
      const out: Record<number, string[]> = {};
      for (const p of S.run ? pieces(S.run) : []) out[p.id] = [...p.items];
      return out;
    },
    async strip() {
      await staged({ strip: true });
      syncPawns(S.run, true);
      changed();
    },
    hover,
    hand(itemAt, id) {
      const spot = pawns.get(id)?.spot;
      if (spot) doNow({ do: "give", item: itemAt, to: spot });
    },
    drop: unpick,
    page: showPage,
    carry() {
      carryOn();
      return S.screen.at;
    },
    last() {
      lookBack();
      return sheetUp() ?? "none";
    },
    tally(measure, side) {
      const m = MEASURES.find((x) => x === measure);
      if (m) TV.measure = m;
      if (side === 0 || side === 1) TV.side = side;
      redrawTallies();
      return `${TV.measure} ${TV.side}`;
    },
    async acorns(n) {
      await staged({ acorns: n });
      changed();
    },
    async give(kind, stars = 1) {
      const [id] = await staged({ give: { kind, stars } });
      syncPawns(S.run);
      changed();
      return id ?? -1;
    },
    async offer(at, kind) {
      await staged({ offer: { at, kind } });
      changed();
    },
    async item(id) {
      await staged({ item: id });
      changed();
    },
    copy: () => S.run,
    redraw() {
      syncPawns(S.run, true);
      changed();
    },
    leaf: leafView,
    waiting: waitingForLeaf,
    async settled() {
      await settled();
      // What each answer did is shown just after it comes.
      await new Promise((resolve) => setTimeout(resolve, 20));
      return waitingForLeaf() ? "still waiting" : "answered";
    },
    send,
  };
}
