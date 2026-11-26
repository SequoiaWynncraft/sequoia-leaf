import { type Move, moveAt } from "@sequoia-leaf/figures/move.ts";
import { framesOf } from "@sequoia-leaf/figures/sprites.ts";
/**
 * The party's figures as they stand on the table while planning: one pawn for every figure the
 * member owns, on a seat of the board or in a hollow of the bench. A pawn follows its figure about
 * (hopping to wherever the rules have put it) and acts out what the rules say happened: bought
 * from the stall, sold back, three hopping together into one with a star more.
 *
 * Everything is measured from the board's corner, in art pixels.
 */
import { GOLD } from "@sequoia-leaf/kit/palette.ts";
import type { Note, RaidNote, RunView, Spot, Stars } from "@sequoia-leaf/raid";
import type { FigureId } from "@sequoia-leaf/raid/content/figures.ts";
import { carries } from "@sequoia-leaf/raid/content/items.ts";
import type { TraitId } from "@sequoia-leaf/raid/content/traits.ts";

import { glyphPic, itemPic } from "./art/icons.ts";
import { TRAIT_COLOUR } from "./art/pal.ts";
import { burst, fly, later, ring, say } from "./fx.ts";
import { type Pt, seatAtPoint, seatXY, slotAtPoint, slotXY } from "./geometry.ts";
import { fadingOf, goneOnLanding, type Life, lifeAfter, type LifeEvent, placeOf } from "./pawnlife.ts";
import { signal } from "./signals.ts";
import { snd } from "./sounds.ts";
import { boardSpot, V } from "./stage.ts";

/** How far below the middle of its hex a figure's feet are. */
export const FOOT = 3;

export interface Pawn {
  id: number;
  kind: FigureId;
  /** Its stars as shown, and the rules' stars still to pop while three hop together into it. */
  stars: Stars;
  due: Stars | null;
  /** Where it is in its life on the table: here at its place, loose, or going (`pawnlife.ts`). */
  life: Life;
  /** Where it is this moment, how high off the table, and how see-through. */
  x: number;
  y: number;
  lift: number;
  alpha: number;
  /** Where it is hopping to, by the stage's clock, and whether over the whole interface; null standing still. */
  move: (Move & { over: boolean }) | null;
  /** Out of step with the others, so they do not all breathe together. */
  phase: number;
  /** When its star last popped, when it last cheered, and until when it wiggles to be noticed. */
  popAt: number;
  cheerAt: number;
  wiggleUntil: number;
  facing: boolean;
}

export const pawns = new Map<number, Pawn>();

/** A pawn's place, while it has one (`pawnlife.ts`). */
export const spotOfPawn = (p: Pawn | undefined): Spot | null => (p ? placeOf(p.life) : null);
/** Whether a pawn is drawn over the whole interface: loose, or hopping across it. */
export const aloft = (p: Pawn): boolean => p.life.is === "loose" || (p.move?.over ?? false);
/** Moves a pawn's life on. */
const live = (p: Pawn, ev: LifeEvent): void => {
  p.life = lifeAfter(p.life, ev);
};

/** Where a figure's feet go for a place on the board or the bench. */
export function spotXY(spot: Spot): Pt {
  if (spot.on === "bench") return slotXY(spot.at);
  const p = seatXY(spot.at);
  return { x: p.x, y: p.y + FOOT };
}

function make(id: number, kind: FigureId, stars: Stars, at: Pt, spot: Spot | null): Pawn {
  const p: Pawn = {
    id,
    kind,
    stars,
    due: null,
    life: spot ? { is: "here", spot } : { is: "loose" },
    x: at.x,
    y: at.y,
    lift: 0,
    alpha: 1,
    move: null,
    phase: (id * 0.37) % 1,
    popAt: -9,
    cheerAt: -9,
    wiggleUntil: -9,
    facing: false,
  };
  pawns.set(id, p);
  return p;
}

/** Sends a pawn hopping to a point: `over` the whole interface, for one crossing it. */
export function hop(p: Pawn, to: Pt, dur = 0.24, arc = 9, over = false): void {
  p.move = { from: { x: p.x, y: p.y }, to, t0: V.t, dur, arc, smooth: true, over };
  if (Math.abs(to.x - p.x) > 1) p.facing = to.x < p.x;
}

/** Forgets every pawn, as when a run is put down or another is taken up. */
export function clearPawns(): void {
  pawns.clear();
}

/**
 * Makes the pawns agree with the run: a pawn for every figure, each on its way to where its figure
 * is. Pawns going (into another, or back to the stall) are left to finish.
 */
