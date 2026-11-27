/**
 * Every kind of piece, in kind order: a kind's number is its place here, kept in every save and on
 * the wire as that number, so a new kind goes at the end and none moves. Each is its own module; this
 * is the one list of them, and the one place a kind is made whole (`RULES`): what its module leaves
 * out of how it plays, it does not do.
 */
import { assembler } from "./assembler.ts";
import { belt } from "./belt.ts";
import { bench } from "./bench.ts";
import { boiler } from "./boiler.ts";
import { breaker } from "./breaker.ts";
import { crate } from "./crate.ts";
import { depot } from "./depot.ts";
import { gatherer } from "./gatherer.ts";
import { joiner } from "./joiner.ts";
import { gradeKept, tintKept } from "./kept.ts";
import type { Hooks, KindDef } from "./kind.ts";
import { mill } from "./mill.ts";
import { pylon } from "./pylon.ts";
import { sorter } from "./sorter.ts";
import { splitter } from "./splitter.ts";
import { stop } from "./stop.ts";
import { study } from "./study.ts";
import { tunnel } from "./tunnel.ts";
import { wheel } from "./wheel.ts";
import { workshop } from "./workshop.ts";

export const KIND_DEFS = [
  belt,
  gatherer,
  mill,
  bench,
  workshop,
  splitter,
  joiner,
  tunnel,
  crate,
  pylon,
  wheel,
  boiler,
  depot,
  study,
  stop,
  sorter,
  assembler,
  breaker,
] as const satisfies readonly KindDef[];
export type KindName = (typeof KIND_DEFS)[number]["name"];

/** A hook a kind may leave out, whose absence is read: a piece with none of these does none of them. */
type Absent = "hands" | "work" | "steady";
/** How a kind plays, with every hook there: what it leaves out made what it does when it does not. */
export type KindRules = Required<Omit<Hooks, Absent>> & { readonly [K in Absent]: NonNullable<Hooks[K]> | null };

const none = (): number => 0;
const nowhere = (): number => -1;
const never = (): boolean => false;
const nothing = (): null => null;
const still = (): void => undefined;
/** What a kind keeps that says nothing of it: its colour if it has one, and its grade if it has one. */
const plain: KindRules["keeps"] = (k, kind, v) => ({
  ...(k.TINTED[kind] === 1 ? tintKept(k, v) : {}),
  ...(k.GRADED[kind] === 1 ? gradeKept(k, v) : {}),
});

/** What a kind does where its module says nothing: nothing. */
const LEFT_OUT: KindRules = {
  sides: none,
  next: nowhere,
  closed: none,
  sends: () => 7,
  wants: never,
  room: never,
  give: still,
  turns: never,
  hands: null,
  ready: never,
  work: null,
  steady: null,
  refusal: nothing,
  over: nothing,
  lays: () => [],
  laid: still,
  asLaid: (_k, p) => p,
  set: {},
  condition: none,
  words: () => ({ line: "" }),
  aim: nothing,
  last: nothing,
  flow: still,
  most: none,
  onto: still,
  keeps: plain,
  waysTo: (_k, y, i) => void (y.shut[i] = 0),
  locks: nothing,
};

/** A kind's hooks, each it leaves out filled in with doing nothing, every kind's in the same order. */
const rulesOf = (h: Hooks): KindRules => ({ ...LEFT_OUT, ...h });

/** Each kind's rules, by its number. */
export const RULES: readonly KindRules[] = KIND_DEFS.map((d) => rulesOf(d.rules));
/** 1 for each kind that may let things in by turns (`Hooks.turns`), asked of the piece only then: the tick asks it at every refusal. */
export const TAKES_TURNS = Uint8Array.from(RULES, (r) => (r.turns === never ? 0 : 1));
