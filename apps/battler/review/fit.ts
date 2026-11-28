/**
 * The stall's cards measured from outside (`window.fit`, beside the tours' handle), for `stallfit.ts`.
 * `check()` puts every figure of every era's catalogue on the stall, five at a time, the first
 * banner's member and the Commodore wearing the longest name a member can have, each with none of it
 * owned, one, two (the next makes three) and one of two stars, its level shown and not, the stall held
 * and not; and on every card it finds:
 *
 * - a word or a tab (a trait's line, how many are owned, the cost, the level, the name) nearer the
 *   frame's inner edge than `--in`, or lying over another;
 * - a trait's name in any face but the small one (where it does not fit, the sign is shown alone), or
 *   a sign larger than its line (every line is one height, so the lines under it never move);
 * - a name cut short whose card does not say it whole (its label);
 * - a card or its frame off the pixel grid (the page at one device pixel to a CSS pixel).
 *
 * It gives back what it found and which names were cut, and puts the run back as it was.
 *
 * `column()` does the same for the level's column at the stall's left: at every level, with and
 * without An Extra Chair, its XP at the longest it can say, and the board as full as the chairs let
 * it with two Stowaways over, every line it shows (the level, its bar and XP, how many are fielded,
 * the odds) lies inside the column and over no other. Run on a run with no chairs and on an endless
 * run with all of them, that is every number of chairs it can show.
 */
import { wear } from "@sequoia-leaf/figures/sprites.ts";
import { bake } from "@sequoia-leaf/kit/skin.ts";
import { ECONOMY, fieldCap, type FigureId, MAX_LEVEL, type Piece, type RunView, type Stars } from "@sequoia-leaf/raid";
import { catalogAt } from "@sequoia-leaf/raid/content/catalog.ts";
import { type Era, isEra, LAST_ERA, RELEASES } from "@sequoia-leaf/raid/content/releases.ts";

import { syncPawns } from "../src/screen/pawns.ts";
import { changed, S } from "../src/screen/state.ts";
import { mageSheet } from "./mage.ts";

/** Sixteen letters, as long as a member's name can be, of the widest the face has. */
const LONGEST = "Wwwwwwwwwwwwwwww";

/** How much of a figure the party owns while its card is looked at: none, one, two of one star, one of two. */
const OWNED: readonly (readonly Stars[])[] = [[], [1], [1, 1], [2]];

interface Box {
  readonly l: number;
  readonly t: number;
  readonly r: number;
  readonly b: number;
}
const boxOf = (e: Element): Box => {
  const r = e.getBoundingClientRect();
  return { l: r.left, t: r.top, r: r.right, b: r.bottom };
};
const meets = (a: Box, b: Box): boolean => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const whole = (n: number): boolean => Math.abs(n - Math.round(n)) < 0.01;
const px = (v: string): number => Number.parseFloat(v) || 0;

