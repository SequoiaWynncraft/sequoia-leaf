/**
 * Handles on `window.works` for working the page from outside: the screenshot tours, the bench and
 * the gallery. They name kinds, plots and commands as the wire does: a command given to `act` is read
 * as Leaf reads one (`readCommand`). Only review pages install them (`tour.ts`, `bench.ts`,
 * `gallery.ts`); the page itself ships without them.
 */
import {
  check,
  decode,
  type Dir,
  encode,
  GOALS,
  kindName,
  kindNamed,
  MILLI,
  NONE,
  PIECE_BYTES,
  plotNamed,
  power,
  readCommand,
  stepTo,
  stops,
  STUDY,
} from "@sequoia-leaf/factory";
import { balance } from "@sequoia-leaf/kit/purse.ts";
import { tipOff } from "@sequoia-leaf/kit/tip.ts";
import { makeCanvas, type Pt } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "../src/art/belts.ts";
import { following, holdView, look, zoom } from "../src/camera.ts";
import { forget } from "../src/events.ts";
import { reachBox } from "../src/figure/reach.ts";
import { backToDoor, you } from "../src/figure/you.ts";
import { fingerTap } from "../src/input.ts";
import { layout } from "../src/layout.ts";
import type { Page } from "../src/main.ts";
import { buyLand } from "../src/plots.ts";
import { lap, picture, spent } from "../src/scene.ts";
import { builds, gradeInHand, S, type Tool, toPage } from "../src/state.ts";
import {
  aimAt,
  confirm,
  paintAt,
  place,
  runEnd,
  runOver,
  runStart,
  setGrade,
  setTool,
  takeAway,
} from "../src/tools.ts";
import { troubled } from "../src/trouble.ts";
import { closeCard, openCard, riderAt } from "../src/ui/card.ts";
import { refreshDock } from "../src/ui/dock.ts";
import { closeBanner } from "../src/ui/notes.ts";
import { closePanel, openPanel, type PanelId } from "../src/ui/panels.ts";
import { $ } from "../src/ui/parts.ts";
import { again, differences, doNow, screen, visitFollowing, yardReads } from "../src/yard.ts";

/** Where you stand in your own yard, and how: your feet, the tile, whether you walk somewhere and the view goes with you, and what is in reach. */
function yours(): Record<string, unknown> | null {
  const c = you();
  if (!c) return null;
  const { x, y, tile, going, running, speed, way, pose } = c;
  return { x, y, tile, going, running, speed, way, pose, following: following(), reach: reachBox() };
}

/** A goal's id, as a script reads it; null for none. */
const goalId = (g: number): string | null => GOALS[g]?.id ?? null;
/** A tool as a script names it, as the page holds it; undefined for a name that is none. */
function toolNamed(name: Named): Tool | undefined {
  if (name === null || name === "remove" || name === "select" || name === "paint") return name;
  return kindNamed(name) ?? undefined;
}
/** A moment staged in the yard by the play server on a developer's machine (`apps/api/test/play.ts`), for the tours. */
type Staged =
  | { yard: "small" | "short" | "mid" | "hall" | "study" | "large" | "new" }
  | { text: string }
  | { away: number }
  | { fill: number }
  | { feed: true | { but: Record<string, number> } };
/** A tool as a script names it: a kind of piece by its name, the spade, Select, the brush, or nothing. */
type Named = string | null;

declare global {
  interface Window {
    /** Handles for looking at the yard from outside: stage a moment on the test Leaf, open things, act as a player would. */
    works?: {
      stage: (...ops: Staged[]) => Promise<void>;
      /**
       * Stops the screen running the yard on, and shows it so far (`lead`, 0 to 1) into its next
       * tick; with `at`, the screen's own clock stands at that many seconds, so a picture can be
       * taken twice the same.
       */
      hold: (on: boolean, lead?: number, at?: number) => void;
      skip: (seconds: number) => void;
      /**
       * Does so many frames' work one after another, as if the screen showed `hz` of them a second,
       * and says what one took: milliseconds by part, the picture's size in the yard's pixels, and
       * how many pieces are on it. The yard is run that far ahead of Leaf, and waits there for it.
       */
      bench: (frames: number, hz?: number) => { ms: Record<string, number>; picture: Pt; pieces: number };
      pick: (tool: Named, dir?: Dir) => void;
      /** Chooses the grade the kind in hand is built at, as its button over the toolbar does. */
      grade: (grade: number) => void;
      finger: (on: boolean) => void;
      aim: (x: number, y: number) => void;
      tap: (x: number, y: number) => void;
      build: (kind: string, x: number, y: number, dir?: Dir) => boolean;
      remove: (x: number, y: number) => boolean;
      paint: (x: number, y: number, tint: number) => boolean;
      /** Does any command, as the wire has it, as the member would, and says why it is refused, or null when done. */
      act: (command: Record<string, unknown>) => string | null;
      /**
       * Does a command as `act` does, then the frame after it, on the yard itself: what a tap costs.
       * Says why it was refused, the milliseconds the command took (the rules, the interface told),
       * and the frame's by part, as `bench` gives them.
       */
      after: (command: Record<string, unknown>) => { why: string | null; act: number; ms: Record<string, number> };
      drag: (x0: number, y0: number, x1: number, y1: number) => void;
      drop: () => void;
      confirm: () => boolean;
      open: (panel: PanelId) => void;
      close: () => void;
      card: (x: number, y: number) => boolean;
      look: (x: number, y: number) => void;
      zoom: (by: number) => void;
      plot: (id: string) => boolean;
      taught: (ids: string[]) => void;
      page: (x: number, y: number) => Pt;
      /** What is riding a belt on a tile, as a card's reference, if anything. */
      rider: (x: number, y: number) => string | null;
      /** The tiles where a kind of thing stands. */
      where: (kind: string) => Pt[];
      /** The tiles of the pieces in trouble, as the yard's sheet counts them. */
      trouble: () => Pt[];
      state: () => Record<string, unknown>;
    };
  }
}

