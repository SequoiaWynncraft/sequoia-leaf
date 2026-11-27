/**
 * Traits you can click, on the page. A trait's chip (in the strip, or on a figure's card) is a link
 * to the trait's card (the kit's `card.ts`): pointing at it lights its figures, and pinning its
 * card (a click or a tap) keeps them lit until the card is put away. The cards say which thing is
 * pointed at and which is pinned; this file turns that into which trait is lit.
 *
 * Which trait is lit is kept in `light.ts`; the table draws its figures from there, and this file
 * marks the chips and the stall's offers.
 */
import { close, deck, watch } from "@sequoia-leaf/kit/card.ts";
import { replay } from "@sequoia-leaf/kit/dom.ts";
import { type TraitId, traitsOf } from "@sequoia-leaf/raid";

import { forget, light, lightUp, litTrait } from "../light.ts";
import { snd } from "../sounds.ts";
import { V } from "../stage.ts";
import { catalogNow, prefsChanged, S } from "../state.ts";
import { traitOfRef } from "./cards.ts";

/** The trait the stall and the chips were last marked for, so a change can hop. */
let painted: TraitId | null = null;

/** Marks the chips and the stall's offers for the trait that is lit. */
export function paintLight(): void {
  const lit = litTrait();
  const changed = lit !== painted;
  painted = lit;
  for (const chip of document.querySelectorAll<HTMLElement>("#traits [data-trait]")) {
    chip.classList.toggle("on", chip.dataset.trait === lit);
    chip.setAttribute("aria-pressed", String(chip.dataset.trait === light.kept));
  }
  for (const offer of document.querySelectorAll<HTMLElement>("#stall [data-offer]")) {
    const kind = S.run?.stall[Number(offer.dataset.offer)];
    const has = lit !== null && kind !== null && kind !== undefined && traitsOf(catalogNow(), kind).includes(lit);
    offer.classList.toggle("tlit", has);
    offer.classList.toggle("tdim", lit !== null && !has);
    if (has && changed) replay(offer, "thop");
  }
  document.body.classList.toggle("trait-lit", lit !== null);
}

/** Lets go of whatever is lit and kept: a new run, the front page. A trait's card only pointed at stays while the pointer does. */
export function forgetLight(): void {
  forget(V.t);
  if (keptTrait()) close();
  else lightUp(traitOfRef(deck.pointed), null, V.t);
  paintLight();
}

/** The trait a pinned card keeps lit: the last one in the cards followed to, so a figure opened from a trait's card keeps it lit. */
function keptTrait(): TraitId | null {
  const o = deck.open;
  if (!o?.pinned) return null;
  for (let i = o.stack.length - 1; i >= 0; i--) {
    const t = traitOfRef(o.stack[i] ?? null);
    if (t) return t;
  }
  return null;
}

/** Starts listening to the cards: what is pointed at and pinned lights its trait. */
export function openLight(): void {
  watch((pointed) => {
    const kept = keptTrait();
    const was = light.kept;
    if (lightUp(traitOfRef(pointed), kept, V.t)) paintLight();
    if (kept && kept !== was) {
      snd.tap();
      if (!S.prefs.taught.includes("trait")) {
        S.prefs.taught.push("trait");
        prefsChanged();
      }
    }
  });
}
