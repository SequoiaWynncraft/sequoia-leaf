/**
 * Staging a moment at the raid's table, for the screenshot tours: what play does not reach by
 * itself (a run from a chosen seed, more acorns, a figure handed over, a figure on the stall, an
 * item on the rack, empty hands, a new member, another member's board across the table, under a
 * name, figures pulled). Only the play server on this machine (`play.ts`) serves it, at
 * `POST /test/play/raid`; the guild's own Leaf has no such route.
 *
 * `{ pulled: { greg: 3 } }` has Tester hold the awards of three copies of Greg pulled (a banner's
 * member by its banner, `{ "banner-1": 2 }`), and
 * `{ start: { seed, trail, own: true } }` sets out with the figures pulled; `{ fresh: true }` is a
 * member who has pulled nothing.
 *
 * The endless run: `{ venture: { way, seed, room, level, acorns } }` sets out on one, in a room
 * (counting from 0) with every room before it won, at a level and with acorns; any other step with
 * `slot: "endless"` is done to it rather than to the run in hand. `{ rule: "fog" }` has a Wilds rule
 * waiting to be picked first, offered alone: picking it plays the wing under it. `stageWoods` fills the endless
 * boards with other members, and has one of them hold rooms of the Deep Woods.
 */
import { type PlayerId, utcWeekStart } from "@sequoia-leaf/core";
import {
  boardMet,
  catalogAt,
  catalogOf,
  ENDLESS,
  type EndlessWay,
  isComponentId,
  isEndlessWay,
  isFigureId,
  isFinishedId,
  isMemberId,
  isRuleId,
  keepRoom,
  lanes,
  layOutAfresh,
  LEGACY_ERA,
  MAX_LEVEL,
  onTrail,
  RAID,
  roomAt,
  type Roster,
  rosterOf,
  type Run,
  type Span,
  sparAt,
  sparParty,
  startRun,
  type Table,
  TRAIL_COUNT,
  wayOn,
  weekAt,
} from "@sequoia-leaf/raid";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { keepStaged } from "./stage-kept.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, least: number, most: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= least && v <= most ? v : null;

/**
 * Sets out on an endless run, with the member's own figures (`own`: the roster) or everyone's, in a
 * room with every room before it won (so a boss won past the fifteenth is a chair), at a level and
 * with acorns, its stall and its room laid out afresh; and writes that room down as the deepest won
 * this week and ever with those figures, as play would have.
 */
function venture(table: Table, v: Record<string, unknown>, own: Roster): Run | null {
  if (!isEndlessWay(v.way)) return null;
  const seed = whole(v.seed, 0, 0xffffffff) ?? 1;
  const room = whole(v.room, 0, 200) ?? 0;
  const run = startRun(seed, { era: LEGACY_ERA, way: wayOn({ id: v.way }, v.own === true ? own : null) });
  table.begun.endless += 1;
  table.held.endless = run;
  if (room === 0) return run;
  for (let i = 0; i < room; i++)
    keepRoom(run, { room: i, kind: roomAt(i)?.kind ?? "spar", result: "win", standing: [3, 0], boss: null });
  run.room = room;
  run.level = whole(v.level, 1, MAX_LEVEL) ?? MAX_LEVEL;
  run.acorns = whole(v.acorns, 0, 999) ?? 50;
  // With nobody in the party yet, the first figure is still to be picked (`layOutAfresh` draws it).
  run.stage = { phase: "plan", picks: [{ kind: "starter", options: [] }] };
  layOutAfresh(run, seed);
  const mine = v.own === true;
  if (mine) table.apart.week = weekAt(table.apart.week, Date.now());
  else table.week = weekAt(table.week, Date.now());
  const kept = mine ? table.apart : { deepest: table.almanac.deepest, week: table.week };
  kept.week.deepest[v.way] = Math.max(kept.week.deepest[v.way], room);
  kept.deepest[v.way] = Math.max(kept.deepest[v.way], room);
  return run;
}