export function syncPawns(run: RunView | null, settle = false): void {
  const seen = new Set<number>();
  const visit = (piece: RunView["board"][number], spot: Spot): void => {
    if (!piece) return;
    seen.add(piece.id);
    const at = spotXY(spot);
    let p = pawns.get(piece.id);
    if (!p) {
      p = make(piece.id, piece.kind, piece.stars, at, spot);
      return;
    }
    const was = spotOfPawn(p);
    const moved = !was || was.on !== spot.on || was.at !== spot.at;
    const over = aloft(p);
    live(p, { e: "placed", spot });
    // The rules' stars, unless three are hopping together into it and its new star is still to pop.
    if (p.due === null) p.stars = piece.stars;
    else p.due = piece.stars;
    if (settle) {
      p.x = at.x;
      p.y = at.y;
      p.move = null;
      p.stars = piece.stars;
      p.due = null;
    } else if (moved || (!p.move && (Math.abs(p.x - at.x) > 0.5 || Math.abs(p.y - at.y) > 0.5))) {
      hop(p, at, 0.22, 8, over);
    }
  };
  if (run) {
    run.board.forEach((piece, at) => visit(piece, { on: "board", at }));
    run.bench.forEach((piece, at) => visit(piece, { on: "bench", at }));
  }
  for (const [id, p] of pawns) {
    if (!seen.has(id) && p.life.is !== "going") pawns.delete(id);
  }
}

export function stepPawns(): void {
  for (const [id, p] of pawns) {
    if (!p.move) {
      p.lift = 0;
      continue;
    }
    const now = moveAt(p.move, V.t);
    p.x = now.x;
    p.y = now.y;
    p.lift = now.lift;
    if (fadingOf(p.life)) p.alpha = 1 - now.k * now.k;
    if (now.k >= 1) {
      p.move = null;
      p.lift = 0;
      if (goneOnLanding(p.life)) pawns.delete(id);
    }
  }
}

/** The pawn under a point measured from the board's corner: by its body first, then by its seat. */
export function pawnAt(run: RunView, x: number, y: number): Pawn | null {
  let best: Pawn | null = null;
  for (const p of pawns.values()) {
    if (!spotOfPawn(p)) continue;
    const f = framesOf(p.kind);
    const half = Math.max(6, f.wide / 2);
    if (x < p.x - half || x > p.x + half || y > p.y + 3 || y < p.y - f.tall - 1) continue;
    // The one in front; of two side by side (bench figures are a little wider than their hollows), the nearer.
    if (!best || p.y > best.y || (p.y === best.y && Math.abs(x - p.x) < Math.abs(x - best.x))) best = p;
  }
  if (best) return best;
  const seat = seatAtPoint(x, y);
  const slot = seat < 0 ? slotAtPoint(x, y) : -1;
  const piece = seat >= 0 ? run.board[seat] : slot >= 0 ? run.bench[slot] : null;
  return piece ? (pawns.get(piece.id) ?? null) : null;
}

/** The place under a point: a seat, a hollow of the bench, or nowhere. */
export function spotAt(x: number, y: number): Spot | null {
  const seat = seatAtPoint(x, y);
  if (seat >= 0) return { on: "board", at: seat };
  const slot = slotAtPoint(x, y);
  return slot >= 0 ? { on: "bench", at: slot } : null;
}

/** Every fielded figure of a trait hops, one after another: the trait answering. */
export function cheer(run: RunView, trait: TraitId): void {
  let n = 0;
  for (const piece of run.board) {
    if (!piece || !carries(piece.kind, piece.items, trait)) continue;
    const p = pawns.get(piece.id);
    if (!p) continue;
    p.cheerAt = V.t + n * 0.07;
    const at = { x: p.x, y: p.y };
    later(n * 0.07, () => burst(at.x, at.y - 8, 5, [TRAIT_COLOUR[trait], GOLD[2]], { speed: 20, ttl: 0.5 }));
    n++;
  }
}

/** A pawn wiggles for a while, to be noticed. */
export function wiggle(id: number, seconds = 1.2): void {
  const p = pawns.get(id);
  if (p) p.wiggleUntil = V.t + seconds;
}

const STAR_COLS = [GOLD[2], GOLD[1], "#ffffff"];

