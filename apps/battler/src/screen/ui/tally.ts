import { nameOf } from "@sequoia-leaf/figures/sprites.ts";
/**
 * The tally as the page shows it: what every figure in a fight did, a row each, "You" on the left
 * and the other party on the right (one at a time on an upright phone, with a switch). Each row is
 * the figure's small picture, its name, a bar and a number; the rows are sorted by the measure on
 * the tab that is chosen and slide into their new places as it changes. Every bar on a tab is
 * drawn to one scale, the largest number on it, and the row with the most carries a star.
 *
 * The same view is the lower panel while a fight plays and the sheet after it; what it shows is
 * worked out by `tally` in the rules. Every row is a target for the figure's card.
 */
import { link } from "@sequoia-leaf/kit/card.ts";
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { folkName } from "@sequoia-leaf/kit/mark.ts";
import { tip } from "@sequoia-leaf/kit/tip.ts";
import { type Did, type Measure, measureOf, MEASURES, partsOf, type Party, type Unit } from "@sequoia-leaf/raid";
import { regularOf } from "@sequoia-leaf/raid/content/rooms.ts";

import { FV } from "../board.ts";
import { acrossName, opening } from "../logic.ts";
import { snd } from "../sounds.ts";
import { pic } from "./cards.ts";
import { headOf } from "./heads.ts";

type Side = 0 | 1;

/** The tab chosen and the party shown on a phone: one choice for every tally, so the sheet opens as the panel was left. */
export const TV: { measure: Measure; side: Side } = { measure: "damage", side: 0 };
const views = new Set<TallyView>();
function choose(measure: Measure | null, side: Side | null): void {
  if (measure) TV.measure = measure;
  if (side !== null) TV.side = side;
  snd.tap();
  redrawTallies();
}
/** Draws every tally again, for the tab and party now chosen. */
export function redrawTallies(): void {
  for (const v of views) v.redraw();
}

const TABS: Readonly<Record<Measure, { label: string; tip: string }>> = {
  damage: { label: "Damage", tip: "Damage dealt: physical in coral, magic in rose, true in cream." },
  tanked: {
    label: "Tanked",
    tip: "Damage that came at it: what got through in coral, what armour, ward and shields kept off in grey.",
  },
  healing: { label: "Healing", tip: "Health given back in green, and shields put up in gold, on others or itself." },
};
/** The colour of each part of a bar, as a class. */
const PARTS: Readonly<Record<Measure, readonly string[]>> = {
  damage: ["phys", "magic", "true"],
  tanked: ["took", "kept"],
  healing: ["mend", "ward"],
};

/** The other party's name as a heading: a regular's in the town's green after the acorn, anyone else's in coral. */
export const partyName = (party: Pick<Party, "who" | "by">): HTMLElement =>
  regularOf(party) ? folkName(opening(party.who), "k-pix") : el("b", "k-coral", { text: acrossName(party) });

interface Row {
  el: HTMLElement;
  bar: HTMLElement;
  n: HTMLElement;
  star: HTMLElement;
}

export interface TallyView {
  /** The whole view: the switch, the tabs and the two parties' rows. */
  readonly el: HTMLElement;
  /** The tabs and the switch, which a layout may put elsewhere. */
  readonly tabs: HTMLElement;
  readonly switcher: HTMLElement;
  /** Shows what everyone in a fight did; `units` says who each one is, and `ours` which side is the member's ("You"; the fight on the table's, unless said). */
  show(units: readonly Unit[], rows: readonly Did[], ours?: Side): void;
  /** Names the party across the table. */
  across(party: Pick<Party, "who" | "by">): void;
  redraw(): void;
  /** Forgets every row, for a fight that is not the one shown. */
  clear(): void;
  /** Lets the view go for good: it no longer follows the tab chosen. */
  drop(): void;
}

