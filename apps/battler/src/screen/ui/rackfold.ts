/**
 * Where the rack goes. It never covers a seat of the board, a slot of the bench, the players' list
 * at a live table, the top bar, the traits or the stall: where it would, at the window's size and the
 * table's kind, it folds into one "Rack N" button in a place free of all of them, and the button opens
 * it as a panel over the stall. It is worked out again only when the window, the screen, the kind of
 * table or what is on the rack's first row changes, never by what the member does, so nothing moves.
 */
import { el } from "@sequoia-leaf/kit/dom.ts";
import { rackSize, type RunView } from "@sequoia-leaf/raid";
import { COLS, ROWS } from "@sequoia-leaf/raid/hex.ts";

import { BENCH_H, BENCH_SLOTS, BENCH_X, BENCH_Y, cellXY, HEX_H, HEX_W, SLOT_W } from "../geometry.ts";
import { artPx, boardToPage, V } from "../stage.ts";
import { S } from "../state.ts";

/** A box on the page. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
const boxOf = (r: DOMRect): Box => ({ x: r.left, y: r.top, w: r.width, h: r.height });
/** An element's own box, as laid out: a chip swelling for a moment (`woke`) is not bigger. */
function laidOut(e: Element): Box {
  const r = e.getBoundingClientRect();
  if (!(e instanceof HTMLElement)) return boxOf(r);
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  return { x: cx - e.offsetWidth / 2, y: cy - e.offsetHeight / 2, w: e.offsetWidth, h: e.offsetHeight };
}
/** Whether two boxes share any of the page (touching edges do not). */
export const overlaps = (a: Box, b: Box): boolean =>
  a.w > 0 && a.h > 0 && b.w > 0 && b.h > 0 && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Every seat of the board, both halves, and every slot of the bench, as boxes on the page. */
export function tableBoxes(): Box[] {
  const px = artPx();
  const box = (x: number, y: number, w: number, h: number): Box => {
    const at = boardToPage(x, y);
    return { x: at.x, y: at.y, w: w * px, h: h * px };
  };
  const seats = Array.from({ length: ROWS * COLS }, (_, cell) => {
    const c = cellXY(cell, V.gap);
    return box(c.x - HEX_W / 2, c.y - HEX_H / 2, HEX_W, HEX_H);
  });
  const slots = Array.from({ length: BENCH_SLOTS }, (_, i) => box(BENCH_X + i * SLOT_W, BENCH_Y, SLOT_W, BENCH_H));
  return [...seats, ...slots];
}

/** Something the rack keeps clear of: `hard` never covered (the table, the players, the top bar, the stall); else only if nothing is free. */
type Obstacle = Box & { readonly what: string; readonly hard: boolean };
/** What the rack, folded or not, must keep clear of: the table, the players, the top bar, the stall; and the traits and the plate. */
/** An element on the page as something the rack keeps clear of. */
const obstacleOf = (e: Element, hard: boolean): Obstacle =>
  Object.assign(laidOut(e), { what: e.id || e.className, hard });
/** A seat or a slot of the table as something the rack never covers. */
const tableObstacle = (b: Box, i: number): Obstacle =>
  Object.assign({}, b, { what: i < ROWS * COLS ? `seat ${i}` : `slot ${i - ROWS * COLS}`, hard: true });
function obstacles(): Obstacle[] {
  const hard = document.querySelectorAll("#hud > *, #shop, #live-players, #live-clock");
  const soft = document.querySelectorAll("#traits > *, #foe:not([hidden])");
  const of = obstacleOf;
  return [
    ...tableBoxes().map(tableObstacle),
    ...[...hard].map((e) => of(e, true)),
    ...[...soft].map((e) => of(e, false)),
  ];
}

/** For looking from outside: what the rack in its own place would cover, then each place the folded button might go and what is in the way there. */
export function foldReport(): string[] {
  const size = document.getElementById("rackbtn")?.getBoundingClientRect();
  const clear = obstacles();
  const rack = document.getElementById("rack");
  const folded = document.body.classList.contains("rack-folded");
  document.body.classList.remove("rack-folded");
  const own = rack ? boxOf(rack.getBoundingClientRect()) : { x: 0, y: 0, w: 0, h: 0 };
  if (folded) document.body.classList.add("rack-folded");
  const covers = clear
    .filter((b) => b.hard && overlaps(own, b))
    .map(
      (b) =>
        `${b.what} by ${Math.round(Math.min(own.x + own.w, b.x + b.w) - Math.max(own.x, b.x))}x${Math.round(Math.min(own.y + own.h, b.y + b.h) - Math.max(own.y, b.y))}`,
    );
  const inline = `rack ${Math.round(own.x)},${Math.round(own.y)} ${Math.round(own.w)}x${Math.round(own.h)} covers: ${covers.join(", ") || "nothing"}`;
  return [
    inline,
    ...places(size?.width ?? 0, size?.height ?? 0).map((p) => {
      const hit = clear.filter((b) => overlaps(p, b)).map((b) => b.what);
      return `${Math.round(p.x)},${Math.round(p.y)} ${Math.round(p.w)}x${Math.round(p.h)}: ${hit.join(", ") || "free"}`;
    }),
  ];
}