/** A single pixel to take the picture onto, for `bench`: a browser may put off the drawing it was asked for. */
const taken = makeCanvas(1, 1).g;

/** Puts the handles on `window.works`, working the page through `p`. */
export function installHandles(p: Page): void {
  /** Does a command as the wire has it, read as Leaf reads one, through `doNow`: why it was refused, or null. */
  function act(command: Record<string, unknown>): string | null {
    const read = readCommand({ ...command, tick: S.world.tick });
    if (!read) return "That is not a command";
    const done = doNow(read);
    p.refresh();
    return "refused" in done ? done.why : null;
  }

  window.works = {
    async stage(...ops) {
      await fetch("/test/play/works", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: ops }),
      });
      await again();
      p.advance(0, performance.now());
      forget();
      tipOff();
      $("feed").replaceChildren();
      closeBanner();
      closeCard();
      closePanel();
      setTool(null);
      S.clearing.clear();
      // A yard put in place of another starts its lessons as a new one does, or with them taken; a
      // step within the same yard (a time away, an order filled, a feed) leaves what has been taught.
      p.restaged(
        ops.some((op) => "yard" in op || "text" in op)
          ? ops.some((op) => "yard" in op && op.yard === "new")
            ? []
            : ["planks", "pylon", "bench", "board", "select", "short", "starved"]
          : null,
      );
      look(S.world.land.depot[0] * TILE + 8, S.world.land.depot[1] * TILE + 8, true);
      // You stand at the depot's door of the yard put in place, and the view comes back to you.
      backToDoor();
      holdView(true);
      p.refresh();
    },
    hold: (on, lead, at) => {
      p.hold(on, lead, at);
    },
    skip(seconds) {
      for (let k = 0; k < seconds * 30; k++) p.advance(1 / 30, null);
      p.refresh();
    },
    bench(frames, hz = 60) {
      const was = spent.on;
      const kept = spent.ms;
      spent.on = true;
      spent.ms = {};
      // A copy of the yard with a clock of its own: every run begins alike, and the yard itself,
      // and its keeping time with Leaf, are as they were afterwards.
      const yard = S.world;
      const held = S.held;
      const lead = p.lead;
      S.world = decode(encode(yard), yard.land) ?? yard;
      for (let k = 0; k < frames; k++) {
        lap();
        const ticks = (k * 10) / hz;
        stepTo(S.world, yard.tick + Math.floor(ticks));
        p.hold(true, ticks % 1);
        p.advance(1 / hz, null);
        lap("page");
        p.draw(0);
        // A browser may put off the drawing it was asked for: taking the picture makes it do it now.
        taken.drawImage(picture, 0, 0);
        lap("flush");
      }
      const ms = Object.fromEntries(Object.entries(spent.ms).map(([part, sum]) => [part, sum / frames]));
      spent.on = was;
      spent.ms = kept;
      const { land, kind } = S.world;
      const x0 = S.cam.x / TILE;
      const y0 = S.cam.y / TILE;
      let pieces = 0;
      for (let i = 0; i < kind.length; i++) {
        const x = i % land.w;
        const y = Math.floor(i / land.w);
        if (kind[i] !== NONE && x + 1 > x0 && x < x0 + S.view.w / TILE && y + 1 > y0 && y < y0 + S.view.h / TILE)
          pieces++;
      }
      S.world = yard;
      p.hold(held, lead);
      return { ms, picture: { x: picture.width, y: picture.height }, pieces };
    },
    pick(name, dir) {
      if (dir !== undefined) S.dir = dir;
      const tool = toolNamed(name);
      if (tool !== undefined) setTool(tool);
    },
    grade: setGrade,
    finger(on) {
      S.finger = on;
      if (on) S.hover = null;
      refreshDock();
    },
    aim(x, y) {
      S.hover = S.finger ? null : { x, y };
      aimAt(x, y);
      refreshDock();
    },
    tap(x, y) {
      if (S.tool === null) openCard(x, y);
      else fingerTap(x, y);
      refreshDock();
    },
    build(name, x, y, dir = 0) {
      const tool = toolNamed(name);
      if (tool === undefined || tool === null) return false;
      S.dir = dir;
      setTool(tool);
      const ok = place(x, y);
      setTool(null);
      return ok;
    },
    remove: (x, y) => takeAway(x, y),
    paint(x, y, tint) {
      S.tint = tint;
      return paintAt(x, y);
    },
    act,
    after(command) {
      const was = spent.on;
      const kept = spent.ms;
      const begun = performance.now();
      const why = act(command);
      const acted = performance.now() - begun;
      spent.on = true;
      spent.ms = {};
      lap();
      p.advance(1 / 60, null);
      lap("page");
      p.draw(performance.now());
      taken.drawImage(picture, 0, 0);
      lap("flush");
      const ms = spent.ms;
      spent.on = was;
      spent.ms = kept;
      return { why, act: acted, ms };
    },
    drag(x0, y0, x1, y1) {
      runStart(x0, y0);
      runOver(x1, y1);
    },
    drop: runEnd,
    confirm,
    open: openPanel,
    close() {
      closePanel();
      closeCard();
    },
    card: openCard,
    look(x, y) {
      look(x * TILE + 8, y * TILE + 8, true);
    },
    zoom(by) {
      zoom(by, window.innerWidth / 2, window.innerHeight / 2);
    },
    plot(id) {
      const plot = plotNamed(id);
      return plot !== null && buyLand(plot);
    },
    taught(ids) {
      p.restaged(ids);
    },
    rider: riderAt,
    page(x, y) {
      return toPage(x * TILE + 8, y * TILE + 8);
    },
    where(name) {
      const w = S.world;
      const k = kindNamed(name);
      const out: Pt[] = [];
      for (let i = 0; i < w.kind.length; i++)
        if (k !== null && w.kind[i] === k) out.push({ x: i % w.land.w, y: Math.floor(i / w.land.w) });
      return out;
    },
    trouble() {
      const w = S.world;
      const found = troubled(w);
      return Array.from(found.tiles.subarray(0, found.count), (i) => ({
        x: i % w.land.w,
        y: Math.floor(i / w.land.w),
      }));
    },
    state() {
      const w = S.world;
      return {
        coins: balance().coins,
        leaf: balance().leaf,
        tick: w.tick,
        till: w.till / MILLI,
        board: w.board.map((o) => o.id),
        hand: goalId(w.hand),
        done: w.done.map(goalId),
        tier: w.open.tier,
        built: layout(w).built,
        painted: w.kind.reduce((n, k, i) => n + (k !== NONE && (w.tint[i] ?? 0) > 0 ? 1 : 0), 0),
        nudge: S.nudge?.id ?? p.nudged(),
        nudgeAt: S.nudge?.part === undefined && S.nudge ? { x: S.nudge.x, y: S.nudge.y } : null,
        nudgePart: S.nudge?.part ?? null,
        taught: screen.taught,
        tool: typeof S.tool === "number" ? kindName(S.tool) : S.tool,
        grade: builds(S.tool) ? gradeInHand(S.tool) : null,
        line: w.line.map(goalId),
        studied:
          w.line[0] === undefined
            ? null
            : Object.fromEntries(Object.entries(w.got[w.line[0]] ?? {}).filter(([, n]) => n > 0)),
        studies: w.kind.reduce((n, k) => n + (k === STUDY ? 1 : 0), 0),
        stops: stops(w),
        aim: S.aim,
        run: S.run ? { legs: S.run.legs.length, cost: S.run.cost, why: S.run.why } : null,
        mark: S.mark ? { pieces: S.mark.pieces.length, cost: S.mark.cost } : null,
        group: S.group
          ? { as: S.group.as, turns: S.group.turns, bad: S.group.why.filter((r) => r !== null).length }
          : null,
        blueprints: w.blueprints.map((b) => (b ? b.pieces.length / PIECE_BYTES : 0)),
        panel: S.panel,
        picked: S.picked,
        power: power(w),
        z: S.view.z,
        differences: differences(),
        reads: yardReads(),
        check: check(w),
        visit: S.visiting ? visitFollowing() : null,
        you: yours(),
      };
    },
  };
}
