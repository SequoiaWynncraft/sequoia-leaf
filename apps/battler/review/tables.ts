/**
 * A handle on `window.tables` for looking at a live table from outside, as `handle.ts` does for the
 * solo table: Leaf's clock is moved on to a deadline on the play server the tours run against
 * (`POST /test/play/sittings`, which the guild's own Leaf does not have), the member's seat is
 * planned by the raid's bot through the page's own commands, and a figure is taken from the ring.
 *
 * - `next()` moves Leaf's clock to the stage's deadline and reads the sitting; `to(stage, room?)`
 *   plays on (the bot planning, the first figure left taken) until the sitting is there;
 * - `plan()` has the bot plan the member's room; `pick(i?)` takes from the ring;
 * - `scout(seat)` opens a player's board; `state()` says where things stand; `settled()` waits for Leaf.
 */
import { ask as askLeaf } from "@sequoia-leaf/kit/net.ts";
import { newTable, planCommands, type RaidCommand, SENSIBLE, tableView } from "@sequoia-leaf/raid";

import { scoutSeat } from "../src/screen/live/hud.ts";
import { clockText, turnOf } from "../src/screen/live/reads.ts";
import { enterTable, liveLine, liveView, takeFromRing } from "../src/screen/live/seat.ts";
import { OWN } from "../src/screen/sides.ts";
import { ask, doNow, S } from "../src/screen/state.ts";

const BLANK = tableView(newTable({ seed: 1 }), { awards: [], now: 0 });
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Waits until the page's line has nothing waiting for Leaf. */
async function settled(): Promise<string> {
  // oxlint-disable-next-line no-await-in-loop -- waiting on Leaf, a moment at a time
  for (let i = 0; i < 200 && liveLine()?.waiting(); i++) await wait(25);
  return "settled";
}

/** Moves Leaf's clock on by `ms`, and reads the sitting again. */
async function later(ms: number): Promise<string> {
  await askLeaf("/test/play/sittings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage: ms > 0 ? [{ later: ms }] : [] }),
  });
  await liveLine()?.read();
  await settled();
  return state();
}

/** Moves Leaf's clock to the stage's deadline. */
async function next(): Promise<string> {
  const line = liveLine();
  const view = liveView();
  if (!line || !view || view.stage.at === "over" || view.stage.at === "open") return state();
  return later(Math.max(1, view.stage.until - line.now() + 20));
}

/** The bot plans the member's room through the page's commands, until it has nothing left to do. */
async function plan(rounds = 16): Promise<string> {
  const view = liveView();
  if (rounds === 0 || !view?.run || view.stage.at !== "plan" || view.run.stage.phase !== "plan") return state();
  const commands = planCommands({ ...BLANK, run: view.run }, SENSIBLE);
  if (commands.length === 0) return state();
  for (const c of commands) {
    // oxlint-disable-next-line no-await-in-loop -- in order, each after the one before
    await send(c);
  }
  return plan(rounds - 1);
}
async function send(c: RaidCommand): Promise<void> {
  if (doNow(c)) await settled();
  else await ask(c);
}

/** Takes a figure from the ring when it is the member's turn: the one at `i`, or the first left. */
async function pick(i?: number): Promise<string> {
  const view = liveView();
  if (!view || view.stage.at !== "carousel") return state();
  const at = i ?? view.stage.ring.findIndex((o) => o.by === null);
  await takeFromRing(at);
  return state();
}

type Where = "carousel" | "plan" | "fight" | "spar" | "out" | "over";
/** Whether the sitting is where a jump is for. */
function there(where: Where, room: number | undefined): boolean {
  const view = liveView();
  if (!view) return true;
  const mine = view.you === null ? null : view.seats[view.you];
  if (where === "over") return view.stage.at === "over";
  if (where === "out") return mine?.place != null;
  const roomOk = room === undefined || view.room === room;
  if (where === "spar") return view.stage.at === "plan" && view.kind === "spar" && roomOk;
  return view.stage.at === where && roomOk;
}

/** Plays on until the sitting is there: the bot plans (unless `plans` is false), the first figure left is taken, the clock moves to each deadline. */
async function to(where: Where, room?: number, plans = true, guard = 300): Promise<string> {
  for (let i = 0; i < guard && !there(where, room); i++) {
    const view = liveView();
    if (!view || view.stage.at === "over") break;
    // oxlint-disable-next-line no-await-in-loop -- one deadline after another
    if (view.stage.at === "plan" && plans) await plan();
    // oxlint-disable-next-line no-await-in-loop -- the member's turn at the ring, then the clock
    if (view.stage.at === "carousel" && turnOf(view, liveLine()?.now() ?? 0).at === "choosing") await pick();
    // oxlint-disable-next-line no-await-in-loop -- the clock moves once the member has done what they do
    if (!there(where, room)) await next();
  }
  return state();
}

/** In a carousel, moves Leaf's clock on a pair at a time until the member may choose. */
async function turn(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const view = liveView();
    if (!view || view.stage.at !== "carousel" || turnOf(view, liveLine()?.now() ?? 0).at !== "waiting") break;
    // oxlint-disable-next-line no-await-in-loop -- a pair after another
    await next();
  }
  return state();
}

/** Has the member's side of every fight be the second (`on`), or the first again: to look at a fight drawn from the away seat. */
function flip(on: boolean): string {
  OWN.side = on ? () => 1 : () => 0;
  return on ? "the second side is yours" : "the first side is yours";
}

function state(): string {
  const view = liveView();
  if (!view) return "no table";
  const mine = view.you === null ? null : view.seats[view.you];
  return JSON.stringify({
    stage: view.stage.at,
    room: view.room,
    kind: view.kind,
    clock: clockText(view, liveLine()?.now() ?? 0),
    you: view.you,
    health: mine?.resolve,
    place: mine?.place,
    faces: mine?.faces,
    screen: S.screen.at,
    live: document.body.dataset.live ?? null,
  });
}

export function openTablesHandle(): void {
  Object.assign(window, {
    tables: {
      next,
      later,
      turn,
      flip,
      to,
      plan,
      pick,
      settled,
      state,
      enter: () => {
        enterTable();
        return state();
      },
      /** Opens a player's board (by default the one the member faces, else the next seat), or puts it away. */
      scout: (seat?: number) => {
        const view = liveView();
        const mine = view?.you === null || !view ? null : view.seats[view.you];
        if (view) scoutSeat(view, seat ?? mine?.faces ?? ((view.you ?? 0) + 1) % 8);
        return state();
      },
    },
  });
}
