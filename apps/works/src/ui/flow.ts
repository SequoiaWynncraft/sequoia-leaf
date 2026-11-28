/**
 * A machine's recipe on its card, drawn rather than said: each part going in as a slot with what it
 * holds, an arrow, and the thing coming out. A dot over a part's slot for each one a single make
 * takes: filled while it holds that many, hollow and coral while the machine waits for it. Once the
 * yard counts, under each part how many a minute and the machines that make that many, and under
 * the thing made how many a minute (coral while it makes less than flat out, with the bolt where power is
 * short or does not reach it, and saying why),
 * or "up to" what its belt carries where it makes more.
 */

import { type Item, numeral } from "@sequoia-leaf/factory";
import { type Description, link, type Stat, thing } from "@sequoia-leaf/kit/card.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";
import { num, perMinute, perMinuteNode } from "@sequoia-leaf/kit/say.ts";

import type { Art } from "../art/index.ts";
import type { Flow, FlowPart } from "./numbers.ts";
import { pic, yardIcon } from "./parts.ts";
import { itemRef, machineRef } from "./refs.ts";

/** So many a minute: the number, then "/min" small. */
const rate = (v: number): HTMLElement => perMinuteNode(v, "fl-rate");

/** A thing in its slot, twice its usual size: its picture names it when pointed at and opens its card; in the corner, what it holds. */
function slotOf(art: Art, t: Item, have: string | null, cls: string): HTMLElement {
  const s = el(
    "span",
    `fl-slot k-slot ${cls}`.trim(),
    {},
    pic(art.item(t), 2),
    have === null ? null : el("b", "fl-have k-name", { text: have }),
  );
  link(s, itemRef(t));
  return s;
}

/** One part: its dots, its slot, and once counted what it takes a minute and what makes that many. */
function partOf(art: Art, p: FlowPart, waiting: boolean): HTMLElement {
  const short = waiting && p.have < p.need;
  const dots = el(
    "span",
    "fl-dots",
    { "aria-label": `${Math.min(p.have, p.need)} of ${p.need} for one` },
    ...Array.from({ length: p.need }, (_, k) =>
      el("i", k < p.have ? "fl-dot full" : waiting ? "fl-dot missing" : "fl-dot"),
    ),
  );
  const by = p.by;
  return el(
    "span",
    `fl-part${short ? " short" : ""}`,
    {},
    dots,
    slotOf(art, p.item, String(p.have), short ? "short" : ""),
    p.perMinute === null ? null : rate(p.perMinute),
    by
      ? el(
          "span",
          "fl-by",
          {},
          thing(machineRef(by.kind), { bare: true, count: num(by.count) }),
          by.top ? el("span", "fl-top k-s", { text: `or ${num(by.top.count)} at ${numeral(by.top.grade)}` }) : null,
        )
      : null,
  );
}

export function flowNode(art: Art, f: Flow): HTMLElement {
  return el(
    "div",
    "flow",
    {},
    el("span", "fl-in", {}, ...f.parts.map((p) => partOf(art, p, f.waiting))),
    el("span", "fl-arrow k-dim k-pix", { "aria-hidden": "true", text: "→" }),
    el(
      "span",
      "fl-part fl-out",
      {},
      el("span", "fl-dots"),
      slotOf(art, f.out, null, "out"),
      el(
        "span",
        `fl-made${f.slow ? " k-coral" : ""}`,
        f.slow ? { "aria-label": f.why } : {},
        f.bolt ? yardIcon("bolt") : null,
        // Making more than its belt carries, it says what the belt lets it send.
        f.most === null ? null : el("span", "fl-upto", { text: "up to" }),
        rate(f.most ?? f.perMinute),
      ),
    ),
  );
}

/**
 * A standing piece's own pace in place of its kind's, so that its headline is the rate its rows say:
 * for a machine with a recipe in mind (`f`), what it makes a minute of what it is making, the number
 * its recipe shows, "up to" what its belt carries where that holds it back; for a piece whose kind
 * says its own (`now`, a breaker's or a still's: what it breaks or distils a minute now), that, in
 * place of the stat of the same name.
 */
export const ownPace = (stats: Description["stats"], f: Flow | null, now: Stat | null = null): (Stat | string)[] =>
  (stats ?? []).map((st) => {
    if (typeof st === "string") return st;
    if (f && st.label.startsWith("Makes")) return { label: "Makes", value: madeSays(f) };
    return now && st.label === now.label ? now : st;
  });
/** What a machine makes a minute, as its card says it. */
export const madeSays = (f: Flow): string =>
  f.most === null ? perMinute(f.perMinute) : `up to ${perMinute(f.perMinute)}`;