/** A tally view whose rows are targets for the cards `refOf` names. */
export function tallyView(refOf: (id: number) => string, cls = ""): TallyView {
  const tabs = el("div", "k-tabs tv-tabs", { role: "tablist", "aria-label": "Measure" });
  const tabButtons = new Map<Measure, HTMLElement>();
  for (const m of MEASURES) {
    const b = el(
      "button",
      "k-btn sm",
      { type: "button", role: "tab", "data-measure": m, onclick: () => choose(m, null) },
      TABS[m].label,
    );
    tip(b, TABS[m].label, TABS[m].tip);
    tabButtons.set(m, b);
    tabs.append(b);
  }
  const switcher = el("div", "k-tabs tv-switch", { role: "tablist", "aria-label": "Party" });
  const sideButtons: HTMLElement[] = [];
  for (const [side, label] of [
    [0, "You"],
    [1, "Them"],
  ] as const) {
    const b = el("button", "k-btn sm", { type: "button", role: "tab", onclick: () => choose(null, side) }, label);
    sideButtons.push(b);
    switcher.append(b);
  }
  const theirs = el("span", "tv-who");
  const lists: [HTMLElement, HTMLElement] = [el("div", "tv-rows k-scroll"), el("div", "tv-rows k-scroll")];
  const sides = el(
    "div",
    "tv-sides",
    {},
    el(
      "section",
      "tv-side",
      { "data-side": "0" },
      el("div", "tv-head", {}, el("b", "k-leafy", { text: "You" })),
      lists[0],
    ),
    el("section", "tv-side", { "data-side": "1" }, el("div", "tv-head", {}, theirs), lists[1]),
  );
  const root = el("div", `tallyv ${cls}`.trim(), {}, sides);
  const rows = new Map<number, Row>();
  let units: readonly Unit[] = [];
  let did: readonly Did[] = [];

  function rowFor(u: Unit): Row {
    let r = rows.get(u.id);
    if (r && r.el.dataset.kind === u.kind) return r;
    r?.el.remove();
    const bar = el("div", "k-bar parts");
    const n = el("b", "tv-n");
    const star = icon("star");
    star.classList.add("tv-star");
    const row = el(
      "div",
      "tv-row",
      { "data-kind": u.kind, "data-id": u.id, tabindex: "0" },
      el("span", "tv-pic", {}, pic(headOf(u.kind))),
      el("span", "tv-name", { text: nameOf(u.kind) }),
      bar,
      n,
      star,
    );
    link(row, refOf(u.id));
    r = { el: row, bar, n, star };
    rows.set(u.id, r);
    return r;
  }

  function redraw(): void {
    root.dataset.measure = TV.measure;
    root.dataset.side = String(TV.side);
    for (const [m, b] of tabButtons) b.setAttribute("aria-selected", String(m === TV.measure));
    sideButtons.forEach((b, i) => b.setAttribute("aria-selected", String(i === TV.side)));
    const m = TV.measure;
    const byId = new Map(units.map((u) => [u.id, u]));
    const shown = did.flatMap((d) => {
      const u = byId.get(d.id);
      return u ? [{ d, u, v: measureOf(d, m) }] : [];
    });
    const order = shown.toSorted((a, b) => b.v - a.v || a.d.id - b.d.id);
    const scale = Math.max(1, ...order.map((s) => s.v));
    const best = order[0] && order[0].v > 0 ? order[0].d.id : -1;
    const keep = new Set(order.map((s) => s.d.id));
    for (const [id, r] of rows) {
      if (keep.has(id)) continue;
      r.el.remove();
      rows.delete(id);
    }
    // Where every row is now, so that a row that changes place can slide there.
    const was = new Map<number, number>();
    for (const [id, r] of rows) if (r.el.isConnected) was.set(id, r.el.getBoundingClientRect().top);
    for (const side of [0, 1] as const) {
      const list = lists[side];
      order
        .filter((s) => s.u.side === side)
        .forEach((s, i) => {
          const r = rowFor(s.u);
          const parts = partsOf(s.d, m);
          const classes = PARTS[m];
          while (r.bar.children.length > parts.length) r.bar.lastElementChild?.remove();
          parts.forEach((v, j) => {
            let seg = r.bar.children[j];
            if (!(seg instanceof HTMLElement)) {
              seg = el("i");
              r.bar.append(seg);
            }
            if (seg instanceof HTMLElement) {
              seg.className = classes[j] ?? "";
              seg.style.setProperty("--v", `${(v / scale) * 100}%`);
            }
          });
          r.n.textContent = String(s.v);
          r.el.classList.toggle("down", !s.d.stood);
          r.el.classList.toggle("best", s.d.id === best);
          if (list.children[i] !== r.el) list.insertBefore(r.el, list.children[i] ?? null);
        });
    }
    for (const [id, r] of rows) {
      const from = was.get(id);
      if (from === undefined) continue;
      const dy = from - r.el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      r.el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], {
        duration: 240,
        easing: "steps(6, end)",
      });
    }
  }

  const view: TallyView = {
    el: root,
    tabs,
    switcher,
    show(u, d, ours = FV.ours) {
      units = u.map((x) => ({ ...x, side: x.side === ours ? 0 : 1 }));
      did = d;
      redraw();
    },
    across(party) {
      theirs.replaceChildren(partyName(party));
    },
    redraw,
    clear() {
      for (const r of rows.values()) r.el.remove();
      rows.clear();
      units = [];
      did = [];
    },
    drop() {
      views.delete(view);
    },
  };
  views.add(view);
  redraw();
  return view;
}