/** Does one staging step to a table, writing down the number of a run or a figure it made. */
function step(table: Table, op: Record<string, unknown>, made: number[], own: Roster): void {
  if (isRecord(op.venture)) {
    if (venture(table, op.venture, own)) made.push(table.begun.endless);
    return;
  }
  const run = table.held[op.slot === "endless" ? "endless" : "main"];
  if (isRecord(op.start)) {
    const seed = whole(op.start.seed, 0, 0xffffffff) ?? 1;
    const trail = whole(op.start.trail, 0, TRAIL_COUNT - 1) ?? 0;
    table.begun.main += 1;
    table.held.main = startRun(seed, { era: LEGACY_ERA, way: onTrail(trail, op.start.own === true ? own : null) });
    table.trail = trail;
    made.push(table.begun.main);
    return;
  }
  if (!run) return;
  const acorns = whole(op.acorns, 0, 999);
  if (acorns !== null) run.acorns = acorns;
  if (isRecord(op.give) && isFigureId(op.give.kind)) {
    const slot = run.bench.indexOf(null);
    if (slot >= 0) {
      const stars = op.give.stars === 3 ? 3 : op.give.stars === 2 ? 2 : 1;
      const id = run.nextId++;
      run.bench[slot] = { id, kind: op.give.kind, stars, items: [], fed: 0 };
      made.push(id);
    }
  }
  if (isRecord(op.offer) && isFigureId(op.offer.kind)) {
    const at = whole(op.offer.at, 0, run.stall.length - 1);
    if (at !== null) run.stall[at] = op.offer.kind;
  }
  if (isComponentId(op.item) || isFinishedId(op.item)) run.items.push(op.item);
  // The party waiting in the room as another member's board, signed as the rules sign one Leaf hands over.
  if (typeof op.member === "string") {
    const met = { player: "20000000-0000-4000-8000-0000000000aa", name: op.member, data: run.foe, of: 1 };
    run.foe = boardMet(catalogOf(run), met, false, run.way.course.id === "trail" ? 0 : ENDLESS.chairs) ?? run.foe;
  }
  if (isRuleId(op.rule) && run.stage.phase === "plan")
    run.stage.picks = [{ kind: "rule", options: [op.rule] }, ...run.stage.picks.filter((c) => c.kind !== "rule")];
  if (op.strip === true) {
    for (const piece of [...run.board, ...run.bench]) if (piece) piece.items = [];
  }
}

/**
 * The endless boards with other members on them (`others`, each deeper than the next) as their runs
 * leave them with Leaf (`play_kept`), with everyone's figures and (not as deep) with their own, and
 * rooms of the Deep Woods held by them: `{ hold: { room, by } }` has the `by`th of them hold a room
 * (counting from 0) with a regular's board for it, from `now`.
 */
/** Where an endless way's depths are left, with everyone's figures or (`own`) the member's own. */
const depthSlot = (course: EndlessWay, span: Span, own = false): string =>
  lanes(wayOn({ id: course }, own ? {} : null)).depth(span) ?? "";
/** Where the holder of a room of the Deep Woods, with everyone's figures, keeps their board. */
export const heldSlot = (room: number): string => lanes(wayOn({ id: "deep" })).held(room) ?? "";

