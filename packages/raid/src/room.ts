/**
 * The room a run is in, as one value (`Room`): what kind of room it is, the rules in force there and
 * what they set in its fight (`content/rules.ts`), how strong the forest is, how many figures may be
 * fielded, and the picks it leaves. `roomOf` is the only reader of the run's wing (`wing.ts` says
 * which rooms a wing is) and of what its course's row does with a room (`content/ways.ts`): the
 * fight's setup, who waits there (`foe.ts`), formation, the bot, the room's card and the takings all
 * read the room.
 */
import { ECONOMY, type RoomKind } from "./content/rooms.ts";
import { apart, bind, type FightRules, PLAIN_RULES, ROOM_RULES, ruled, shut } from "./content/rules.ts";
import type { RuleId } from "./content/wilds.ts";
import { extraChairs } from "./endless.ts";
import type { FightSetup } from "./fight/types.ts";
import { foughtAt } from "./record.ts";
import type { RunView } from "./run.ts";
import { courseOf } from "./way.ts";
import { wingOf } from "./wing.ts";

export interface Room {
  /** Its place, counting from 0. */
  readonly at: number;
  readonly kind: RoomKind;
  /** What its fight reads. */
  readonly rules: FightRules;
  /** The Wilds' rules in force, for the room's card and what the page draws of them. */
  readonly named: readonly RuleId[];
  /** How strong the forest is in it, in percent. */
  readonly might: number;
  /** How many figures may be fielded in it. */
  readonly chairs: number;
  /** The picks of components it leaves when it is won and when it is not, and whether a boon is offered after it. */
  readonly picks: { readonly won: number; readonly lost: number; readonly boon: boolean };
}

/** What `roomOf` reads of a run. */
export type RoomRun = Pick<RunView, "room" | "wing" | "way" | "level" | "boons" | "record" | "before" | "era">;

/** The picks of components each kind of room leaves: a boss two when it is won, sparring none. */
const COMPONENT_PICKS: Readonly<Record<RoomKind, { readonly won: number; readonly lost: number }>> = {
  trouble: { won: 1, lost: 1 },
  boss: { won: 2, lost: 1 },
  spar: { won: 0, lost: 0 },
};

/** The rules in force at a place of a run: its wing's rule, while the place is in that wing, as the rule set it from what it drew. */
function inForce(run: Pick<RoomRun, "wing">, at: number): { named: RuleId[]; rules: FightRules } {
  const { wing } = run;
  const named = wing && wing.at === wingOf(at) ? [wing.rule] : [];
  const [first, ...rest] = named.map((id) => ruled(ROOM_RULES[id].sets(wing?.stumps ?? [])));
  return { named, rules: first ? rest.reduce(bind, first) : PLAIN_RULES };
}

/**
 * The room at a place of a run (by default the one it is in), as the run would find it there now:
 * the wing's rule only while the place is in its wing, the forest grown as the course grows it, the
 * chairs the run has, and a boon after it only if it has not been fought yet.
 */
export function roomOf(run: RoomRun, at = run.room): Room {
  const course = courseOf(run.way);
  // Every place from the first is a room of the course; one before it is fought nowhere, and leaves nothing.
  const kind = course.rooms(at)?.kind ?? "spar";
  return {
    at,
    kind,
    ...inForce(run, at),
    might: course.grows(at),
    chairs: run.level + extraChairs(run),
    picks: {
      ...COMPONENT_PICKS[kind],
      boon: ECONOMY.boonRooms.some((r) => r === at) && !foughtAt(run, at),
    },
  };
}

/** The seats nobody may sit on in the room a run is in, while it plans: those its rules close, and those closed only for sitting down. */
export const closedNow = (run: RoomRun): ReadonlySet<number> => shut(roomOf(run).rules);

/** What a fight set up in a room keeps of it: what binds it apart from plain, and the rules named; nothing under none. */
export function setupRules(room: Pick<Room, "rules" | "named">): Pick<FightSetup, "rules" | "named"> {
  const rules = apart(room.rules);
  return {
    ...(Object.keys(rules).length > 0 && { rules }),
    ...(room.named.length > 0 && { named: room.named.slice() }),
  };
}
