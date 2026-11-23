/**
 * A machine's recipe on its card, drawn rather than said: each part going in as a slot with what it
 * holds, an arrow, and the thing coming out. A dot over a part's slot for each one a single make
 * takes: filled while it holds that many, hollow and coral while the machine waits for it. Once the
 * yard counts, under each part how many a minute and the machines that make that many, and under
 * the thing made how many a minute (coral, with the bolt, while power is short).
 */

import { type Item, numeral } from "@sequoia-leaf/factory";
import { link, thing } from "@sequoia-leaf/kit/card.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";

import type { Art } from "../art/index.ts";
import type { Flow, FlowPart } from "./numbers.ts";
import { pic, yardIcon } from "./parts.ts";
import { itemRef, machineRef } from "./refs.ts";

/** A number as a card says it: whole, or to one place. */
const n = (v: number): string => v.toLocaleString("en-US", { maximumFractionDigits: 1 });

/** So many a minute: the number, then "/min" small. */
const rate = (v: number): HTMLElement =>
  el("span", "fl-rate", {}, el("span", "k-name", { text: n(v) }), el("span", "k-s k-dim", { text: "/min" }));

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
          thing(machineRef(by.kind), { bare: true, count: n(by.count) }),
          by.top ? el("span", "fl-top k-s", { text: `or ${n(by.top.count)} at ${numeral(by.top.grade)}` }) : null,
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
        f.slow ? { "aria-label": "power is short" } : {},
        f.slow ? yardIcon("bolt") : null,
        rate(f.perMinute),
      ),
    ),
  );
}
