/**
 * The Wilds' rules in words, for the page (`@sequoia-leaf/raid`'s `wing.ts`): a rule as one line, the
 * wing a room is in and the boss it ends with, the pick's title, the line said when figures move off
 * hexes that closed, and what the card that picks a run back up says. `rulecards.ts` puts them on
 * the table.
 */
import {
  type BossId,
  catalogOf,
  type FightResult,
  figureIn,
  isBossId,
  type Party,
  picksOf,
  pieces,
  type RaidNote,
  ROOM_RULES,
  roomAt,
  roomOf,
  type RoomRun,
  type RuleId,
  type RunView,
  WILDS,
  wingEnd,
  wingOf,
} from "@sequoia-leaf/raid";
import { nowCalled, regularOf } from "@sequoia-leaf/raid/content/rooms.ts";

/** A rule as one line: its name, then what it does. */
export const ruleSaid = (rule: RuleId): string => `${ROOM_RULES[rule].name}: ${ROOM_RULES[rule].text}`;
/** The rules a room of a run is played under (by default the one it is in, `roomOf`), as one line; null under none. */
export const ruleLine = (run: RoomRun, at = run.room): string | null => {
  const { named } = roomOf(run, at);
  return named.length > 0 ? named.map(ruleSaid).join(" ") : null;
};

/** The first and last rooms of the wing a room is in, counting from 1. */
export const wingRooms = (room: number): [number, number] => [wingOf(room) * WILDS.wing + 1, wingEnd(room) + 1];

/** The boss a wing ends with: its room, counting from 1, its name as the room's plan has it, and who it is. */
export function bossOfWing(room: number): { room: number; name: string; kind: BossId | null } {
  const end = wingEnd(room);
  const plan = roomAt(end)?.plans[0];
  return { room: end + 1, name: plan?.name ?? "", kind: plan?.party.map((m) => m[0]).find(isBossId) ?? null };
}

/** The title of a pick of rules, for the wing it is for. */
export const ruleTitle = (room: number): string => {
  const [from, to] = wingRooms(room);
  return `A rule for rooms ${from} to ${to}`;
};

/** Figures moved off hexes a rule closed, as one line; null for none. */
export function shiftedLine(notes: readonly RaidNote[], run: Pick<RunView, "board" | "bench" | "era">): string | null {
  const moved = notes.flatMap((n) => (n.t === "shifted" ? [n.piece] : []));
  if (moved.length === 0) return null;
  const names = pieces(run).flatMap((p) => (moved.includes(p.id) ? [figureIn(catalogOf(run), p.kind).name] : []));
  return `Moved off closed hexes: ${names.join(", ")}.`;
}

// ---------- picking a run back up ----------

/**
 * Whose party a room was against, as a sentence goes on with it: a regular's and a boss's by the
 * name they go by now (a party kept under an old one too), a member's, the forest's by its plan.
 */
function whose(party: Party): string {
  const regular = regularOf(party);
  if (regular) return `${regular.name}'s party`;
  if (party.by !== undefined) return `${party.who}'s board`;
  // A boss is a name; the forest's other plans are said as words.
  const boss = party.figures.some((p) => isBossId(p.kind));
  return boss ? nowCalled(party.title) : party.title.charAt(0).toLowerCase() + party.title.slice(1);
}
const HOW: Readonly<Record<FightResult, string>> = { win: "won against", loss: "lost to", draw: "a draw with" };

/** What the card that picks a run of the Wilds back up says, line by line. */
export interface BackLines {
  readonly where: string;
  readonly rule: string;
  readonly boss: string;
  readonly best: string | null;
  readonly last: string | null;
}
/** The card's lines for a run, with the deepest room the member has won in the Wilds ever (from 1). */
export function backLines(run: RunView, best: number): BackLines {
  const [, to] = wingRooms(run.room);
  const boss = bossOfWing(run.room);
  const picking = picksOf(run)[0]?.kind === "rule";
  const rule =
    ruleLine(run) ??
    (picking
      ? `You pick the rule for rooms ${wingRooms(run.room).join(" to ")} next.`
      : run.room < WILDS.first
        ? `After the boss in room ${WILDS.first + 1}, you pick a rule for each 5 rooms.`
        : `No rule in these rooms. You pick one after the boss in room ${to}.`);
  const last = run.record.at(-1);
  const across = run.last?.sides[1];
  return {
    where: `Room ${run.room + 1} of the wing ending at ${to}. Health ${run.resolve}.`,
    rule,
    boss: `The boss waiting: ${boss.name}, room ${boss.room}.`,
    best: best > 0 ? `Best ever: room ${best}.` : null,
    last: last && across ? `Last room: ${HOW[last.result]} ${whose(across)}.` : null,
  };
}
