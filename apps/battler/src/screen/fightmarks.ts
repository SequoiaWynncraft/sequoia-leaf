/**
 * What abilities leave on the table in a fight, and how figures move for them, beside
 * `fightview.ts`: a zone tints the hexes it holds for as long as it lasts (slime green, a puddle
 * blue, dust pale), under the figures; a telegraph outlines the hexes it will land on and fills
 * until it does; a pulled figure is jerked across as a knocked-back one is; a figure channelling
 * holds its cast pose until its last pulse, or until it is stunned.
 *
 * `showMark` is shown every event of the fight first and takes the ones that are its own;
 * `drawFightMarks` draws under the figures, every frame.
 */
import type { Move } from "@sequoia-leaf/figures/move.ts";
import { CREAM, GREEN, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { clamp, type Ctx } from "@sequoia-leaf/kit/util.ts";
import type { Fight, FightEvent, Unit, ZoneKind } from "@sequoia-leaf/raid";

import { hexMark } from "./art/table.ts";
import { shownCell } from "./board.ts";
import { burst } from "./fx.ts";
import { cellXY, HEX_H, HEX_W } from "./geometry.ts";
import { FOOT } from "./pawns.ts";
import { V } from "./stage.ts";

/** A figure as the fight on the table shows it: as much of it as is moved and posed here. */
interface Body {
  readonly unit: Unit;
  x: number;
  y: number;
  left: boolean;
  castUntil: number;
  move: (Move & { under: boolean }) | null;
}
/** The fight on the table as `board.ts` keeps it, read as it goes on. */
interface View {
  readonly fight: Fight | null;
  readonly actors: readonly (Body | undefined)[];
  readonly clock: number;
}
/** The events shown here and nowhere else. */
type Marked =
  Extract<FightEvent, { t: "zone" | "telegraph" | "end" }> | (Extract<FightEvent, { t: "leap" }> & { why: "pull" });

/** Hexes marked by a telegraph, by the fight's clock. */
interface Telegraph {
  readonly fight: Fight;
  readonly cells: readonly number[];
  readonly t0: number;
  readonly dur: number;
}
const M: { view: View | null; telegraphs: Telegraph[]; holds: Map<number, number> } = {
  view: null,
  telegraphs: [],
  holds: new Map(),
};

const ZONE: Readonly<Record<ZoneKind, readonly [fill: string, rim: string]>> = {
  slime: [GREEN[3], GREEN[4]],
  puddle: [WATER[2], WATER[3]],
  dust: ["#cdb6d8", CREAM],
};
const MARK = "#e67967";
const CLEAR = "rgba(0,0,0,0)";

const hexes = new Map<string, HTMLCanvasElement>();
function hexOf(fill: string, rim: string): HTMLCanvasElement {
  const key = `${fill} ${rim}`;
  let pic = hexes.get(key);
  if (!pic) {
    pic = hexMark(fill, rim);
    hexes.set(key, pic);
  }
  return pic;
}
function drawHex(g: Ctx, pic: HTMLCanvasElement, cell: number, alpha: number): void {
  const at = cellXY(shownCell(cell));
  g.globalAlpha = alpha;
  g.drawImage(pic, V.bx + at.x - HEX_W / 2, V.by + at.y - HEX_H / 2);
}

/** Jerked a hex toward whoever pulled it, as a figure knocked back is pushed. */
function pulled(view: View, id: number, to: number): void {
  const a = view.actors[id];
  if (!a) return;
  const p = cellXY(shownCell(to));
  const at = { x: p.x, y: p.y + FOOT };
  if (Math.abs(at.x - a.x) > 1) a.left = at.x < a.x;
  a.move = { from: { x: a.x, y: a.y }, to: at, t0: view.clock, dur: 4, arc: 4, smooth: false, under: false };
  burst(a.x, a.y - 4, 6, [CREAM, STONE[3]], { speed: 30, ttl: 0.3 });
}

/** A figure that begins channelling holds its cast pose until its last pulse has landed. */
function hold(view: View, ev: Extract<FightEvent, { t: "cast" }>): void {
  if (ev.pulses !== undefined && ev.every !== undefined)
    M.holds.set(ev.id, view.clock + (ev.pulses - 1) * ev.every + 6);
}
/** Stunned, it stops channelling. */
function unhold(view: View, ev: Extract<FightEvent, { t: "status" }>): void {
  if (ev.status !== "stun" || !ev.on) return;
  M.holds.delete(ev.id);
  const a = view.actors[ev.id];
  if (a) a.castUntil = Math.min(a.castUntil, view.clock);
}
const OWN: ReadonlySet<FightEvent["t"]> = new Set(["zone", "telegraph", "end"]);

/** Shows an event of the fight if it is one of these, and says whether it was. */
export function showMark(ev: FightEvent, view: View): ev is Marked {
  M.view = view;
  const f = view.fight;
  if (!f) return false;
  if (ev.t === "cast") hold(view, ev);
  else if (ev.t === "status") unhold(view, ev);
  else if (ev.t === "telegraph") M.telegraphs.push({ fight: f, cells: ev.cells, t0: view.clock, dur: ev.ticks });
  else if (ev.t === "end") {
    M.telegraphs = [];
    M.holds.clear();
  } else if (ev.t === "leap" && ev.why === "pull") pulled(view, ev.id, ev.to);
  return OWN.has(ev.t) || (ev.t === "leap" && ev.why === "pull");
}

/** Zones and telegraphs on the board, under the figures; and figures channelling kept in their cast pose. */
export function drawFightMarks(g: Ctx): void {
  const view = M.view;
  const f = view?.fight;
  if (!view || !f || f.over) return;
  const c = view.clock;
  for (const [id, until] of M.holds) {
    const a = view.actors[id];
    if (a) a.castUntil = Math.max(a.castUntil, until);
  }
  M.holds.clear();
  f.zones.forEach((z, cell) => {
    if (z) drawHex(g, hexOf(...ZONE[z.kind]), cell, 0.42 + 0.08 * Math.sin(c * 0.25 + cell));
  });
  M.telegraphs = M.telegraphs.filter((m) => m.fight === f && c < m.t0 + m.dur);
  for (const m of M.telegraphs) {
    const k = clamp((c - m.t0) / m.dur, 0, 1);
    for (const cell of m.cells) {
      drawHex(g, hexOf(MARK, MARK), cell, 0.15 + k * 0.5);
      drawHex(g, hexOf(CLEAR, MARK), cell, 1);
    }
  }
  g.globalAlpha = 1;
}
