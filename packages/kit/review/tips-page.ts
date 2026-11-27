/**
 * The page `tips.ts` drives: tips and a card's thing, as the games give them, and `window.tips` to
 * say from outside what is up. A plain thing with a tip (`#plain`, it only explains itself), a
 * button with one (`#act`, which counts its presses), a thing with a whole card (`#gem`, and `#low`
 * near the bottom), a button with a tip in each corner, a thing just above the page's bar
 * (`#floor`, a `calc()` in `tips.html`), one in the middle with a long card (`#tall`), one lower
 * with a longer card (`#mid`), a tip given twice (`#retipped`), a thing with words of its own that
 * describe it (`#helped`), and a link inside a link (`#inner` in `#outer`).
 */
import { deck, link, pick, point, refresh, register, settle, thing } from "../src/card.ts";
import { el } from "../src/dom.ts";
import { tip } from "../src/tip.ts";

const pressed = { n: 0 };

register("gem", (id) =>
  id === "amber"
    ? {
        name: "Amber",
        tag: "Finished item",
        glance: "Adds 15 attack to its holder",
        stats: [
          { label: "Attack", value: "15", ref: "stat:attack" },
          { label: "Speed", value: "1.1", hint: "Attacks a second." },
        ],
        sections: [
          {
            s: "says",
            label: "Effect",
            lines: [{ text: "Kin figures holding it strike first.", refs: ["trait:kin"] }],
          },
          {
            s: "sum",
            label: "Attack",
            rows: [
              { label: "Figure", value: "40" },
              { label: "Kin", value: "+15", ref: "trait:kin" },
            ],
            total: "55",
          },
        ],
      }
    : null,
);
/** A note of so many lines, each a sentence. */
const lines = (n: number): { text: string }[] =>
  Array.from({ length: n }, (_, i) => ({ text: `Line ${i + 1} of what it says.` }));

register("note", (id) =>
  id === "longer"
    ? { name: "Longer Note", sections: [{ s: "says", label: "Lines", lines: lines(30) }] }
    : id === "tall"
      ? {
          name: "Long Note",
          glance: "A card too long to fit whole beside it",
          sections: [
            {
              s: "says",
              label: "Lines",
              lines: lines(14),
            },
          ],
        }
      : null,
);
register("stat", (id) => (id === "attack" ? { name: "Attack 15", glance: "Damage a hit does before armour" } : null));
register("trait", (id) => (id === "kin" ? { name: "Kin", glance: "Kin strike first" } : null));

const plain = el("span", "k-chip", { id: "plain" }, "Purse 1,200");
tip(plain, "Purse", "Coins you carry.");
const act = el("button", "k-btn wood", { id: "act", type: "button", onclick: () => pressed.n++ }, "Reroll");
tip(act, "Reroll", "New figures on the stall.");
const gem = thing("gem:amber");
gem.id = "gem";
const low = thing("gem:amber");
low.id = "low";
low.style.cssText = "position: fixed; left: 40%; bottom: 60px;";
const corners = ["tl", "tr", "bl", "br"].map((id) => {
  const b = el("button", "k-btn wood sm corner", { id, type: "button" }, id);
  tip(b, `Corner ${id}`, "Its tip stays inside the window and off the button.");
  return b;
});
const floor = thing("trait:kin");
floor.id = "floor";
const tall = thing("note:tall");
tall.id = "tall";
const mid = thing("note:longer");
mid.id = "mid";
const retipped = el("span", "k-chip", { id: "retipped" }, "Retip me");
tip(retipped, "Old", "Before");
tip(retipped, "New", "After");
const helped = el("span", "k-chip", { id: "helped", "aria-describedby": "help" }, "Helped");
tip(helped, "Helped", "It has words of its own too.");
const help = el("span", "", { id: "help", hidden: true }, "Words of its own.");
const inner = thing("stat:attack");
inner.id = "inner";
const outer = el("span", "k-chip", { id: "outer" }, "Kin, with ", inner);
link(outer, "trait:kin");
document.body.append(plain, act, gem, low, ...corners, floor, tall, mid, retipped, helped, help, outer);

