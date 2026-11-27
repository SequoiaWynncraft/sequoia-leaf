/**
 * What a live table adds round the table: the clock at the top (what this stage is, the seconds
 * left, and whom the member faces), the players down the right side in seat order (on a phone a row
 * of small health chips over the board), and a player's board as it stood at the last lock, opened
 * from their row (scouting). Everything is drawn from the sitting as Leaf shows it; the clock counts
 * Leaf's own deadline.
 *
 * Every part keeps its size whatever it says: rows are as many as the seats, a row out only dims,
 * and the numbers sit in places of their own width.
 */
import { nameOf as figureName, portrait, starsPic } from "@sequoia-leaf/figures/sprites.ts";
import { link } from "@sequoia-leaf/kit/card.ts";
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { type Catalog, catalogOf, itemName } from "@sequoia-leaf/raid";
import { seatCell } from "@sequoia-leaf/raid/hex.ts";
import type { SeatView, SittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { glyph, itemIcon } from "../art/icons.ts";
import { BENCH_Y, BOARD_H, BOARD_W } from "../geometry.ts";
import { snd } from "../sounds.ts";
import { boardToPage } from "../stage.ts";
import { figPic, pic } from "../ui/cards.ts";
import { headOf } from "../ui/heads.ts";
import { choosingNow, clockLine, clockOf, placeText, type PlayerRow, playerRows, seatName } from "./reads.ts";

const COLS = 7;
const ROWS = 4;

/** The parts, built once, and which player's board is open. */
const HUD: {
  clock: HTMLElement | null;
  /** The clock's second line again, as a strip under the players on a phone, where the clock is small. */
  say: HTMLElement | null;
  players: HTMLElement | null;
  scout: HTMLElement | null;
  open: number | null;
} = { clock: null, say: null, players: null, scout: null, open: null };

/** Builds the clock, the players' list and the scouting panel, hidden until the member is at a live table. */
export function buildHud(): void {
  const clock = el(
    "div",
    "k-plaque hung",
    { id: "live-clock", role: "timer", "aria-live": "off" },
    el("span", "label"),
    el("b", "secs"),
    el("span", "vs k-dim"),
  );
  const players = el("nav", "k-panel", { id: "live-players", "aria-label": "Players" });
  const scout = el("section", "k-panel", { id: "live-scout", hidden: true, role: "dialog" });
  const say = el("p", "k-tip", { id: "live-say", "aria-hidden": "true" });
  document.getElementById("hud")?.insertBefore(clock, document.getElementById("resolve"));
  document.body.append(players, say, scout);
  HUD.say = say;
  HUD.clock = clock;
  HUD.players = players;
  HUD.scout = scout;
}

/** The clock: the stage, its seconds left (Leaf's clock, `now`), and under it the carousel's turn or whom the member faces. */
export function renderClock(view: SittingView, now: number): void {
  const clock = HUD.clock;
  if (!clock) return;
  const { label, seconds } = clockOf(view, now);
  const [labelEl, secsEl, vsEl] = [...clock.children];
  if (labelEl && labelEl.textContent !== label) labelEl.textContent = label;
  const secs = seconds === null ? "" : String(seconds);
  if (secsEl && secsEl.textContent !== secs) secsEl.textContent = secs;
  const line = clockLine(view, now);
  if (vsEl && vsEl.textContent !== line) vsEl.textContent = line;
  if (HUD.say && HUD.say.textContent !== line) HUD.say.textContent = line;
  if (HUD.say) {
    HUD.say.hidden = line === "";
    // In the gap between the board and the bench, clear of the ring and of whoever waits across.
    const at = boardToPage(BOARD_W / 2, (BOARD_H + BENCH_Y) / 2);
    HUD.say.style.top = `${Math.round(at.y)}px`;
  }
  clock.classList.toggle("short", seconds !== null && seconds <= 5);
  clock.setAttribute(
    "aria-label",
    `${seconds === null ? label : `${label}, ${seconds} seconds left`}${line ? `. ${line}` : ""}`,
  );
}

/** A seat's small picture: a regular's figure, or a member's initial on a plate. */
function face(seat: SeatView): HTMLElement {
  if (seat.who.is === "regular") return el("span", "face", {}, pic(headOf(seat.who.figure)));
  return el("span", "face member", { text: seatName(seat).charAt(0) });
}

/** A seat's name: a regular's with the town's mark, as regulars are named everywhere. */
const nameOf = (seat: SeatView, row: PlayerRow): HTMLElement =>
  el("b", seat.who.is === "regular" ? "name folk" : "name", { text: row.name });

/** One row of the players' list; on a phone, a chip. */
function rowOf(view: SittingView, row: PlayerRow, took: HTMLElement | null, choosing: boolean): HTMLElement {
  const seat = view.seats[row.seat];
  if (!seat) return el("span");
  const out = row.place !== null;
  const label = `${row.name}${row.you ? " (you)" : ""}, ${out && row.place !== null ? `out, ${placeText(row.place)}` : `health ${row.resolve}`}`;
  const button = el(
    "button",
    `player${row.you ? " lit" : ""}${out ? " out" : ""}${row.facing ? " facing" : ""}${HUD.open === row.seat ? " open" : ""}${choosing ? " choosing" : ""}`,
    { type: "button", "data-seat": row.seat, "aria-label": label, onclick: () => scoutSeat(view, row.seat) },
    face(seat),
    nameOf(seat, row),
    el(
      "span",
      `k-bar hp ${row.you ? "leaf" : "coral"}`,
      {},
      el("i", "", { style: `--v:${Math.round(row.fill * 100)}%` }),
    ),
    el("b", "n", { text: out && row.place !== null ? placeText(row.place).split(" ")[0] : String(row.resolve) }),
    row.facing ? el("span", "vs", {}, pic(glyph("swords"))) : null,
    took,
  );
  return button;
}

/** The figure a seat has taken in the carousel, small, beside its row. */
function tookOf(view: SittingView, seat: number): HTMLElement | null {
  if (view.stage.at !== "carousel") return null;
  const offer = view.stage.ring.find((o) => o.by === seat);
  return offer ? el("span", "took", {}, pic(headOf(offer.kind))) : null;
}

/** The players, in seat order: name, health as a bar and a number, out and in what place; the member's own lit. */
export function renderPlayers(view: SittingView): void {
  const box = HUD.players;
  if (!box) return;
  const key = JSON.stringify([view.seats.map((s) => [s.resolve, s.place, s.faces]), view.stage, HUD.open, view.you]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.seat : undefined;
  const choosing = choosingNow(view);
  box.replaceChildren(
    ...playerRows(view).map((row) => rowOf(view, row, tookOf(view, row.seat), choosing.includes(row.seat))),
  );
  if (focused !== undefined) box.querySelector<HTMLElement>(`[data-seat="${focused}"]`)?.focus({ preventScroll: true });
  if (HUD.open !== null) renderScout(view);
}

/** A player's board as it stood at the last lock: the far half of a table, back row at the top. */
function boardOf(cat: Catalog, seat: SeatView): HTMLElement {
  const grid = el("div", "scout-board", {});
  const at = new Map(seat.board.figures.map((p) => [seatCell(1, p.seat), p]));
  for (let row = 0; row < ROWS; row++) {
    const line = el("div", `hexrow${row % 2 === 1 ? " odd" : ""}`, {});
    for (let col = 0; col < COLS; col++) {
      const p = at.get(row * COLS + col);
      const hex = el("span", "hex", {});
      if (p) {
        const who = el(
          "span",
          "who",
          {},
          pic(starsPic(p.stars)),
          figPic(portrait(p.kind)),
          el("span", "held", {}, ...p.items.map((item) => pic(itemIcon(item)))),
        );
        link(who, `figure:${p.kind}/${p.stars}`);
        const holds = p.items.length > 0 ? `, holding ${p.items.map((item) => itemName(cat, item)).join(", ")}` : "";
        who.setAttribute("aria-label", `${figureName(cat, p.kind)}, ${p.stars} stars${holds}`);
        hex.append(who);
      }
      line.append(hex);
    }
    grid.append(line);
  }
  return grid;
}

function renderScout(view: SittingView): void {
  const box = HUD.scout;
  const seat = HUD.open === null ? undefined : view.seats[HUD.open];
  if (!box) return;
  if (!seat || HUD.open === null) {
    box.hidden = true;
    return;
  }
  const mine = HUD.open === view.you;
  const title = mine ? "Your board" : `${seatName(seat)}'s board`;
  const out = seat.place === null ? `Health ${seat.resolve}` : `Out, ${placeText(seat.place)}`;
  box.hidden = false;
  box.setAttribute("aria-label", title);
  box.replaceChildren(
    el(
      "header",
      "k-row",
      {},
      el("h2", "k-gold k-grow", { text: title }),
      el(
        "button",
        "k-btn wood icon sm",
        { type: "button", "aria-label": "Close", onclick: () => closeScout(view) },
        icon("close"),
      ),
    ),
    el("p", "k-d", { text: `${out}. Level ${seat.level}. As it stood at the last fight.` }),
    seat.board.figures.length > 0
      ? boardOf(catalogOf(view), seat)
      : el("p", "k-d k-dim", { text: "Nobody on it yet." }),
  );
}

/** Opens a player's board, or puts it away when it is the one open. */
export function scoutSeat(view: SittingView, seat: number): void {
  HUD.open = HUD.open === seat ? null : seat;
  snd.tap();
  delete HUD.players?.dataset.key;
  renderPlayers(view);
  renderScout(view);
}
function closeScout(view: SittingView): void {
  const was = HUD.open;
  HUD.open = null;
  snd.close();
  delete HUD.players?.dataset.key;
  renderPlayers(view);
  renderScout(view);
  if (was !== null) HUD.players?.querySelector<HTMLElement>(`[data-seat="${was}"]`)?.focus({ preventScroll: true });
}
export function forgetScout(): void {
  HUD.open = null;
  if (HUD.scout) HUD.scout.hidden = true;
}

/** Marks the page as at a live table, and at which stage of it (`live.css` lays it out by that); null for away from it. */
export function markTable(stage: string | null): void {
  if (stage === null) delete document.body.dataset.live;
  else document.body.dataset.live = stage;
}
