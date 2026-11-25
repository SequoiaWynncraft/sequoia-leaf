/**
 * Blueprints with Select: the pieces a blueprint in hand would stand, keeping the marked pieces in a
 * place, keeping the whole yard in one once "A plan of the whole yard" is known, putting such a plan
 * back, and throwing a blueprint away.
 *
 * A plan of the whole yard goes back where it was taken: in hand, it shows the yard as it would be
 * put back (what is stood, over the yard with what is taken up gone), wherever the pointer is. The
 * rules work out what it takes (`yardPlan`); Place, pressed twice as Upgrade all is, puts it back,
 * all of it or none, for its net price. Short of Coins, or with a piece that cannot stand, Place says
 * why at once and asks nothing.
 */
import {
  blueprintRefusal,
  DEPOT,
  locked,
  NONE,
  type Piece,
  piecesAt,
  piecesOf,
  yardPlan,
  yardRefusal,
} from "@sequoia-leaf/factory";
import { asking, pressedTwice } from "@sequoia-leaf/kit/dom.ts";
import { GOLD } from "@sequoia-leaf/kit/palette.ts";
import { coinsText, whole } from "@sequoia-leaf/kit/say.ts";

import { TILE } from "./art/belts.ts";
import { float, puff, sparkle } from "./fx.ts";
import { groupOf, type HandEvent, markOf, type Stage } from "./hand.ts";
import { yardSfx } from "./sound.ts";
import { type Aim, type Group, moveHand, pressKey, S, toolHooks } from "./state.ts";
import { coins, doNow } from "./yard.ts";

const DUST = "#cbb894";

/** 32 bits of some numbers: a blueprint's bytes, the tiles of an area marked. */
export function digest(values: ArrayLike<number>): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < values.length; k++) h = Math.imul(h ^ (values[k] ?? 0), 0x01000193);
  return h >>> 0;
}

/**
 * A press that waits for a second (`pressedTwice`) is named by exactly what it confirms (`pressKey`):
 * a blueprint's place by its number and what is kept there; Save over a kept place by what it keeps
 * there too (the area marked, or the whole yard).
 */
const printKey = (slot: number): string => {
  const p = S.world.blueprints[slot];
  return p ? `${slot}:${p.whole ? "yard" : "area"}:${digest(p.pieces)}` : `${slot}:none`;
};
/** Place, putting the plan of the whole yard in a place back. */
export const placeKey = (slot: number): string => pressKey(`place:${printKey(slot)}`);
/** The bin, throwing the blueprint in a place away. */
export const deleteKey = (slot: number): string => pressKey(`delete:${printKey(slot)}`);
/** A kept place pressed while Save or Save yard asks where: keeping what it asks about over what is kept there. */
export function saveKey(slot: number): string {
  const h = S.hand;
  const m = markOf(h);
  const what = h.is === "select" && h.stage.is === "savingYard" ? "yard" : m ? `area:${digest(m.tiles)}` : "none";
  return pressKey(`save:${printKey(slot)}:${what}`);
}

/** Moves what is in hand (`moveHand`). */
const go = moveHand;

/** Says why the rules would not, with its sound. */
function no(why: string): false {
  yardSfx.no();
  toolHooks.said(`${why}.`);
  return false;
}

/** Whether the yard may keep and put back plans of the whole yard. */
export const wholeKnown = (): boolean => locked(S.world.open, { use: "whole" }) === null;

/** Whether what is in hand, or a place, is a plan of the whole yard. */
export const isWhole = (as: Group["as"] | undefined): boolean =>
  typeof as === "number" && S.world.blueprints[as]?.whole === true;

/** Whether the pieces in hand can be turned: any but a plan of the whole yard, which goes back as it was. */
export const turnsInHand = (g: Group | null): boolean => g !== null && !isWhole(g.as);

/**
 * The pieces in hand as they stand now, at no place yet: a blueprint's, or what stands on the tiles
 * taken up (a move or a copy sets down what stands there, as the rules do).
 */
export function piecesInHand(g: Pick<Group, "as" | "tiles">): Piece[] {
  if (typeof g.as !== "number") return piecesAt(S.world, g.tiles);
  const print = S.world.blueprints[g.as];
  return print ? piecesOf(print.pieces) : [];
}

/**
 * A plan of the whole yard in hand, aimed: the pieces it would stand and why each cannot, the tiles of
 * those it would take up, and the rules' reason it cannot be put back now (with the purse as it is),
 * or none, and its net price. It is aimed at the depot, wherever the pointer is.
 */
export function aimYard(g: Group): HandEvent {
  const w = S.world;
  const print = typeof g.as === "number" ? w.blueprints[g.as] : null;
  const plan = print ? yardPlan(w, print) : null;
  const purse = coins();
  const [x, y] = w.land.depot;
  const why = plan ? yardRefusal(w, plan, purse) : "There is no blueprint there";
  const aim: Aim = { x, y, why, cost: plan?.price ?? 0, far: -1, yard: w, rev: w.rev, coins: purse };
  const group = { ...g, tiles: plan?.tiles ?? [], at: [...(plan?.stood ?? [])], why: [...(plan?.why ?? [])] };
  return { do: "group", group, aim };
}

/** What a plan of the whole yard costs to put back, as the line and Place say it. */
const priceWords = (cost: number): string =>
  cost > 0 ? coinsText(cost) : cost < 0 ? `gives back ${coinsText(-cost)}` : "free";

