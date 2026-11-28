/**
 * What a live table adds round the table: the round tracker at the top (where the table is, its
 * rounds, the stage, its seconds and a bar draining to Leaf's deadline), the banner as a stage
 * begins, the players down the right side in seat order (on a phone a row of small health chips over
 * the board), each pressed to see their board on the table, and while it is shown the strip that
 * says whose it is. Everything is drawn from the sitting as Leaf shows it; the clock counts Leaf's
 * own deadline.
 *
 * Every part keeps its size whatever it says: rows are as many as the seats, a row out only dims,
 * and the numbers sit in places of their own width.
 */
import { type Description, register } from "@sequoia-leaf/kit/card.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";
import type { SeatView, SittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { glyph, roomIcon } from "../art/icons.ts";
import { BENCH_Y, BOARD_H, BOARD_W, GAP } from "../geometry.ts";
import { snd } from "../sounds.ts";
import { boardToPage } from "../stage.ts";
import { pic } from "../ui/cards.ts";
import { headOf } from "../ui/heads.ts";
import { forgetTrack, outcomeOf } from "../ui/rooms.ts";
import { drawTrack, type Slot } from "../ui/tracker.ts";
import { choosingNow, clockLine, placeText, type PlayerRow, playerRows, seatName, waitingLine } from "./reads.ts";
import { bannerOf, type Round, roundsOf, roundTitle, stageClock } from "./rounds.ts";

/** What the live table's parts ask of the seat: the sitting as the page has it, whose board is shown, and to show another's (null: the member's own). */
export interface HudAsks {
  view: () => SittingView | null;
  scouting: () => number | null;
  scout: (seat: number | null) => void;
}

/** The parts, built once. */
const HUD: {
  asks: HudAsks | null;
  scope: Scope | null;
  /** The clock's second line, between the board and the bench. */
  say: HTMLElement | null;
  players: HTMLElement | null;
  /** Whose board is shown, with the way back to the member's own. */
  scouting: HTMLElement | null;
  banner: HTMLElement | null;
  /** How long the banner stays up, by the page's clock, and how to take it down sooner. */
  bannerUntil: number;
  bannerOff: (() => void) | null;
  /** The stage the bar under the tracker drains for, the first time it was seen: by the page's clock then, and its deadline. */
  seen: { key: string; at: number; end: number } | null;
} = {
  asks: null,
  scope: null,
  say: null,
  players: null,
  scouting: null,
  banner: null,
  bannerUntil: 0,
  bannerOff: null,
  seen: null,
};

/** How long a banner is up. */
export const BANNER_MS = 900;

/** Builds the players' list, the line under the board, the scouting strip and the banner, hidden until the member is at a live table. */
export function buildHud(scope: Scope, asks: HudAsks): void {
  HUD.asks = asks;
  HUD.scope = scope;
  const players = el("nav", "k-panel", { id: "live-players", "aria-label": "Players" });
  const say = el("p", "k-tip", { id: "live-say", "aria-hidden": "true" });
  const scouting = el(
    "div",
    "k-plaque",
    { id: "live-scouting", hidden: true, role: "status" },
    el("span", "who"),
    el("button", "k-btn sm", { type: "button", onclick: () => asks.scout(null) }, "Back"),
  );
  const banner = el("div", "k-plaque", { id: "live-banner", hidden: true, "aria-live": "polite" }, el("b"), el("span"));
  document.body.append(players, say, scouting, banner);
  register("round", (id) => roundCard(Number(id)));
  HUD.say = say;
  HUD.players = players;
  HUD.scouting = scouting;
  HUD.banner = banner;
}

// ---------- the round tracker ----------

/** A round's picture: the ring, crossed swords, or the forest's figure that leads it (else the room's kind). */
function roundPic(round: Round): HTMLCanvasElement {
  if (round.kind === "carousel") return glyph("ring");
  if (round.kind === "spar") return glyph("swords");
  return round.lead ? headOf(round.lead) : roomIcon(round.kind);
}

/** A round's card: what it is called (`roundTitle`), its picture and its number. */
function roundCard(i: number): Description | null {
  const view = HUD.asks?.view();
  const round = view ? roundsOf(view).rounds[i] : undefined;
  return round ? { ...roundTitle(round), icon: roundPic(round) } : null;
}

/**
 * How far a round is from the one being played, as its slot's class beside its place (`r0`…):
 * played (`past`), being played (`now lit at0`), each of the next three (`at1` to `at3`), or further
 * (`later`). A narrow tracker shows the round being played and the next three; as the round moves
 * on, each place shows another.
 */
const aheadOf = (d: number): string => (d < 0 ? "past" : d === 0 ? "now lit at0" : d <= 3 ? `at${d}` : "later");

/** A round on the tracker: played (dim, with how it came out), being played (lit), or to come; the opponent's swords scout them. */
function slotOf(view: SittingView, round: Round, i: number, now: number): Slot {
  const outcome = view.run && round.room !== null && i < now ? outcomeOf(view.run, round.room) : "";
  const against = round.against;
  const slot: Slot = {
    pic: roundPic(round),
    cls: `${round.kind} r${i} ${aheadOf(i - now)}${outcome ? ` ${outcome}` : ""}`,
    label: `${round.name}${outcome ? `, ${outcome}` : ""}`,
    ref: `round:${i}`,
    stop: i === now,
  };
  return against === null ? slot : { ...slot, press: () => HUD.asks?.scout(against) };
}

/**
 * How much the bar under the tracker has left: the milliseconds to the deadline, of how many in all
 * (a stage of its kind at the most, or for a fight, or a stage longer than that, as long as it had
 * when the page first saw it).
 */
function drainOf(key: string, end: number, most: number | null, now: number): { left: number; full: number } {
  const seen = HUD.seen?.key === key ? HUD.seen : { key, at: now, end };
  HUD.seen = seen;
  return { left: Math.max(0, end - now), full: Math.max(most ?? 0, seen.end - seen.at) };
}

/** The round tracker, for the sitting as it stands (`now`, Leaf's clock): drawn into the table's own track. */
export function renderTracker(view: SittingView, now: number): void {
  const box = document.getElementById("track");
  if (!box) return;
  // The solo run's track is drawn again whole once the member is back at it.
  forgetTrack();
  const { where, rounds, now: at } = roundsOf(view);
  const outcomes = view.run ? view.run.record.map((r) => [r.room, r.result]) : [];
  const key = JSON.stringify([where, rounds.map((r) => [r.kind, r.name, r.lead, r.against]), at, outcomes]);
  const clock = stageClock(view, now);
  const [word, number] = where.startsWith("Round ") ? ["Round ", where.slice(6)] : ["", where];
  drawTrack(box, {
    where: [word, number],
    slots: rounds.map((round, i) => slotOf(view, round, i, at)),
    key,
    clock: clock && {
      label: clock.label,
      seconds: clock.seconds,
      // A carousel's bar fills again as each turn opens.
      ...drainOf(
        `${view.room}:${view.stage.at}:${view.stage.at === "carousel" ? view.stage.open : ""}`,
        clock.end,
        clock.most,
        now,
      ),
    },
  });
}

// ---------- the line under the board, and the banner ----------

/** The line between the board and the bench: the carousel's turn, whom planning waits for, or whom the member faces. */
export function renderSay(view: SittingView, now: number): void {
  const say = HUD.say;
  if (!say) return;
  const line = clockLine(view, now);
  if (say.textContent !== line) say.textContent = line;
  say.hidden = line === "";
  say.classList.toggle("waiting", waitingLine(view) !== "");
  // In the gap between the board and the bench, clear of the ring and of whoever waits across.
  const at = boardToPage(BOARD_W / 2, (BOARD_H + BENCH_Y) / 2);
  say.style.top = `${Math.round(at.y)}px`;
}

/** Whether the banner is up, by the page's clock: what else would be said over the board waits for it. */
export const bannerUp = (): boolean => HUD.bannerUntil > performance.now();

/** The banner as a stage begins: the round's number over what it is, over the middle of the board, a moment long, with a sound. */
export function showBanner(view: SittingView): void {
  const banner = HUD.banner;
  if (!banner || !HUD.scope) return;
  const [head, name] = bannerOf(view);
  const [headEl, nameEl] = [...banner.children];
  if (headEl) headEl.textContent = head;
  if (nameEl) nameEl.textContent = name;
  // Between the two halves of the table.
  const at = boardToPage(BOARD_W / 2, (BOARD_H - GAP) / 2);
  banner.style.top = `${Math.round(at.y)}px`;
  banner.hidden = false;
  HUD.bannerUntil = performance.now() + BANNER_MS;
  HUD.bannerOff?.();
  HUD.bannerOff = HUD.scope.after(BANNER_MS, hideBanner);
  snd.round();
}
/** Takes the banner down. */
export function hideBanner(): void {
  HUD.bannerOff?.();
  HUD.bannerOff = null;
  HUD.bannerUntil = 0;
  if (HUD.banner) HUD.banner.hidden = true;
}

// ---------- the players ----------

/** A seat's small picture: a regular's figure, or a member's initial on a plate. */
function face(seat: SeatView): HTMLElement {
  if (seat.who.is === "regular") return el("span", "face", {}, pic(headOf(seat.who.figure)));
  return el("span", "face member", { text: seatName(seat).charAt(0) });
}

/** A seat's name: a regular's with the town's mark, as regulars are named everywhere. */
const nameOf = (seat: SeatView, row: PlayerRow): HTMLElement =>
  el("b", seat.who.is === "regular" ? "name folk" : "name", { text: row.name });

/** One row of the players' list, which shows their board on the table (the member's own: back to it); on a phone, a chip. */
function rowOf(view: SittingView, row: PlayerRow, took: HTMLElement | null, choosing: boolean): HTMLElement {
  const seat = view.seats[row.seat];
  if (!seat) return el("span");
  const out = row.place !== null;
  const shown = HUD.asks?.scouting() === row.seat;
  const label = `${row.name}${row.you ? " (you)" : ""}, ${out && row.place !== null ? `out, ${placeText(row.place)}` : `health ${row.resolve}`}`;
  return el(
    "button",
    `player${row.you ? " lit" : ""}${out ? " out" : ""}${row.facing ? " facing" : ""}${shown ? " open" : ""}${choosing ? " choosing" : ""}`,
    {
      type: "button",
      "data-seat": row.seat,
      "aria-label": label,
      "aria-pressed": String(shown),
      onclick: () => HUD.asks?.scout(row.seat),
    },
    face(seat),
    nameOf(seat, row),
    el(
      "span",
      `k-bar hp ${row.you ? "leaf" : "coral"}`,
      {},
      el("i", "", { style: `--v:${Math.round(row.fill * 100)}%` }),
    ),
    el("b", "n", { text: out && row.place !== null ? placeText(row.place).split(" ")[0] : String(row.resolve) }),
    el("span", "eye", { "aria-hidden": "true" }, pic(glyph("eye"))),
    row.facing ? el("span", "vs", {}, pic(glyph("swords"))) : null,
    took,
  );
}

/** The figure a seat has taken in the carousel, small, beside its row. */
function tookOf(view: SittingView, seat: number): HTMLElement | null {
  if (view.stage.at !== "carousel") return null;
  const offer = view.stage.ring.find((o) => o.by === seat);
  return offer ? el("span", "took", {}, pic(headOf(offer.kind))) : null;
}

/** The players, in seat order: name, health as a bar and a number, out and in what place; the member's own lit, and the one whose board is shown marked. */
export function renderPlayers(view: SittingView): void {
  const box = HUD.players;
  if (!box) return;
  const scouting = HUD.asks?.scouting() ?? null;
  const key = JSON.stringify([view.seats.map((s) => [s.resolve, s.place, s.faces]), view.stage, scouting, view.you]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.seat : undefined;
  const choosing = choosingNow(view);
  box.replaceChildren(
    ...playerRows(view).map((row) => rowOf(view, row, tookOf(view, row.seat), choosing.includes(row.seat))),
  );
  if (focused !== undefined) box.querySelector<HTMLElement>(`[data-seat="${focused}"]`)?.focus({ preventScroll: true });
  renderScouting(view, scouting);
}

/** The strip under the tracker while another's board is shown: whose it is, and Back. */
function renderScouting(view: SittingView, seat: number | null): void {
  const strip = HUD.scouting;
  if (!strip) return;
  const them = seat === null ? undefined : view.seats[seat];
  strip.hidden = !them;
  const who = strip.querySelector(".who");
  const text = them ? `Scouting ${seatName(them)}` : "";
  if (who && who.textContent !== text) who.textContent = text;
}

/** Marks the page as at a live table, and at which stage of it (`live.css` lays it out by that); null for away from it. */
export function markTable(stage: string | null): void {
  if (stage === null) delete document.body.dataset.live;
  else document.body.dataset.live = stage;
}