/** The folded rack's button, made the first time it is asked for. */
function rackButton(): HTMLElement {
  const had = document.getElementById("rackbtn");
  if (had) return had;
  const made = el("button", "k-btn sm", {
    id: "rackbtn",
    type: "button",
    "aria-expanded": "false",
    onclick: () => toggleRack(),
  });
  document.body.append(made);
  return made;
}

/**
 * Where the button may go, in order: the top bar's last row at the right, under the top bar at the
 * right, beside the bench at either end, over the stall at either end.
 */
function places(w: number, h: number): Box[] {
  const edge = Math.max(6, window.innerWidth * 0.015);
  const right = window.innerWidth - edge - w;
  const corner = document.getElementById("corner")?.getBoundingClientRect();
  const hud = document.getElementById("hud")?.getBoundingClientRect();
  const shop = document.getElementById("shop")?.getBoundingClientRect();
  const slots = tableBoxes().slice(-BENCH_SLOTS);
  const first = slots[0];
  const last = slots.at(-1);
  const out: Box[] = [];
  if (corner) out.push({ x: right, y: corner.top, w, h });
  if (hud) out.push({ x: right, y: hud.bottom + 4, w, h });
  if (first && last) {
    const y = Math.min(first.y + first.h / 2 - h / 2, (shop?.top ?? Infinity) - h - 4);
    out.push({ x: last.x + last.w + 6, y, w, h }, { x: first.x - w - 6, y, w, h });
  }
  if (shop) out.push({ x: right, y: shop.top - h - 4, w, h }, { x: edge, y: shop.top - h - 4, w, h });
  return out.filter((b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= window.innerWidth && b.y + b.h <= window.innerHeight);
}

/** A phone's layout, where the rack is a column at the side (`raid.css`). */
const PHONE = "(max-aspect-ratio: 4/5), (max-width: 620px)";

/**
 * On a phone, the rack's column goes in the strip between the board's last seats and the window's
 * edge, under the room track: as far right of the seats and as low under the track as it must be.
 */
function besideTheBoard(rack: HTMLElement): void {
  if (!window.matchMedia(PHONE).matches) return;
  const seats = tableBoxes().slice(0, ROWS * COLS);
  const right = Math.max(...seats.map((b) => b.x + b.w));
  const track = document.getElementById("track")?.getBoundingClientRect();
  const own = rack.getBoundingClientRect();
  if (own.left < right + 1) Object.assign(rack.style, { left: `${Math.ceil(right + 1)}px`, right: "auto" });
  if (track && own.top < track.bottom + 2) rack.style.top = `${Math.ceil(track.bottom + 2)}px`;
}

/** What the rack's place was last worked out from. */
const PLACED = { key: "" };

/**
 * Works out whether the rack folds, and where its button goes: the rack where its own rules put it,
 * unless that covers anything it must keep clear of. Its button shows how many things are on it.
 */
export function placeRack(run: RunView | null): void {
  const rack = document.getElementById("rack");
  if (!rack) return;
  const button = rackButton();
  button.textContent = `Rack ${run ? rackSize(run.rack) : 0}`;
  const traits = document.querySelectorAll("#traits > *").length;
  const key = `${window.innerWidth}x${window.innerHeight}|${S.screen.at}|${document.body.dataset.live ?? ""}|${rack.classList.contains("empty")}|${traits}|${V.z}`;
  if (key === PLACED.key) return;
  PLACED.key = key;
  const body = document.body;
  body.classList.remove("rack-folded", "rack-open");
  rack.style.cssText = "";
  besideTheBoard(rack);
  button.setAttribute("aria-expanded", "false");
  const own = boxOf(rack.getBoundingClientRect());
  const clear = obstacles();
  // Folded by what never moves on its own: the table, the players, the top bar, the stall.
  if (!clear.some((b) => b.hard && overlaps(own, b))) return;
  body.classList.add("rack-folded");
  const size = button.getBoundingClientRect();
  const all = places(size.width, size.height);
  const free = (p: Box, only: (o: Obstacle) => boolean): boolean => !clear.some((b) => only(b) && overlaps(p, b));
  const at = all.find((p) => free(p, () => true)) ?? all.find((p) => free(p, (o) => o.hard)) ?? all.at(-1);
  if (at) Object.assign(button.style, { left: `${Math.round(at.x)}px`, top: `${Math.round(at.y)}px` });
}

/** Opens or closes the folded rack over the stall. */
export function toggleRack(open = !document.body.classList.contains("rack-open")): void {
  const shop = document.getElementById("shop")?.getBoundingClientRect();
  const rack = document.getElementById("rack");
  if (!rack || !document.body.classList.contains("rack-folded")) return;
  document.body.classList.toggle("rack-open", open);
  document.getElementById("rackbtn")?.setAttribute("aria-expanded", String(open));
  if (open && shop)
    Object.assign(rack.style, {
      left: `${Math.round(shop.left)}px`,
      top: `${Math.round(shop.top)}px`,
      width: `${Math.round(shop.width)}px`,
      height: `${Math.round(shop.height)}px`,
    });
}

/** Forgets where the rack was placed, so that it is worked out again: for a new table. */
export function forgetRackPlace(): void {
  PLACED.key = "";
}