/** Three become one: the two that go hop onto the one that stays, and its new star pops. */
function merge(note: Extract<Note, { t: "merged" }>, delay: number): void {
  const keeper = pawns.get(note.piece);
  if (keeper) keeper.due = note.stars;
  // The two that go are spoken for from this moment, though they have not yet jumped.
  for (const id of note.gone) {
    const p = pawns.get(id);
    if (p) live(p, { e: "spoken", to: "merge" });
  }
  later(delay, () => {
    snd.hopTogether();
    for (const id of note.gone) {
      const p = pawns.get(id);
      if (!p) continue;
      live(p, { e: "last hop" });
      const to = keeper ? { x: keeper.x, y: keeper.y } : spotXY(note.at);
      hop(p, to, 0.34, 18, aloft(p));
    }
    // The one that stays jumps to meet them.
    if (keeper) keeper.cheerAt = V.t + 0.06;
  });
  later(delay + 0.35, () => {
    const at = keeper ? { x: keeper.x, y: keeper.y } : spotXY(note.at);
    if (keeper) {
      keeper.stars = keeper.due ?? note.stars;
      keeper.due = null;
      keeper.popAt = V.t;
    }
    const grand = note.stars >= 3;
    snd.star(note.stars);
    burst(at.x, at.y - 10, grand ? 40 : 18, STAR_COLS, { speed: grand ? 60 : 42, ttl: grand ? 1 : 0.6, grav: 40 });
    ring(at.x, at.y, grand ? 40 : 22, GOLD[2], grand ? 0.7 : 0.45);
    if (grand) {
      ring(at.x, at.y, 60, GOLD[1], 1);
      later(0.12, () => burst(at.x, at.y - 14, 24, STAR_COLS, { speed: 30, ttl: 1.2, grav: -10 }));
    }
    say(at.x, at.y - 20, grand ? "Three stars!" : "Two stars!", GOLD[2], { big: grand, ttl: grand ? 1.6 : 1.1 });
    signal("merged", note.stars);
  });
}

/** A figure sold: it hops off to the stall, its acorns fly to the purse, and what it held flies back to the rack as it was. */
function soldAway(note: Extract<RaidNote, { t: "sold" }>): void {
  const p = pawns.get(note.piece);
  const to = boardSpot(document.getElementById("stall")) ?? slotXY(4);
  const from = p ? { x: p.x, y: p.y - 8 } : spotXY(note.from);
  if (p) {
    live(p, { e: "spoken", to: "stall" });
    live(p, { e: "last hop" });
    hop(p, to, 0.3, 10, true);
  }
  snd.sell();
  const purse = boardSpot(document.getElementById("acorns")) ?? to;
  for (let i = 0; i < note.acorns; i++) {
    fly(glyphPic("acorn"), from, purse, {
      delay: 0.08 + i * 0.05,
      dur: 0.4,
      arc: 16,
      land: () => {
        snd.acorn(i);
        signal("acorn", 1);
      },
    });
  }
  const rack = boardSpot(document.getElementById("rack")) ?? purse;
  note.items.forEach((item, i) =>
    fly(itemPic(item), from, rack, { delay: 0.15 + i * 0.12, dur: 0.5, arc: 20, land: () => snd.give() }),
  );
}

/** Acts out what the rules said happened, in order. */
export function hearNotes(notes: readonly RaidNote[]): void {
  let delay = 0;
  for (const note of notes) {
    if (note.t === "bought") {
      {
        const from = boardSpot(document.querySelector(`[data-offer="${note.offer}"]`)) ?? slotXY(4);
        // Straight into three of a kind, it has no place: it is loose, held up until it hops in.
        const p = make(note.piece, note.kind, 1, from, note.to);
        if (note.to) hop(p, spotXY(note.to), 0.3, 12, true);
        snd.buy();
        delay = Math.max(delay, 0.16);
      }
    } else if (note.t === "starter") {
      {
        const from = boardSpot(document.querySelector("[data-pick].chosen")) ?? spotXY(note.to);
        const p = make(note.piece, note.kind, 1, from, note.to);
        hop(p, spotXY(note.to), 0.42, 22, true);
        later(0.42, () => {
          snd.place();
          ring(p.x, p.y, 16, GOLD[2]);
        });
      }
    } else if (note.t === "merged") {
      merge(note, delay);
      delay += 0.65;
    } else if (note.t === "sold") soldAway(note);
    else if (note.t === "moved") snd.place();
    else if (note.t === "gave") {
      const p = pawns.get(note.piece);
      if (!p) continue;
      {
        p.cheerAt = V.t;
        if (note.forged) {
          const at = { x: p.x, y: p.y };
          const made = note.forged;
          later(0.12, () => {
            snd.forge();
            burst(at.x, at.y - 12, 16, STAR_COLS, { speed: 34, ttl: 0.6 });
            fly(itemPic(made), { x: at.x, y: at.y - 26 }, { x: at.x, y: at.y - 10 }, { dur: 0.5, arc: 8 });
          });
        } else snd.give();
      }
    }
  }
}
