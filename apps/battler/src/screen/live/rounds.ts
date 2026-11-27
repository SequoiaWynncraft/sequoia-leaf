/**
 * A live table's schedule, as its tracker and its banners say it. Its stages are the forest's wings:
 * each opens with a carousel and ends with a boss, so a round is numbered by its stage ("2-4": the
 * second wing's fourth round, its carousel the first). Past the fifteenth room there are no stages,
 * only sparring, and a round goes by its count from the start ("Round 19"). Nothing here reads a
 * clock or draws: `now` is Leaf's, given.
 */
import type { UnitKind } from "@sequoia-leaf/raid";
import { type Plan, type RoomKind, ROOMS } from "@sequoia-leaf/raid/content/rooms.ts";
import { CAROUSELS, CLOCK, planMs } from "@sequoia-leaf/raid/sitting/sitting.ts";
import type { SittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { clockOf, seatName } from "./reads.ts";

/** One round of the schedule: a carousel, or a room of the forest's kinds; what it is called; and who stands in it, where that is known. */
export interface Round {
  kind: "carousel" | RoomKind;
  /** Its number: "2-4", or past the stages "Round 19". */
  at: string;
  /** The room, for a room's round. */
  room: number | null;
  /** What it is called, plainly: "Carousel", "Fight: Quillon", "Forest: A few gnats". */
  name: string;
  /** The forest's figure that leads it, for its picture, where that is known. */
  lead: UnitKind | null;
  /** The seat the member fights in it, for a fight in the round being played. */
  against: number | null;
}

/** Where a table is in its schedule: its number ("2-4", "Round 19"), the rounds the tracker shows, and which of them is being played. */
export interface Rounds {
  where: string;
  rounds: Round[];
  now: number;
}

/** How many rounds the tracker shows where there are no stages: the one being played and the next six. */
export const AHEAD = 7;

/** The stage (wing) a room is in; none past the fifteenth room. */
const wingOf = (room: number): number | null => ROOMS[room]?.wing ?? null;
/** The rooms of a stage, in order. */
const roomsOfWing = (wing: number): number[] => ROOMS.flatMap((r, i) => (r.wing === wing ? [i] : []));

/** A sparring round: whom the member fights, in the round being played. The odd one out fights a copy of a board whose owner fights somebody else. */
function sparRound(view: SittingView, room: number, at: string, playing: boolean): Round {
  const you = view.you === null ? null : view.seats[view.you];
  const faces = playing ? (you?.faces ?? null) : null;
  const them = faces === null ? null : view.seats[faces];
  const name = them ? `Fight: ${them.faces === view.you ? "" : "copy of "}${seatName(them)}` : "Fight";
  return { kind: "spar", at, room, name, lead: null, against: them ? faces : null };
}

/** What a forest room is called, and the figure that leads it, from its plans: one plan's name; the lead every plan shares. */
function fromPlans(plans: readonly Plan[]): { title: string; lead: UnitKind | null } {
  const leads = new Set(plans.map((p) => p.party[0]?.[0] ?? null));
  const [only] = plans;
  const [lead = null] = leads.size === 1 ? leads : [];
  return { title: plans.length === 1 && only ? only.name : "", lead };
}

/** A room's round: its kind, and its name and figure where they are known (the room being played, or a room of one plan). */
function roomRound(view: SittingView, room: number, at: string, playing: boolean): Round {
  const spec = ROOMS[room];
  if (!spec || spec.kind === "spar") return sparRound(view, room, at, playing);
  // The forest's party in the room being played says its name, and who leads it; any other room what its plans say.
  const foe = playing && view.run?.room === room ? view.run.foe : null;
  const known = foe ? { title: foe.title, lead: foe.figures[0]?.kind ?? null } : fromPlans(spec.plans);
  const word = spec.kind === "boss" ? "Boss" : "Forest";
  const name = known.title ? `${word}: ${known.title}` : word;
  return { kind: spec.kind, at, room, name, lead: known.lead, against: null };
}

/**
 * The rounds the tracker shows for a table as Leaf shows it: in a stage, its carousel and its rooms,
 * the one being played marked; past the stages, the next `AHEAD` rounds of sparring.
 */
export function roundsOf(view: SittingView): Rounds {
  const { room } = view;
  const carousel = view.stage.at === "carousel";
  const wing = wingOf(room);
  if (wing === null) {
    // Every stage's rooms and carousels are behind it.
    const first = room + CAROUSELS.length + 1;
    const rounds = Array.from({ length: AHEAD }, (_, k) => roomRound(view, room + k, `Round ${first + k}`, k === 0));
    return { where: `Round ${first}`, rounds, now: 0 };
  }
  const rooms = roomsOfWing(wing);
  const opening: Round = { kind: "carousel", at: `${wing}-1`, room: null, name: "Carousel", lead: null, against: null };
  const rounds = [opening, ...rooms.map((r, i) => roomRound(view, r, `${wing}-${i + 2}`, !carousel && r === room))];
  const now = carousel ? 0 : rooms.indexOf(room) + 1;
  return { where: `${wing}-${now + 1}`, rounds, now };
}

/** A round's banner as a stage begins: its number, then what it is ("Round 2-4", "Fight: Quillon"). */
export function bannerOf(view: SittingView): [string, string] {
  const { where, rounds, now } = roundsOf(view);
  return [where.startsWith("Round") ? where : `Round ${where}`, rounds[now]?.name ?? ""];
}

/** The time a stage has, for the tracker: its name, the seconds left, its deadline, and how long a stage of its kind lasts at the most (none for a fight: each is as long as it is). */
export interface StageClock {
  label: string;
  seconds: number | null;
  end: number;
  most: number | null;
}

/**
 * A live table's stage as the tracker counts it, by Leaf's clock (`now`): planning and a fight to
 * their deadlines; a carousel to the end of the turn being taken (a turn ends as soon as everyone in
 * it has taken). None before the start or after the end.
 */
export function stageClock(view: SittingView, now: number): StageClock | null {
  const { stage } = view;
  if (stage.at === "open" || stage.at === "over") return null;
  const { label, seconds } = clockOf(view, now);
  if (stage.at === "plan") return { label, seconds, end: stage.until, most: planMs(view.room) };
  if (stage.at === "fight") return { label, seconds, end: stage.until, most: null };
  // The first carousel lets the members in together, then everyone; a later one two at a time, the last turn longer.
  const last = stage.open >= stage.turns.length;
  const most = view.room === 0 && !last ? CLOCK.together : last ? CLOCK.last : CLOCK.pair;
  return { label, seconds, end: stage.ends, most };
}

/** Whether a stage began between two views of a table: a new stage, or the same in another room. */
export const stageBegan = (view: SittingView, was: SittingView): boolean =>
  view.stage.at !== "open" && view.stage.at !== "over" && (view.stage.at !== was.stage.at || view.room !== was.room);
