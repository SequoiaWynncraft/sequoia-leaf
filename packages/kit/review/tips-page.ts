/**
 * The page `tips.ts` drives: tips and a card's thing, as the games give them, and `window.tips` to
 * say from outside what is up. A plain thing with a tip (`#plain`, it only explains itself), a
 * button with one (`#act`, which counts its presses), a thing with a whole card (`#gem`, and `#low`
 * near the bottom), and a button with a tip in each corner.
 */
import { deck, register, thing } from "../src/card.ts";
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
document.body.append(plain, act, gem, low, ...corners);

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

Object.assign(window, { tips: { say, at } });
