/**
 * A handle on `window.raid` for looking at the game from outside, where a headless browser draws
 * about a frame a second: start a seeded run, let the bot play some rooms, jump to a pick or to
 * the end, hold the clock and step it (and a fight's clock) by hand, pick a figure up, open a card
 * or a page.
 */
import {
  beginFight,
  choose,
  type FigureId,
  giveItem,
  HZ,
  isBossId,
  isComponentId,
  isFigureId,
  isFinishedId,
  type ItemId,
  MEASURES,
  pieceAt,
  pieces,
  planRoom,
  ROOMS,
  type Run,
  SENSIBLE,
  takeTakings,
} from "../game/index.ts";
import { fightState } from "./fightview.ts";
import { carryOn, enterRun, setOut, startNew } from "./flow.ts";
import { grab, hover, tapPawn, unpick } from "./hand.ts";
import { heldRow, heldTop } from "./held.ts";
import { keep, KEYS } from "./keep.ts";
import { NUDGES } from "./logic.ts";
import { pawns } from "./pawns.ts";
import { arrive } from "./scene.ts";
import * as stage from "./stage.ts";
import { act, changed, prefsChanged, S, wake } from "./state.ts";
import { closeSheet, sheetUp, toggleLastFight } from "./ui/fightsheet.ts";
import { type PageId, showPage } from "./ui/pages.ts";
import { redrawTallies, TV } from "./ui/tally.ts";

type Jump = "front" | "boon" | "component" | "spar" | "boss" | "lastboss" | "end";

export interface Handle {
  /** Starts a run from a seed on a trail, at its first pick. */
  start(seed: number, trail?: number): string;
  /** Forgets everything kept in the browser: a new member. */
  fresh(): void;
  /** The bot plays this many whole rooms, unseen, and the table shows the room after them. */
  bot(rooms?: number): string;
  /** The bot plans the room that is up (shops, seats, hands out items) and stops before the fight. */
  plan(): string;
  /** Plays on with the bot to a moment worth looking at. */
  to(where: Jump): string;
  /** Has whoever is waiting walk in again from the trees. */
  arrive(): void;
  /** Sets out, as the button does. */
  fight(): string;
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
  strip(): void;
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
  acorns(n: number): void;
  give(kind: string, stars?: number): number;
  offer(at: number, kind: string): void;
  item(id: string): void;
}

declare global {
  interface Window {
    raid?: Handle;
  }
}

/** One whole room played by the bot through the same door the member's actions go through. */
function botRoom(): boolean {
  const done = act((r) => {
    planRoom(r, SENSIBLE);
    const begun = beginFight(r);
    return begun.ok ? takeTakings(r) : begun;
  });
  return done?.ok === true;
}

function settle(): string {
  const run = S.run;
  if (!run) return "no run";
  if (run.phase === "over") {
    closeSheet(false);
    S.mode = "over";
    changed();
    return "over";
  }
  enterRun(false);
  return `room ${run.room + 1}, ${ROOMS[run.room]?.kind ?? ""}, ${run.choices[0]?.kind ?? "planning"}`;
}

/** Whether the run is at the room a jump is for. */
const there = (run: Run, where: Jump): boolean =>
  where === "lastboss"
    ? run.room === ROOMS.length - 1
    : where === "boss" || where === "spar"
      ? ROOMS[run.room]?.kind === where
      : false;

/** The bot plans the room that is up, without fighting it. */
function plan(): void {
  act((r) => {
    planRoom(r, SENSIBLE);
    return { ok: true, notes: [] };
  });
}

export function openHandle(): void {
  window.raid = {
    start(seed, trail = 0) {
      startNew(trail, seed);
      return settle();
    },
    fresh() {
      for (const key of Object.values(KEYS)) keep(key, null);
      wake();
      S.mode = "front";
      changed();
    },
    bot(rooms = 1) {
      for (let i = 0; i < rooms && S.run && S.run.phase !== "over"; i++) if (!botRoom()) break;
      return settle();
    },
    plan() {
      const run = S.run;
      if (!run || run.phase !== "plan") return "not planning";
      plan();
      return settle();
    },
    to(where) {
      if (where === "front") {
        S.mode = "front";
        changed();
        return "front";
      }
      for (let guard = 0; guard < 60; guard++) {
        const run = S.run;
        if (!run || run.phase === "over") break;
        if (where === "boon" || where === "component") {
          // Whatever is waiting ahead of the pick that is wanted is settled plainly; the pick itself is left.
          const queued = run.choices.findIndex((c) => c.kind === where);
          if (queued >= 0) {
            for (let i = 0; i < queued; i++) act((r) => choose(r, 0));
            break;
          }
        } else if (where !== "end" && there(run, where)) {
          if (run.choices.length > 0) plan();
          break;
        }
        if (!botRoom()) break;
      }
      return settle();
    },
    arrive() {
      if (S.run && S.mode === "plan") arrive(S.run);
    },
    fight() {
      setOut();
      return S.mode;
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
        mode: S.mode,
        room: run ? run.room + 1 : 0,
        kind: run ? ROOMS[run.room]?.kind : "",
        phase: run?.phase,
        acorns: run?.acorns,
        level: run?.level,
        resolve: run?.resolve,
        choice: run?.choices[0]?.kind ?? null,
        boss: run?.foe.figures.some((p) => isBossId(p.kind)) ?? false,
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
    strip() {
      act((r) => {
        for (const p of pieces(r)) p.items = [];
        return { ok: true, notes: [] };
      });
    },
    hover,
    hand(itemAt, id) {
      const spot = pawns.get(id)?.spot;
      if (spot) act((r) => giveItem(r, itemAt, spot));
    },
    drop: unpick,
    page: showPage,
    carry() {
      carryOn();
      return S.mode;
    },
    last() {
      toggleLastFight();
      return sheetUp() ?? "none";
    },
    tally(measure, side) {
      const m = MEASURES.find((x) => x === measure);
      if (m) TV.measure = m;
      if (side === 0 || side === 1) TV.side = side;
      redrawTallies();
      return `${TV.measure} ${TV.side}`;
    },
    acorns(n) {
      act((r) => {
        r.acorns = Math.max(0, n);
        return { ok: true, notes: [] };
      });
    },
    give(kind, stars = 1) {
      let id = -1;
      if (!isFigureId(kind)) return id;
      const figure: FigureId = kind;
      act((r) => {
        const slot = r.bench.indexOf(null);
        if (slot < 0) return { ok: false, why: "The bench is full." };
        id = r.nextId++;
        r.bench[slot] = { id, kind: figure, stars: stars >= 3 ? 3 : stars === 2 ? 2 : 1, items: [], fed: 0 };
        return { ok: true, notes: [] };
      });
      return id;
    },
    offer(at, kind) {
      if (!isFigureId(kind)) return;
      const figure: FigureId = kind;
      act((r) => {
        if (at < 0 || at >= r.stall.length) return { ok: false, why: "There is no such place on the stall." };
        r.stall[at] = figure;
        return { ok: true, notes: [] };
      });
    },
    item(id) {
      const item: ItemId | null = isComponentId(id) || isFinishedId(id) ? id : null;
      if (!item) return;
      act((r) => {
        r.items.push(item);
        return { ok: true, notes: [] };
      });
    },
  };
}
