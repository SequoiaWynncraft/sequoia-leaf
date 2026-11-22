/**
 * The yard's life on the page: finding it where it was left, running it by the clock, keeping it,
 * and passing Coins between it and the member's purse. The rules hold no purse: whatever the yard
 * earns is paid into the kit's, and everything that costs is taken from it, so the town and the
 * yard always show the one number.
 */

import { keepText, keptText } from "@sequoia-leaf/kit/keep.ts";
import { balance, type CoinReason, coinsOnLeaf, earn, pretendPurse, spend } from "@sequoia-leaf/kit/purse.ts";

import {
  type Away,
  collect,
  create,
  drain,
  load,
  type News,
  oldCoins,
  type Refund,
  runTo,
  save,
  type Spent,
  type World,
} from "./sim/index.ts";
import { hooks, S, touched } from "./state.ts";
import { ZOOM } from "./zoom.ts";

const KEY = "works.save.v2";
const OLD = "works.save.v1";
const GREYBOX_PURSE = "works.coins.v2";
const SCREEN = "works.screen.v1";

// All through the kit's `keepText`: a page that has let go of the browser's game (`stopped()`)
// writes none of it. What is not kept still holds for this visit.
const read = keptText;
const write = (key: string, text: string): void => void keepText(key, text);
const drop = (key: string): void => void keepText(key, null);

/** Starts the yard over: it and what the screen remembered are forgotten. */
export function forgetYard(): void {
  drop(KEY);
  drop(SCREEN);
}

/** What the screen itself remembers between visits, beside the yard: nudges already taken, and the zoom. */
export interface Screen {
  taught: string[];
  zoom: number;
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export const screen: Screen = { taught: [], zoom: 0 };

/** What the screen remembered, from its text; whatever makes no sense is as a new member has it. */
export function parseScreen(text: string | null): Screen {
  const out: Screen = { taught: [], zoom: 0 };
  try {
    const raw: unknown = JSON.parse(text ?? "null");
    if (!isRecord(raw)) return out;
    if (Array.isArray(raw.taught))
      out.taught = raw.taught.filter((v): v is string => typeof v === "string").slice(0, 60);
    // As far in or out as the camera goes, and no further.
    if (typeof raw.zoom === "number" && raw.zoom >= -ZOOM.out && raw.zoom <= ZOOM.in) out.zoom = Math.round(raw.zoom);
  } catch {
    // Nonsense in it: start with nothing remembered.
  }
  return out;
}

function readScreen(): void {
  Object.assign(screen, parseScreen(read(SCREEN)));
}

/** The Coins in the member's purse. */
export const coins = (): number => balance().coins;

/** Takes what something cost from the purse, for the reason it cost. Says whether the thing was done at all. */
export function pay(did: Spent, reason: CoinReason): boolean {
  if (!did.ok) return false;
  if (did.cost > 0) spend("coins", did.cost, reason);
  return true;
}

/** Pays back what taking something away returned. */
export function repay(did: Refund): boolean {
  if (!did.ok) return false;
  if (did.refund > 0) earn(did.refund, "works_refund");
  return true;
}

/** What the orders had paid into the till when it was last paid out: what has come in since is theirs, the rest the depot's. */
let ordersBanked = 0;

/** While true, what the yard earns stays in its till: the letter about an absence pays it out when it is put away. */
let holding = false;
export function holdTill(on: boolean): void {
  holding = on;
}

/**
 * Pays whatever is in the till into the purse, and says how much that was: what the orders paid in
 * since it was last paid out as theirs, and the rest as the depot's.
 */
export function bank(): number {
  const got = collect(S.world);
  if (got <= 0) return got;
  const orders = Math.min(got, Math.max(0, Math.floor(S.world.paid - ordersBanked)));
  ordersBanked += orders;
  if (orders > 0) earn(orders, "works_order");
  if (got > orders) earn(got - orders, "works_depot");
  return got;
}

/**
 * Finds the yard as it was left, or starts one, and brings it up to the clock. Gives back what it
 * did if the member has been away.
 */
export function openYard(): Away | null {
  readScreen();
  const world = load(read(KEY)) ?? create({ seed: Math.floor(Math.random() * 0xffffffff) });
  // The yard before this one kept Coins of its own: with the made-up guild they come over to the
  // purse, once. On the guild's server Coins are Leaf's, and nothing the browser kept becomes Coins.
  const carried = oldCoins(read(OLD));
  if (carried !== null) {
    if (!coinsOnLeaf()) pretendPurse(balance().coins + carried);
    drop(OLD);
  }
  drop(GREYBOX_PURSE);
  // Only what the orders pay from here on is theirs; anything already in the till is the depot's.
  ordersBanked = world.paid;
  S.world = world;
  S.rev++;
  const away = runTo(world, Date.now());
  // A yard opened for the first time has been nowhere: there is nothing to say about that.
  return away && away.seconds >= 60 ? away : null;
}

/** Puts another yard in this one's place: for looking at the game at some stage of its story. */
export function swapYard(world: World): void {
  S.world = world;
  ordersBanked = world.paid;
  S.picked = -1;
  S.aim = null;
  S.run = null;
  S.from = null;
  S.clearing.clear();
  world.seen = Date.now();
  touched();
}

let keptAt = 0;
let dirty = false;

export function keep(): void {
  write(KEY, save(S.world));
  write(SCREEN, JSON.stringify(screen));
  keptAt = performance.now();
  dirty = false;
}

/**
 * A moment of the clock: the yard is run up to now, its earnings are banked, and its news is
 * handed back for the screen to make something of. A long gap (the tab was put away) comes back as
 * an absence.
 */
export function tick(now: number): { away: Away | null; news: News[] } {
  const away = runTo(S.world, now);
  // What was earned over an absence stays in the till for the letter to pay out.
  if (!holding && !away) bank();
  const news = drain(S.world);
  // It saves itself soon after every change, and every few seconds besides.
  const since = performance.now() - keptAt;
  if ((dirty && since > 400) || since > 4000) keep();
  return { away, news };
}

hooks.changed = (): void => {
  dirty = true;
};
