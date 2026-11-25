/**
 * The yard's places for blueprints, as the line over the dock shows them with Select in hand, and the
 * buttons for blueprints beside them: the bin for one in hand, Save yard, and Place for a plan of the
 * whole yard in hand (`plans.ts`). Each is drawn from what the line's print says (`dock.ts`), and a
 * press that asks again draws the line again (`toolHooks.changed`).
 */
import { boxOf, piecesOf, priceOf } from "@sequoia-leaf/factory";
import { amount, asking, asksAgain, el, pressedTwice } from "@sequoia-leaf/kit/dom.ts";
import { whole } from "@sequoia-leaf/kit/say.ts";
import { tip } from "@sequoia-leaf/kit/tip.ts";

import type { Stage } from "../hand.ts";
import {
  askSaveYard,
  deleteKey,
  digest,
  dropBlueprint,
  pressWords,
  saveIn,
  saveKey,
  type YardPress,
} from "../plans.ts";
import { S, toolHooks } from "../state.ts";
import { confirm, hold } from "../tools.ts";
import { button, iconButton, yardIcon } from "./parts.ts";
import { thumb } from "./thumb.ts";

/** A blueprint's place as the line over the dock shows it: empty, or what is kept there and what standing it costs now. */
export type Place =
  | { readonly slot: number; readonly kept: false }
  | {
      readonly slot: number;
      readonly kept: true;
      /** A plan of the whole yard, which shows the whole yard and no price: what it costs depends on the yard it goes back over. */
      readonly whole: boolean;
      readonly w: number;
      readonly h: number;
      readonly cost: number;
      readonly asking: boolean;
      /** The kept bytes, summed, so that a blueprint kept again over another is drawn again. */
      readonly sum: number;
    };

/** The places for blueprints, while Select has nothing marked or Save (or Save yard) is asking. */
export function placesOf(stage: Stage | null): Place[] {
  if (stage?.is !== "empty" && stage?.is !== "saving" && stage?.is !== "savingYard") return [];
  return Array.from({ length: S.world.open.blueprints }, (_, slot): Place => {
    const kept = S.world.blueprints[slot];
    if (!kept) return { slot, kept: false };
    const pieces = piecesOf(kept.pieces);
    const box = boxOf(pieces);
    return {
      slot,
      kept: true,
      whole: kept.whole,
      w: box.w,
      h: box.h,
      cost: kept.whole ? 0 : priceOf(S.world, pieces, true),
      asking: asking(saveKey(slot)),
      sum: digest(kept.pieces),
    };
  });
}

/**
 * One of the yard's places for a blueprint. A kept one shows its layout, its size in tiles and what
 * it costs to stand now (a plan of the whole yard, the whole yard), and is taken in hand by pressing
 * it. While Save or Save yard is asking, pressing a place keeps what it asks about there: at once in
 * an empty one, on a second press over a kept one.
 */
export function placeButton(p: Place, saving: boolean): HTMLElement {
  const b = p.kept
    ? keptButton(p)
    : button(saving ? "wood sm" : "wood sm off", ["Empty"], () => {
        if (S.saving) saveIn(p.slot);
      });
  b.dataset.place = String(p.slot);
  return b;
}

/** A place with a blueprint kept in it: pressed, it is taken in hand, or while Save asks, kept over on a second press. */
function keptButton(p: Extract<Place, { kept: true }>): HTMLElement {
  const { slot } = p;
  const key = saveKey(slot);
  const kept = S.world.blueprints[slot];
  const face =
    p.asking || !kept ? ["Replace?"] : [thumb(piecesOf(kept.pieces), p.whole ? S.world.land : null), factsOf(p)];
  return button(p.asking ? "sm asking" : "wood sm print", face, () => {
    if (!S.saving) hold(slot);
    else if (pressedTwice(key, toolHooks.changed)) saveIn(slot);
  });
}

/** What a kept place says under its picture: its size in tiles and what standing it costs now; a plan of the whole yard, that it is one. */
function factsOf(p: Extract<Place, { kept: true }>): HTMLElement {
  if (p.whole) return el("span", "facts", {}, el("span", "", { text: "Whole yard" }));
  const cost = el("span", p.cost === 0 ? "" : "k-gold", { text: p.cost === 0 ? "free" : whole(p.cost) });
  return el("span", "facts", {}, el("span", "", { text: `${p.w}x${p.h}` }), cost);
}

/** The bin, for a blueprint in hand (`bin`, and whether it asks again): pressed twice, it throws the blueprint away. */
export function binButton(bin: { readonly slot: number; readonly asking: boolean } | null): HTMLElement[] {
  if (!bin) return [];
  const { slot, asking: again } = bin;
  const drop = (): void => {
    if (pressedTwice(deleteKey(slot), toolHooks.changed)) dropBlueprint(slot);
  };
  const b = again
    ? button("sm asking", ["Delete?"], drop)
    : iconButton("wood sm", yardIcon("bin"), "Delete this blueprint", drop);
  tip(b, "Delete this blueprint");
  return [b];
}

/**
 * Save yard, when it is offered (`saveYard`), and Place for a plan of the whole yard in hand
 * (`place`): its net price (what it gives back, with a plus), asked twice as Upgrade all is, and
 * drawn off when it cannot be put back, which a press then says why.
 */
export function yardButtons(saveYard: boolean, place: YardPress | null): HTMLElement[] {
  const out = saveYard ? [button("sm", ["Save yard"], askSaveYard)] : [];
  for (const b of out) b.dataset.act = "save-yard";
  if (!place) return out;
  const label = ["Place", ...(place.cost === 0 ? [] : [amount("coin", pressWords(place.cost))])];
  const style = place.bad ? "sm off" : place.asking ? "sm asking" : "sm";
  const b = button(style, [asksAgain(place.key, label, "Press again")], () => {
    confirm();
  });
  b.dataset.act = "place-yard";
  return [...out, b];
}
