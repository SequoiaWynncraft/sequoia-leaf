/**
 * Traits you can click, on the page: a trait's chip (in the strip, or on a figure's card) lights
 * its figures while the pointer is on it, and a click or a tap keeps them lit and opens the trait's
 * card until the member clicks elsewhere, presses Escape or clicks the chip again. A figure picked
 * from the trait's card opens in its place.
 *
 * Which trait is lit is kept in `light.ts`; the table draws its figures from there, and this file
 * marks the chips and the stall's offers.
 */
import { replay } from "@sequoia-leaf/kit/dom.ts";

import { type FigureId, pieces, spotOf, type TraitId, traitsOf } from "../../game/index.ts";
import { unpick } from "../hand.ts";
import { forget, keep, letGo, light, litTrait, point, toggle, unpoint } from "../light.ts";
import { pieceNumbers } from "../logic.ts";
import { snd } from "../sounds.ts";
import { V } from "../stage.ts";
import { prefsChanged, S } from "../state.ts";
import { cardBy, cardOff, figureCard, hookChips, keptOwner, onCard, swapKept, traitCard } from "./cards.ts";

/** Whose card a kept trait's card (or a figure's opened from it) is. */
const TRAIT = { trait: true };
let rest = 0;
/** The trait the stall and the chips were last marked for, so a change can hop. */
let painted: TraitId | null = null;

/** Marks the chips and the stall's offers for the trait that is lit. */
export function paintLight(): void {
  const lit = litTrait();
  const changed = lit !== painted;
  painted = lit;
  for (const chip of document.querySelectorAll<HTMLElement>("#traits [data-chip]")) {
    chip.classList.toggle("on", chip.dataset.chip === lit);
    chip.setAttribute("aria-pressed", String(chip.dataset.chip === light.kept));
  }
  for (const offer of document.querySelectorAll<HTMLElement>("#stall [data-offer]")) {
    const kind = S.run?.stall[Number(offer.dataset.offer)];
    const has = lit !== null && kind !== null && kind !== undefined && traitsOf(kind).includes(lit);
    offer.classList.toggle("tlit", has);
    offer.classList.toggle("tdim", lit !== null && !has);
    if (has && changed) replay(offer, "thop");
  }
  document.body.classList.toggle("trait-lit", lit !== null);
}

/** Lets go of whatever is lit and kept: a new run, the front page. */
export function forgetLight(): void {
  forget(V.t);
  cardOff(TRAIT);
  paintLight();
}

/** Whether a chip is one of the strip's, whose card goes to its side so the other chips stay in view. */
const inStrip = (chip: HTMLElement): boolean => chip.closest("#traits") !== null;

/** Lets go of the kept trait and its card. */
function release(): void {
  window.clearTimeout(rest);
  if (light.kept === null && keptOwner() !== TRAIT) return;
  letGo(V.t);
  cardOff(TRAIT);
  paintLight();
}

/** A figure's card as the trait's card opens it: the member's own (the starriest), or one from the stall. */
function cardOfFigure(kind: FigureId): HTMLElement {
  const run = S.run;
  const own = run
    ? pieces(run)
        .filter((p) => p.kind === kind)
        .toSorted((a, b) => b.stars - a.stars)[0]
    : undefined;
  if (run && own) {
    const at = spotOf(run, own.id);
    return figureCard(kind, own.stars, {
      items: own.items,
      fed: own.fed,
      run,
      numbers: at ? pieceNumbers(run, at) : null,
    });
  }
  return figureCard(kind, 1, { run });
}

/** Starts listening: what the chips do, and the clicks and keys that let a kept trait go. */
export function openLight(): void {
  hookChips({
    point(trait, chip) {
      if (point(trait, V.t)) paintLight();
      window.clearTimeout(rest);
      // The kept card is already this trait's: no second one over it.
      if (keptOwner() === TRAIT && light.kept === trait && !onCard(chip)) return;
      rest = window.setTimeout(() => {
        if (chip.isConnected && litTrait() === trait)
          cardBy(chip, traitCard(trait, S.run, S.almanac), chip, false, inStrip(chip));
      }, 120);
    },
    leave(trait, chip) {
      window.clearTimeout(rest);
      if (unpoint(trait, V.t)) paintLight();
      cardOff(chip);
    },
    press(trait, chip) {
      window.clearTimeout(rest);
      cardOff(chip);
      // The strip's chip toggles; a chip on a card (a figure's) always opens its trait.
      const onACard = onCard(chip);
      if (onACard) keep(trait, V.t);
      const kept = onACard || toggle(trait, V.t);
      paintLight();
      snd.tap();
      if (!S.prefs.taught.includes("trait")) {
        S.prefs.taught.push("trait");
        prefsChanged();
      }
      if (!kept) {
        cardOff(TRAIT);
        // Still pointed at: the trait stays lit, and its card stays up as a passing one.
        if (light.pointed === trait) cardBy(chip, traitCard(trait, S.run, S.almanac), chip, false, inStrip(chip));
        return;
      }
      const card = traitCard(trait, S.run, S.almanac);
      // From inside a kept card (a figure's), the trait's card takes its place; from the strip, it sits beside the chip.
      if (onACard && swapKept(card, TRAIT)) unpick();
      else cardBy(chip, card, TRAIT, true, inStrip(chip));
    },
    figure(kind) {
      swapKept(cardOfFigure(kind), TRAIT);
      snd.tap();
    },
  });
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (light.kept === null && keptOwner() !== TRAIT) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target && (onCard(target) || target.closest("[data-chip]"))) return;
      release();
    },
    true,
  );
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") release();
  });
}