/** Whether a box is inside the window and clear of another. */
function clearOf(card: DOMRect, of: DOMRect): boolean {
  const inside = card.left >= 0 && card.top >= 0 && card.right <= innerWidth && card.bottom <= innerHeight;
  const apart = card.left >= of.right || card.right <= of.left || card.top >= of.bottom || card.bottom <= of.top;
  return inside && apart;
}

/** What is up, in a line: the card and how, where the focus is, presses on `#act`, and whether the card is clear of its thing. */
function say(): string {
  const o = deck.open;
  const node = document.querySelector<HTMLElement>(".k-info:not(.peek)");
  const name = node?.querySelector(".k-name")?.textContent ?? "";
  const how = o ? (o.pinned ? "pinned" : o.glance ? "glance" : "passing") : "none";
  const sheet = node?.classList.contains("sheet") ? ` sheet-${node.classList.contains("top") ? "top" : "bottom"}` : "";
  const active = document.activeElement;
  const focus = active && node?.contains(active) ? "card" : active?.id || "body";
  const from = o?.from instanceof Element ? o.from.getBoundingClientRect() : null;
  const clear = node && from ? (clearOf(node.getBoundingClientRect(), from) ? "yes" : "no") : "-";
  const back = o && o.stack.length > 1 ? " back" : "";
  return `${how}${name ? ` ${name}` : ""}${sheet}${back} focus=${focus} pressed=${pressed.n} clear=${clear}`;
}

/** The middle of an element, for a finger or the mouse. */
function at(selector: string): { x: number; y: number } | null {
  const r = document.querySelector(selector)?.getBoundingClientRect();
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}

/**
 * The pinned card scrolled to its foot, then drawn again (`refresh`) or placed again (`settle`):
 * whether it was shortened to fit, and whether it is scrolled where it was.
 */
function keeps(how: "refresh" | "settle"): string {
  const before = document.querySelector<HTMLElement>(".k-info.pinned");
  if (!before) return "no card";
  before.scrollTop = before.scrollHeight;
  const was = before.scrollTop;
  if (how === "refresh") refresh();
  else settle();
  const after = document.querySelector<HTMLElement>(".k-info.pinned");
  return `shortened=${(after?.style.maxHeight ?? "") !== ""} scrolled=${was > 0} kept=${after?.scrollTop === was}`;
}

/** An attribute of an element, or "none". */
const attr = (selector: string, name: string): string => document.querySelector(selector)?.getAttribute(name) ?? "none";

/** Points at a thing drawn on a canvas, in a box 20 pixels square at a point (`ref` null: at nothing). */
const pointAt = (ref: string | null, x = 0, y = 0): string => {
  point(ref, x, y, 20, 20);
  return ref ?? "nothing";
};

/** Clicks a thing drawn on a canvas, in a box 20 pixels square at a point: its card is pinned there. */
const pickAt = (ref: string, x: number, y: number): string => {
  pick(ref, x, y, 20, 20);
  return ref;
};

/** The card a canvas thing opened, and the box it is beside. */
function pointed(): string {
  const o = deck.open;
  const box = o?.at;
  const how = o ? (o.pinned ? "pinned" : o.glance ? "glance" : "passing") : "none";
  return box && "x" in box && "y" in box ? `${how} at ${String(box.x)},${String(box.y)}` : how;
}

/** Sets how tall the page's bar along the bottom is, or (null) leaves it as the page's style sets it. */
function bar(px: string | null): string {
  if (px === null) document.documentElement.style.removeProperty("--sheet-floor");
  else document.documentElement.style.setProperty("--sheet-floor", px);
  return `bar ${px ?? "as the page sets it"}`;
}

Object.assign(window, { tips: { say, at, keeps, attr, point: pointAt, pick: pickAt, pointed, bar } });