/** What is wrong with one card, each said with what it shows. */
function cardFaults(card: HTMLElement): string[] {
  const said = card.getAttribute("aria-label") ?? "?";
  const cs = getComputedStyle(card);
  const u = px(getComputedStyle(document.documentElement).getPropertyValue("--u"));
  const inset = px(cs.getPropertyValue("--in")) || 3 * u;
  const outer = boxOf(card);
  const room: Box = {
    l: outer.l + px(cs.borderLeftWidth) + inset,
    t: outer.t + px(cs.borderTopWidth) + inset,
    r: outer.r - px(cs.borderRightWidth) - inset,
    b: outer.b - px(cs.borderBottomWidth) - inset,
  };
  const faults: string[] = [];
  const parts = [...card.querySelectorAll<HTMLElement>(".tr, .have, .tab, .name")].filter(
    (p) => p.getClientRects().length > 0,
  );
  const boxes = parts.map((p) => [p, boxOf(p)] as const);
  for (const [p, b] of boxes) {
    const what = `${p.className.split(" ").find((c) => ["tr", "have", "tab", "name"].includes(c))} "${p.textContent}"`;
    const near = [
      b.l < room.l - 0.01 ? `left by ${(room.l - b.l).toFixed(1)}` : "",
      b.t < room.t - 0.01 ? `top by ${(room.t - b.t).toFixed(1)}` : "",
      b.r > room.r + 0.01 ? `right by ${(b.r - room.r).toFixed(1)}` : "",
      b.b > room.b + 0.01 ? `bottom by ${(b.b - room.b).toFixed(1)}` : "",
    ].filter(Boolean);
    if (near.length > 0) faults.push(`${said}: ${what} is within the frame's inset (${near.join(", ")})`);
  }
  for (const sign of card.querySelectorAll<HTMLElement>(".tr > canvas")) {
    const line = sign.parentElement;
    const [a, b] = [boxOf(sign), line ? boxOf(line) : null];
    if (b && (a.l < b.l || a.t < b.t || a.r > b.r || a.b > b.b))
      faults.push(`${said}: a trait's sign is larger than its line`);
  }
  boxes.forEach(([p, a], i) => {
    for (const [q, b] of boxes.slice(i + 1))
      if (meets(a, b)) faults.push(`${said}: "${p.textContent}" lies over "${q.textContent}"`);
  });
  const small = px(getComputedStyle(document.documentElement).getPropertyValue("--t-s"));
  for (const tn of card.querySelectorAll<HTMLElement>(".tn"))
    if (tn.getClientRects().length > 0 && px(getComputedStyle(tn).fontSize) !== small)
      faults.push(`${said}: the trait "${tn.textContent}" is not in the small face`);
  const name = card.querySelector<HTMLElement>(".name");
  if (name && name.scrollWidth > name.clientWidth) {
    if (getComputedStyle(name).textOverflow !== "ellipsis") faults.push(`${said}: its name runs out of its foot`);
    if (!said.startsWith(`${name.textContent ?? ""},`)) faults.push(`${said}: cut short, and its card does not say it`);
  }
  const frame = [cs.borderLeftWidth, cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth].map(px);
  if (![outer.l, outer.t, outer.r, outer.b, ...frame].every(whole))
    faults.push(`${said}: off the pixel grid (${[outer.l, outer.t, outer.r - outer.l, outer.b - outer.t].join(", ")})`);
  return faults;
}

/** The run as it is looked at: these five on the stall, owned as `owned` says, its level shown or not, held or not. */
function staged(
  was: RunView,
  era: Era,
  kinds: readonly FigureId[],
  owned: readonly Stars[],
  level: boolean,
  held: boolean,
): RunView {
  let id = 1000;
  const copies: Piece[] = kinds.flatMap((kind) =>
    owned.map((stars) => ({ id: id++, kind, stars, items: [], fed: 0, fights: 0 })),
  );
  const roster: Partial<Record<FigureId, number>> = {};
  for (const k of kinds) roster[k] = 6;
  return {
    ...was,
    era,
    stall: [...kinds, ...Array.from({ length: 5 - kinds.length }, () => null)],
    board: was.board.map((_, i) => copies[i] ?? null),
    bench: was.bench.map(() => null),
    held,
    way: { ...was.way, figures: level ? { pool: "own", roster } : { pool: "fair" } },
  };
}

/** What the cards of one look over every era's catalogue came to: faults, cards looked at, names cut. */
interface Found {
  cards: number;
  readonly faults: Set<string>;
  readonly cut: Set<string>;
}

/** Every figure of every era's catalogue on the stall, five at a time, in every way it can be shown. */
function lookAtAll(was: RunView, found: Found): void {
  for (let n = 1; n <= RELEASES.length; n++) {
    if (!isEra(n)) continue;
    const order = catalogAt(n).order;
    for (let at = 0; at < order.length; at += 5) {
      const kinds = order.slice(at, at + 5);
      for (const owned of OWNED)
        for (const level of [false, true])
          for (const held of [false, true]) {
            S.run = staged(was, n, kinds, owned, level, held);
            syncPawns(S.run, true);
            changed();
            const shown = [...document.querySelectorAll<HTMLElement>("#stall > .offer[data-offer]")];
            if (shown.length !== kinds.length)
              found.faults.add(`era ${n}: ${shown.length} cards for ${kinds.join(", ")}`);
            for (const card of shown) {
              found.cards++;
              for (const f of cardFaults(card)) found.faults.add(`era ${n}: ${f}`);
              const name = card.querySelector<HTMLElement>(".name");
              if (name && name.scrollWidth > name.clientWidth) found.cut.add(name.textContent ?? "");
            }
          }
    }
  }
}

