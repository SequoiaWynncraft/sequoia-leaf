/**
 * The purse as every page of the game shows it: Leaf first, because it is the precious one, then
 * Coins, each a number that rolls to what the purse holds with a small sound. And `fly`, for the
 * little pictures that travel across the page when something is paid or earned. And `closeLeaf`,
 * for a Leaf button that may not take Leaf.
 */
import { el, icon, type IconName, replay } from "./dom.ts";
import { balance, type Currency, leafShut } from "./purse.ts";
import { sfx } from "./sound.ts";
import { tip, tipAt } from "./tip.ts";
import type { Pt } from "./util.ts";

export interface PurseBar {
  /** Call every frame with the seconds since the last: rolls the numbers on. */
  tick(dt: number): void;
  /** Where on the page a currency's icon is, for things to fly to and from. */
  at(kind: Currency): Pt;
  /** Gives a currency's icon a small jump: something has just landed in it. */
  bump(kind: Currency): void;
}

const ABOUT: Record<Currency, readonly [string, string]> = {
  leaf: ["Leaf", "Earned with the guild, out in the world."],
  coins: ["Coins", "Made in town: the Works, the games."],
};

const centre = (node: Element): Pt => {
  const r = node.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/**
 * Fills `host` (a `k-plaque`, usually) with the two counters, and keeps them in step with the purse.
 * `coins` is the number of Coins to show, when a page counts
 * more than the purse holds (the Works, with its till).
 */
export function purseBar(host: HTMLElement, coins: () => number = () => balance().coins): PurseBar {
  const kinds = ["leaf", "coins"] as const;
  const held = (kind: Currency): number => (kind === "coins" ? coins() : balance().leaf);
  const parts = kinds.map((kind) => {
    const art = icon(kind === "leaf" ? "leaf" : "coin");
    const num = el("span", "", { text: held(kind).toLocaleString("en-US") });
    const box = el("span", kind === "leaf" ? "k-cur leaf" : "k-cur", { tabindex: 0 }, art, num);
    host.append(box);
    tip(box, ABOUT[kind][0], ABOUT[kind][1]);
    return { kind, art, num, shown: held(kind) };
  });
  let tickAt = 0;
  return {
    tick(dt) {
      for (const c of parts) {
        const real = held(c.kind);
        if (c.shown === real) continue;
        const d = real - c.shown;
        c.shown += Math.sign(d) * Math.min(Math.abs(d), Math.max(1, Math.ceil(Math.abs(d) * dt * 5)));
        c.num.textContent = c.shown.toLocaleString("en-US");
        const now = performance.now();
        if (d > 0 && now > tickAt) {
          tickAt = now + 70;
          if (c.kind === "leaf") sfx.leaf(c.shown);
          else sfx.coin(c.shown);
        }
      }
    },
    at(kind) {
      const c = parts.find((p) => p.kind === kind);
      return c ? centre(c.art) : { x: 30, y: 30 };
    },
    bump(kind) {
      const c = parts.find((p) => p.kind === kind);
      if (c) replay(c.art, "k-bump");
    },
  };
}

/**
 * Little pictures that fly from one spot on the page to another: Leaf leaving the purse, Coins
 * arriving. `each` is called as each one lands (at once, for a player who asked for less motion).
 */
export function fly(what: IconName, from: Pt, to: Pt, count: number, each: ((i: number) => void) | null = null): void {
  // Asked for less motion, they land at once.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (let i = 0; i < count; i++) each?.(i);
    return;
  }
  for (let i = 0; i < count; i++) {
    const c = icon(what);
    c.style.cssText = "position:fixed;left:0;top:0;z-index:95;pointer-events:none";
    document.body.append(c);
    const half = c.getBoundingClientRect().width / 2;
    const midX = (from.x + to.x) / 2 + (Math.random() - 0.5) * 90;
    const midY = Math.min(from.y, to.y) - 24 - Math.random() * 46;
    const tr = (x: number, y: number, s: number): string => `translate(${x - half}px, ${y - half}px) scale(${s})`;
    const anim = c.animate(
      [
        { transform: tr(from.x, from.y, 0.5), opacity: 0 },
        { transform: tr(from.x, from.y, 1.1), opacity: 1, offset: 0.12 },
        { transform: tr(midX, midY, 1.3), opacity: 1, offset: 0.55 },
        { transform: tr(to.x, to.y, 0.7), opacity: 1 },
      ],
      { duration: 640, delay: i * 75, easing: "ease-in-out", fill: "both" },
    );
    anim.addEventListener("finish", () => {
      c.remove();
      each?.(i);
    });
  }
}

/**
 * Shows a Leaf button closed beside the guild's ledger, where only a game's command takes Leaf
 * (with the made-up guild it is left open): it looks shut, says why when pointed at or touched
 * (`leafShut`), and pressing it only shakes it and says why again. A button with no command to take
 * its Leaf is closed whatever Leaf's spending is; one with a command is passed here only while
 * `leafOpen()` is false, or with its own `why` (too little Leaf for it). Says whether it closed it;
 * if not, the button is the caller's as before.
 * Call it after the button's own listeners are on, in place of giving it a tip.
 */
export function closeLeaf(b: HTMLElement, title = "Leaf", why = leafShut()): boolean {
  b.classList.add("off");
  b.setAttribute("aria-disabled", "true");
  tip(b, title, why);
  b.addEventListener(
    "click",
    (e) => {
      e.stopImmediatePropagation();
      e.preventDefault();
      sfx.no();
      replay(b, "shake");
      const r = b.getBoundingClientRect();
      tipAt({ x: r.left, y: r.top, w: r.width, h: r.height }, title, why, b);
    },
    true,
  );
  return true;
}
