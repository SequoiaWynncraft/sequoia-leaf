/**
 * What the cards read of the page as they are placed: a length a game sets for them, and whether a
 * card's head has room for its name.
 */
import { el } from "./dom.ts";

/** A probe for each length a game sets for the cards: never seen, and as tall as the length. */
const probes = new Map<string, HTMLElement>();

/**
 * A length a game sets for the cards (`--sheet-floor`), in CSS pixels as the browser works it out:
 * the height of a probe that is that tall, so a `calc()`, a `var()` or an `env()` in it counts as it
 * does in the sheet's own rule. Its words are never read as a number. 0 where it is not set.
 */
export function length(name: string): number {
  const had = probes.get(name);
  const probe = had?.isConnected ? had : el("div", "k-probe", { "aria-hidden": "true" });
  if (probe !== had) {
    probe.style.height = `var(${name}, 0px)`;
    document.body.append(probe);
    probes.set(name, probe);
  }
  return probe.getBoundingClientRect().height;
}

/**
 * A card's head that has no room for its name's longest word beside its picture, a way back and its
 * close button (it would push the button off the card): its picture goes first, then the way back
 * moves to a row of its own above (`.k-info-head.tight`, `.tighter`). Close is always on the card.
 * Says whether it changed anything.
 */
export function fitHead(card: HTMLElement): boolean {
  const head = card.querySelector<HTMLElement>(".k-info-head");
  if (!head) return false;
  const cramped = (): boolean => head.scrollWidth > head.clientWidth + 1;
  if (!cramped()) return false;
  head.classList.add("tight");
  if (cramped() && head.querySelector(".k-info-back")) head.classList.add("tighter");
  return true;
}