/** What the line over the dock says with a plan of the whole yard in hand: what it builds, what it takes up, and its price. */
export function yardLine(g: Group, aim: Aim | null): string {
  const up = piecesAt(S.world, g.tiles).length;
  return `Whole yard: ${whole(g.at.length)} to build, ${whole(up)} to take up, ${priceWords(aim?.cost ?? 0)}.`;
}

/** Place, with a plan of the whole yard in hand: its price, whether it asks to be pressed again, and whether it cannot be put back. */
export interface YardPress {
  /** What its press waiting for a second is named (`placeKey`). */
  readonly key: string;
  readonly cost: number;
  readonly asking: boolean;
  readonly bad: boolean;
}
export function yardPress(): YardPress | null {
  const g = groupOf(S.hand);
  const aim = S.aim;
  if (!g || !aim || typeof g.as !== "number" || !isWhole(g.as)) return null;
  const key = placeKey(g.as);
  return { key, cost: aim.cost, asking: asking(key), bad: aim.why !== null };
}

/** What Place says beside its Coins: what it costs, or gives back. */
export const pressWords = (cost: number): string => (cost < 0 ? `+${whole(-cost)}` : whole(cost));

/**
 * Place pressed (or the yard, with a plan of the whole yard in hand): refused at once with the rules'
 * reason, else asked twice; then put back, as one command on the copy and on Leaf, and let go of.
 */
export function pressYard(): boolean {
  const g = groupOf(S.hand);
  const aim = S.aim;
  if (!g || typeof g.as !== "number" || !aim) return false;
  if (aim.why !== null) return no(aim.why);
  if (!pressedTwice(placeKey(g.as), toolHooks.changed)) return false;
  const up = piecesAt(S.world, g.tiles);
  const did = doNow({ do: "placeBlueprint", slot: g.as, turns: 0, x: 0, y: 0 });
  if ("refused" in did) return no(did.why);
  for (const p of up.slice(0, 160)) puff(p.x * TILE + 8, (p.y + 1) * TILE - 4, 3, DUST, 9);
  for (const p of g.at.slice(0, 160)) sparkle(p.x * TILE + 8, p.y * TILE + 6, 2, 5);
  if (aim.cost !== 0) {
    const text = aim.cost > 0 ? `-${whole(aim.cost)}` : `+${whole(-aim.cost)}`;
    float(aim.x * TILE, aim.y * TILE, text, GOLD[aim.cost > 0 ? 0 : 2], 1.4);
  }
  yardSfx.ready();
  go({ do: "unhold" });
  toolHooks.changed();
  return true;
}

// ---------- keeping ----------

/** Save yard, once the yard may keep plans of the whole yard: with Select in hand, nothing marked, and something standing to keep. */
export const yardSaveOffered = (stage: Stage | null): boolean =>
  stage?.is === "empty" && wholeKnown() && S.world.kind.some((k) => k !== NONE && k !== DEPOT);

/** Save yard pressed: the places are offered to keep the whole yard in, or with it pressed again, put away. */
export function askSaveYard(): void {
  go({ do: "saveYard" });
  toolHooks.changed();
}

/** Save was pressed: the places are offered, unless the marked pieces cannot be a blueprint. */
export function askSave(): void {
  // Whichever place it goes in, the pieces themselves must be ones a blueprint may hold.
  const m = markOf(S.hand);
  const why = m ? blueprintRefusal(S.world.open, 0, m.pieces) : null;
  if (why !== null) {
    no(why);
    return;
  }
  go({ do: "save" });
  toolHooks.changed();
}

/** The pieces kept glint as they are taken down, and the words rise from `x`, `y`. */
function saved(pieces: readonly Piece[], x: number, y: number): true {
  for (const p of pieces.slice(0, 120)) sparkle(p.x * TILE + 8, p.y * TILE + 6, 2, 5);
  float(x * TILE, y * TILE, "Blueprint saved", GOLD[2], 1.6);
  yardSfx.ready();
  toolHooks.changed();
  return true;
}

/** Keeps the marked pieces in a place, Save having asked where. */
function saveMark(slot: number): boolean {
  const m = markOf(S.hand);
  if (!m) return false;
  const did = doNow({ do: "saveBlueprint", slot, tiles: m.tiles });
  if ("refused" in did) return no(did.why);
  go({ do: "save" });
  return saved(m.pieces, (m.x0 + m.x1 + 1) / 2, m.y0);
}

/** Keeps every piece in the yard in a place, as a plan of the whole yard, Save yard having asked where. */
function saveYardIn(slot: number): boolean {
  const did = doNow({ do: "saveYard", slot });
  if ("refused" in did) return no(did.why);
  go({ do: "saveYard" });
  const [x, y] = S.world.land.depot;
  return saved(
    piecesAt(
      S.world,
      Array.from({ length: S.world.kind.length }, (_, i) => i),
    ),
    x,
    y,
  );
}

/** Keeps what Save is asking about in a place: the marked pieces, or with Save yard asking, the whole yard. */
export const saveIn = (slot: number): boolean =>
  S.hand.is === "select" && S.hand.stage.is === "savingYard" ? saveYardIn(slot) : saveMark(slot);

/** What the line over the dock says while Save asks where. */
export const savingLine = (): string =>
  S.hand.is === "select" && S.hand.stage.is === "savingYard"
    ? "Save the whole yard in which place?"
    : "Save it in which place?";

/** Throws away the blueprint in a place, and lets go of it if it was in hand. */
export function dropBlueprint(slot: number): void {
  if ("refused" in doNow({ do: "deleteBlueprint", slot })) return;
  if (groupOf(S.hand)?.as === slot) go({ do: "unhold" });
  yardSfx.take();
  toolHooks.changed();
}