/**
 * Every card checked, the members' figures under their own names and then under the longest a member
 * can have; what was wrong, how many cards were looked at, and which names were cut.
 */
function check(): { cards: number; faults: string[]; cut: string[] } {
  const was = S.run;
  if (!was) return { cards: 0, faults: ["there is no run on the table"], cut: [] };
  const found: Found = { cards: 0, faults: new Set(), cut: new Set() };
  lookAtAll(was, found);
  const skin = bake(mageSheet());
  wear("banner-1", LONGEST, skin);
  wear("commodore", LONGEST, skin);
  lookAtAll(was, found);
  S.run = was;
  syncPawns(S.run, true);
  changed();
  return { cards: found.cards, faults: [...found.faults], cut: [...found.cut] };
}

/** What is wrong with the level's column as it is drawn now, each said with what the run is. */
function columnNow(said: string): string[] {
  const level = document.getElementById("level");
  if (!level) return [`${said}: there is no level column`];
  // As it rests: a level reached bumps it bigger for a moment.
  for (const a of level.getAnimations({ subtree: true })) a.finish();
  const room = boxOf(level);
  const parts = [...level.children].filter((p) => p.getClientRects().length > 0);
  const boxes = parts.map((p) => [p, boxOf(p)] as const);
  const faults: string[] = [];
  for (const [p, b] of boxes) {
    const out = b.l < room.l - 0.01 || b.t < room.t - 0.01 || b.r > room.r + 0.01 || b.b > room.b + 0.01;
    if (out) faults.push(`${said}: "${p.textContent}" runs out of the column`);
  }
  boxes.forEach(([p, a], i) => {
    for (const [q, b] of boxes.slice(i + 1))
      if (meets(a, b)) faults.push(`${said}: "${p.textContent}" lies over "${q.textContent}"`);
  });
  return faults;
}

/** The board as full as a run's chairs let it, with `over` Stowaways more (they take no chair). */
function fullBoard(run: RunView, over: number): (Piece | null)[] {
  const cap = fieldCap(run);
  let id = 2000;
  const piece = (kind: FigureId): Piece => ({ id: id++, kind, stars: 3, items: [], fed: 0, fights: 0 });
  const seated = [
    ...Array.from({ length: cap }, () => piece("rock")),
    ...Array.from({ length: over }, () => piece("crab8")),
  ];
  return run.board.map((_, i) => seated[i] ?? null);
}

/** The level's column at every level, with and without An Extra Chair, its numbers at their longest. */
function column(): { looks: number; faults: string[] } {
  const was = S.run;
  if (!was) return { looks: 0, faults: ["there is no run on the table"] };
  const faults = new Set<string>();
  let looks = 0;
  for (let level = 1; level <= MAX_LEVEL; level++)
    for (const boons of [[], ["extrachair" as const]])
      for (const over of [0, 2]) {
        const need = ECONOMY.levelXp[level - 1] ?? 0;
        const run: RunView = {
          ...was,
          era: LAST_ERA,
          level,
          xp: Math.max(0, need - 1),
          boons: [...was.boons, ...boons],
        };
        S.run = { ...run, board: fullBoard(run, over) };
        syncPawns(S.run, true);
        changed();
        looks++;
        const said = `level ${level}${boons.length > 0 ? ", An Extra Chair" : ""}, ${fieldCap(S.run)} chairs${over > 0 ? `, ${over} Stowaways` : ""}`;
        for (const f of columnNow(said)) faults.add(f);
      }
  S.run = was;
  syncPawns(S.run, true);
  changed();
  return { looks, faults: [...faults] };
}

declare global {
  interface Window {
    fit?: { check: typeof check; column: typeof column };
  }
}

export function openFit(): void {
  window.fit = { check, column };
}
