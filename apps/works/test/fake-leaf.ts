/**
 * A stand-in Leaf for the page's tests: it keeps the yard with the real rules, as the play service
 * does, answers a batch as it does, and the page opens its yard from it over the kit's stand-in
 * network (`net.world`). A test file calls `useFakeLeaf()` once to have the page's clock held and
 * everything let go after each test.
 */
import { afterEach, beforeEach, expect } from "bun:test";

import {
  type Act,
  at,
  BELT,
  FACTORY as WORKS,
  isKind,
  kindName,
  NONE,
  readCommand,
  refusal,
  type Yard,
} from "@sequoia-leaf/factory";
import { forgetLedger, fromLeaf } from "@sequoia-leaf/kit/purse.ts";
import { type Reply, type Sent, type Standin, standin } from "@sequoia-leaf/kit/standin.ts";

import { S } from "../src/state.ts";
import { letGo, openYard } from "../src/yard.ts";

/** What Leaf tells the game about each call. */
export type Ctx = Parameters<typeof WORKS.apply>[2];

/** A command as the wire names it, read as the rules read it: what a script, or the member, does. */
export function act(c: Record<string, unknown>): Act {
  const read = readCommand({ tick: 0, ...c });
  if (!read) throw new Error(`${JSON.stringify(c)} does not read`);
  return read;
}
/** The name of the kind of piece on a tile of a yard, if one stands there. */
export const kindOn = (y: Yard, p: { x: number; y: number }): string | undefined => {
  const k = y.kind[at(y, p.x, p.y)] ?? NONE;
  return isKind(k) ? kindName(k) : undefined;
};
/** The name of the kind of piece on a tile of the page's copy. */
export const kindAt = (p: { x: number; y: number }): string | undefined => kindOn(S.world, p);

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const ctx = (): Ctx => ({
  now: 1_800_000_000_000,
  player: { id: "p", guest: false },
  seed: 7,
  room: 1e9,
  awards: [],
});

/**
 * A stand-in Leaf that keeps the yard with the real rules, as the play service does, and answers a
 * batch as it does: short. It answers `answers` batches, and finds no network after that until it
 * is given more; it keeps the address of every read of the yard (`reads`), every command it is sent
 * (`commands`), and what came in what order (`calls`); and its clock stands `ms` past the tests' own.
 */
export function fakeLeaf(yard: Yard = WORKS.create(ctx())) {
  const leaf = {
    yard,
    /** The member's Coins, as Leaf's ledger of them has them, and the version of its last word on them. */
    coins: 0,
    version: 0,
    posts: 0,
    answers: Infinity,
    reads: [] as string[],
    commands: [] as unknown[],
    calls: [] as string[],
    ms: 0,
  };
  const now = (): Ctx => ({ ...ctx(), now: ctx().now + leaf.ms });
  /** Leaf's word on the purse, as each answer carries it. */
  const purse = () => ({ coins: Math.max(0, leaf.coins), leaf: 0, version: ++leaf.version });
  const shown = (): unknown => WORKS.view(leaf.yard, now());
  /** Does a command (as the wire names it) as Leaf would, from another page of the member's. */
  const elsewhere = (c: Record<string, unknown>): void => {
    const done = WORKS.apply(leaf.yard, { ...act(c), tick: leaf.yard.tick }, ctx());
    if ("refused" in done) throw new Error(done.refused);
  };
  const post = (sent: Sent): Reply => {
    if (leaf.posts >= leaf.answers) return "offline";
    leaf.posts += 1;
    leaf.calls.push("batch");
    const commands = isRecord(sent.body) && Array.isArray(sent.body.commands) ? sent.body.commands : [];
    leaf.commands.push(...commands);
    const results = commands.map((c: unknown) => {
      const id = isRecord(c) && typeof c.id === "string" ? c.id : "";
      const command = WORKS.command(c);
      const done = command ? WORKS.apply(leaf.yard, command, now()) : { refused: "invalid" };
      if ("refused" in done) return { id, refused: done.refused };
      for (const change of done.coins ?? []) leaf.coins += change.amount;
      return { id, notes: done.notes };
    });
    const state = WORKS.answer?.(leaf.yard, now());
    return { status: 200, body: { rev: leaf.posts, now: "x", results, state, purse: purse() } };
  };
  const routes = {
    "GET /v1/game/play/works": (sent: Sent): Reply => {
      leaf.reads.push(sent.path);
      leaf.calls.push("read");
      return { status: 200, body: { rev: 0, now: "x", state: shown(), purse: purse() } };
    },
    "POST /v1/game/play/works": post,
  };
  return { leaf, routes, elsewhere, purse };
}
export type FakeLeaf = ReturnType<typeof fakeLeaf>;

/** The kit's stand-in network the page is on, while a test has one. */
export const net: { world: Standin | null } = { world: null };
/** The stand-in Leaf the page opened, while a test has one. */
let current: FakeLeaf | null = null;

/** The member's Coins on the stand-in Leaf are now `coins`, and the page is told so with Leaf's word. */
export function coinsAre(coins: number): void {
  if (!current) throw new Error("no stand-in Leaf is open");
  current.leaf.coins = coins;
  fromLeaf(current.purse());
}

/** Holds the page's clock still for each test, so the yard runs on only when a test says, and lets everything go after it. */
export function useFakeLeaf(): void {
  const clock = performance.now.bind(performance);
  beforeEach(() => {
    performance.now = () => 1000;
  });
  afterEach(() => {
    net.world?.done();
    net.world = null;
    current = null;
    forgetLedger();
    letGo();
    performance.now = clock;
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
  });
}

/** Waits until a condition holds, a millisecond at a time. */
export async function until(ok: () => boolean, tries = 1500): Promise<void> {
  if (ok() || tries === 0) return;
  await Bun.sleep(1);
  await until(ok, tries - 1);
}

/** The first tiles a belt could stand on. */
export function clear(n: number): { x: number; y: number }[] {
  const w = S.world;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < w.kind.length && out.length < n; i++) {
    const x = i % w.land.w;
    const y = Math.floor(i / w.land.w);
    if (w.kind[i] === NONE && refusal(w, BELT, x, y, Infinity) === null) out.push({ x, y });
  }
  return out;
}

/**
 * The page opens `yard` (a new one, if none is given) from a stand-in Leaf, with `coins` in the
 * member's purse. A window is there for what lands a moment later (dust, a clack), which it lets be.
 */
export async function opened(yard?: Yard, coins = 0): Promise<FakeLeaf> {
  const fake = fakeLeaf(yard);
  fake.leaf.coins = coins;
  current = fake;
  net.world = standin(fake.routes);
  expect(await openYard("p", () => undefined)).toBeNull();
  if (!("window" in globalThis))
    Object.defineProperty(globalThis, "window", { value: { setTimeout: () => 0 }, configurable: true });
  return fake;
}
