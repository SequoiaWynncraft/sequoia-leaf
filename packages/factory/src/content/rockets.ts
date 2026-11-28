/**
 * What a launch pad launches (tier 8, `ROCKETS`): each rocket's hull sections, rocket fuel and load,
 * the charged cells it must hold all at once, the thing a launch of it counts as reaching the depot,
 * and the kinds of launch it counts toward (`LAUNCH_KINDS`). A new pad is set to the first. The test
 * rocket and the rocket come with the pad (`withPad`); the four after them come with endless research
 * (SPEC-2 section 6), which a later tier builds, and are here for what they count as and take.
 *
 * The yard keeps, for each kind of launch, its launches ever and its launches spent, and a level of
 * each track of endless research (`TRACK_IDS`): fifteen numbers (`launches.ts`).
 */
import type { ItemName, Wants } from "./items.ts";

/** The kinds of launch a yard counts: every rocket's but the test rocket's counts as `any`, and one with a load or heavy as its own too. */
export const LAUNCH_KINDS = ["any", "wire", "road", "dish", "heavy"] as const;
export type LaunchKind = (typeof LAUNCH_KINDS)[number];

/** The tracks of endless research, each a level the yard keeps: what a level costs and gives comes with them. */
export const TRACK_IDS = ["sidings", "flywheel", "nights", "crates", "roots"] as const;

/** A launch pad takes no charged cell while it holds this many plain cells: those that lost their last bar in it. */
export const CLOGGED = 1000;
/** A launch pad lets a plain cell out by its front once in so many ticks: 300 a minute at most. */
export const LETS_OUT_EVERY = 2;

export interface RocketInfo {
  readonly id: string;
  /** Its name on the pad's card. */
  readonly name: string;
  /** What it takes beside its charged cells, each held up to so many: hull sections, rocket fuel and any load. */
  readonly parts: Wants;
  /** The charged cells it must hold at once. */
  readonly cells: number;
  /** What a launch of it counts as reaching the depot. */
  readonly counts: ItemName;
  readonly kinds: readonly LaunchKind[];
  /** Whether it comes with the pad; one that does not may not be chosen yet. */
  readonly withPad: boolean;
}

export const ROCKETS: readonly RocketInfo[] = [
  {
    id: "test",
    name: "Test rocket",
    parts: { hull: 60, fuel: 240 },
    cells: 100,
    counts: "testrocket",
    kinds: [],
    withPad: true,
  },
  {
    id: "plain",
    name: "Rocket",
    parts: { hull: 900, fuel: 3600 },
    cells: 1000,
    counts: "rocket",
    kinds: ["any"],
    withPad: true,
  },
  {
    id: "wire",
    name: "Rocket with a telegraph line",
    parts: { hull: 900, fuel: 3600, telegraph: 600, lights: 600 },
    cells: 1000,
    counts: "rocket",
    kinds: ["any", "wire"],
    withPad: false,
  },
  {
    id: "road",
    name: "Rocket with a road",
    parts: { hull: 900, fuel: 3600, tarmac: 1500, sleeper: 1500, varnish: 1500 },
    cells: 1000,
    counts: "rocket",
    kinds: ["any", "road"],
    withPad: false,
  },
  {
    id: "dish",
    name: "Rocket with a dish",
    parts: { hull: 900, fuel: 3600, dish: 300, lattice: 1500 },
    cells: 1000,
    counts: "rocket",
    kinds: ["any", "dish"],
    withPad: false,
  },
  {
    id: "heavy",
    name: "Heavy rocket",
    parts: { hull: 2000, fuel: 8000 },
    cells: 2500,
    counts: "heavyrocket",
    kinds: ["any", "heavy"],
    withPad: false,
  },
];