export const stageWoods = (others: readonly PlayerId[], ops: readonly unknown[], now: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const keep = (player: PlayerId, slot: string, data: unknown, at: number) => sql`
      INSERT INTO play_kept (player_id, game, slot, data, updated_at) VALUES (${player}, 'raid', ${slot}, ${JSON.stringify(data)}, ${at})
      ON CONFLICT (player_id, game, slot) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `;
    if (ops.some((op) => isRecord(op) && op.woods === true)) {
      for (const [i, player] of others.entries()) {
        const at = Math.max(utcWeekStart(now), now - (i + 1) * 60_000);
        yield* keep(player, depthSlot("wilds", "ever"), { room: 44 - 6 * i }, at - 86_400_000 * 9);
        yield* keep(player, depthSlot("wilds", "week"), { room: 31 - 3 * i }, at);
        yield* keep(player, depthSlot("deep", "ever"), { room: 27 - 2 * i }, at - 86_400_000 * 9);
        yield* keep(player, depthSlot("deep", "week"), { room: 25 - 2 * i }, at);
        yield* keep(player, depthSlot("wilds", "ever", true), { room: 33 - 5 * i }, at - 86_400_000 * 9);
        yield* keep(player, depthSlot("wilds", "week", true), { room: 24 - 3 * i }, at);
        yield* keep(player, depthSlot("deep", "ever", true), { room: 22 - 2 * i }, at - 86_400_000 * 9);
        yield* keep(player, depthSlot("deep", "week", true), { room: 20 - 2 * i }, at);
      }
    }
    for (const op of ops) {
      const hold = isRecord(op) && isRecord(op.hold) ? op.hold : null;
      const room = whole(hold?.room, 0, 200);
      const player = others[whole(hold?.by, 0, others.length - 1) ?? 0];
      if (room === null || player === undefined) continue;
      yield* keep(player, heldSlot(room), sparParty(catalogAt(LEGACY_ERA), 7 + room, room, 0, sparAt(room)), now);
    }
  });

/** Stages each step in order on the player's table, as one change. Gives back the numbers of what it made. */
export const stageRaid = (playerId: PlayerId, ops: readonly unknown[]) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const stored = yield* SqlSchema.findOneOption({
      Request: Schema.String,
      Result: Schema.Struct({ rev: Schema.Int, state: Schema.String }),
      execute: (player) => sql`SELECT rev, state FROM play_state WHERE player_id = ${player} AND game = 'raid'`,
    })(playerId);
    if (ops.some((op) => isRecord(op) && op.fresh === true)) {
      yield* sql`DELETE FROM play_state WHERE player_id = ${playerId} AND game = 'raid'`;
      yield* sql`DELETE FROM awards WHERE player_id = ${playerId} AND (id LIKE 'pull:figure:%' OR id LIKE 'copies:figure:%' OR id LIKE 'pull:headliner:%' OR id LIKE 'copies:headliner:%')`;
      return [];
    }
    // What Tester has pulled, as the pulls award it: each figure or banner's member, and each further copy.
    const pulled = ops.flatMap((op) => (isRecord(op) && isRecord(op.pulled) ? Object.entries(op.pulled) : []));
    const won = pulled.flatMap(([id, copies]) => {
      const prize = isMemberId(id) ? `headliner:${id}` : `figure:${id}`;
      return Array.from({ length: whole(copies, 1, 99) ?? 0 }, (_, i) =>
        i === 0 ? `pull:${prize}` : `copies:${prize}:${i + 1}`,
      );
    });
    for (const id of won) {
      yield* sql`INSERT OR IGNORE INTO awards (player_id, id, at) VALUES (${playerId}, ${id}, ${Date.now()})`;
    }
    const awards = yield* SqlSchema.findAll({
      Request: Schema.String,
      Result: Schema.Struct({ id: Schema.String }),
      execute: (player) => sql`SELECT id FROM awards WHERE player_id = ${player}`,
    })(playerId);
    const own = rosterOf(awards.map((row) => row.id));
    const found = Option.isSome(stored) ? RAID.decode(stored.value.state) : null;
    const table =
      found ??
      RAID.create({
        now: Date.now(),
        player: { id: playerId, guest: false },
        seed: 1,
        room: 0,
        awards: [],
        postcards: {},
      });
    const made: number[] = [];
    for (const op of ops) if (isRecord(op)) step(table, op, made, own);
    const text = RAID.encode(table);
    if (RAID.decode(text) === null) return [];
    yield* keepStaged(playerId, "raid", text, RAID.postcard?.(table), Date.now());
    return made;
  });
