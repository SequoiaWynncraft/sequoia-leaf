/**
 * The endless runs as tables (`endless.ts` plays them): the rooms that come round after the
 * fifteenth, how much the forest grows in them, the chairs a beaten boss adds, and how strong a
 * regular is down there. Tuning the endless runs is editing this file.
 */
import { ROOMS, type RoomSpec } from "./rooms.ts";

/**
 * The two ways into the endless slot. In the Wilds every sparring room is a regular's. In the Deep
 * Woods a sparring room from `ENDLESS.heldFrom` on is held by the member who won it last this week,
 * and a regular's only while nobody holds it.
 */
export const ENDLESS_WAYS = ["wilds", "deep"] as const;
export type EndlessWay = (typeof ENDLESS_WAYS)[number];
export const isEndlessWay = (v: unknown): v is EndlessWay => ENDLESS_WAYS.some((way) => way === v);

export const ENDLESS = {
  /** The forest's health and attack after room 15: this much more for every room past it, in percent, compounding. */
  grows: 5,
  /** After room 15, every boss beaten is a chair: one more figure may be fielded. This many at most. */
  chairs: 3,
  /**
   * The first room of the Deep Woods whose sparring rooms are held, counting from 0: the sixteenth.
   * Held from the third, the early rooms fill with the luckiest boards of the week and runs end by
   * the ninth (`review/endless.ts`).
   */
  heldFrom: 15,
  /**
   * A regular after room 15: what it has spent on figures and how many components it holds in room
   * 16, and how much more of each for every room past it. It fields as many as a member could:
   * the top level, and a chair for every boss on the way.
   */
  spar: { spent: 35, spentGrows: 10, components: 4, componentsEvery: 1 },
} as const;

/** The rooms after the fifteenth, in the order they come round, for ever. */
export const CYCLE: readonly RoomSpec[] = ROOMS;
