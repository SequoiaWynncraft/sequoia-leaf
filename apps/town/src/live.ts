/**
 * The live guild: the town's questions (`guild.ts`) answered from the guild's own server. Who the
 * member is, their quests, what happened to them since the town last told them, the guild's news as
 * it happens, and who else is in the game all come from here.
 *
 * `prepare(cursor)` fetches what the town needs before it opens, from how far Leaf's town says the
 * member's news has been told; `makeLive` is the guild from then on.
 *
 * A guest (signed in, not in the guild) gets the same town with none of the guild's own but their
 * Leaf: no quests or news, and nothing is asked of the server that is only for members (`/v1/me...`, the
 * guild's news). Their board holds one note saying why, they are a "Guest" where a member has a
 * rank, and other guests in town are marked the same way.
 */

import { DAY_MS, utcDay } from "@sequoia-leaf/core";
import { followLeaf, followPurse, type Member, member } from "@sequoia-leaf/kit/live.ts";
import { ask, type Backoff, backoff, isRecord, listen, outside } from "@sequoia-leaf/kit/net.ts";
import {
  hearPresent,
  here as sayHere,
  type Present,
  type Resting,
  stay as sayStay,
} from "@sequoia-leaf/kit/presence.ts";
import { leafClock } from "@sequoia-leaf/kit/realtime.ts";
import { lookFor, skinOf } from "@sequoia-leaf/kit/skin.ts";
import { HOME, later } from "@sequoia-leaf/town/clock.ts";

import { hooks } from "./game.ts";
import type {
  AwayLine,
  Count,
  Deeds,
  Goal,
  Guild,
  Happening,
  Me,
  Moment,
  Person,
  Quest,
  RoomSays,
  Tone,
} from "./guild.ts";
import { likedLine, type Line, lineFor, makePace } from "./news.ts";
import { type Gone, type Here, resters, standing, type Where, whereabouts } from "./where.ts";

/** How the guild's news is asked for again when Leaf did not answer: three seconds, doubling. */
const NEWS_BACKOFF: Backoff = { first: 3000, most: 24_000, jitter: 0.25 };

// ---------- who the member is ----------

/** The guild's ranks, lowest first, as the server sends them. */
const RANKS = ["recruit", "recruiter", "captain", "strategist", "chief", "owner"] as const;
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A rank as the town shows it: the guild's own capitalised, any other as it came, and none as a friend of the guild. */
export function rankName(rank: string | null): string {
  if (rank === null) return "Friend";
  const known = RANKS.find((r) => r === rank.toLowerCase());
  return known ? capital(known) : rank;
}

/** What the town calls somebody who plays but is not in the guild, where a member's rank would be. */
export const GUEST = "Guest";

/** The one note on a guest's quest board, in place of quests. */
export const GUEST_BOARD = "Quests are for members of Sequoia. Join the guild to take part.";

// ---------- the quest board ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** What a goal counts, in a word or two. */
function unitOf(objective: unknown): string {
  if (!isRecord(objective)) return "";
  if (objective.type === "raids")
    return typeof objective.raid === "string" ? `${objective.raid.toUpperCase()} raids` : "raids";
  if (objective.type === "wars") return "wars";
  if (objective.type === "season_rating") return "rating";
  return "";
}

/** One goal as Leaf sends it (`type`, `raid`, `progress`, `target`), full for a quest done; null for anything else. */
function readGoal(g: unknown, done: boolean): Goal | null {
  if (!isRecord(g)) return null;
  const have = num(g.progress);
  const need = num(g.target);
  if (have === null || need === null || need <= 0) return null;
  return { have: done ? need : Math.min(have, need), need, unit: unitOf(g) };
}

/** One quest as Leaf sends it, as a note for the board; null for anything that is not one. */
function readQuest(q: unknown): Quest | null {
  if (!isRecord(q) || typeof q.id !== "string" || typeof q.title !== "string" || typeof q.slot !== "string")
    return null;
  const done = typeof q.completed_at === "string";
  const nearest = readGoal(
    isRecord(q.objective) ? { ...q.objective, progress: q.progress, target: q.target } : null,
    done,
  );
  if (nearest === null) return null;
  // An open quest raids or wars can finish shows both; one done shows the goal that did it, which Leaf sends as its objective.
  const each = done ? [] : list(q.goals).map((g) => readGoal(g, false));
  const goals = each.length > 1 && each.every((g) => g !== null) ? each.filter((g) => g !== null) : [nearest];
  const ends = !done && typeof q.expires_at === "string" ? Date.parse(q.expires_at) : NaN;
  return {
    id: q.id,
    slot: q.slot,
    title: q.title,
    goals,
    reward: isRecord(q.reward) ? (num(q.reward.leaf) ?? 0) : 0,
    ends: Number.isFinite(ends) ? ends : null,
    reroll: done ? null : num(q.reroll_leaf),
  };
}

/**
 * The member's quests from `/v1/me/quests`, as notes for the board: those open now, then those
 * just finished. Nothing is claimed, because a quest pays itself.
 */
export function readQuests(body: unknown): Quest[] {
  if (!isRecord(body)) return [];
  const out: Quest[] = [];
  for (const v of [...list(body.quests), ...list(body.recently_completed)]) {
    const q = readQuest(v);
    if (q && !out.some((o) => o.id === q.id)) out.push(q);
  }
  return out;
}

/** What the board says when a reroll got no answer it can read. */
export const NO_REROLL = "Could not reroll it. Try again in a moment.";

// ---------- the member's news, and the guild's ----------

/** One thing that happened, as `/v1/me/events` and the guild's events send it. */
export interface Ev {
  id: number;
  type: string;
  /** When the server wrote it down, in milliseconds since 1970. */
  at: number;
  data: Record<string, unknown>;
  /** Whom it happened to, for the guild's events. */
  who: { id: string; name: string } | null;
}

export function readEvent(v: unknown): Ev | null {
  if (!isRecord(v) || typeof v.id !== "number" || typeof v.type !== "string" || !isRecord(v.data)) return null;
  const at = typeof v.created_at === "string" ? Date.parse(v.created_at) : NaN;
  const p = v.player;
  const who =
    isRecord(p) && typeof p.id === "string" && typeof p.username === "string" ? { id: p.id, name: p.username } : null;
  return { id: v.id, type: v.type, at: Number.isFinite(at) ? at : 0, data: v.data, who };
}

export const readEvents = (body: unknown): Ev[] =>
  isRecord(body) ? list(body.events).flatMap((e) => readEvent(e) ?? []) : [];

const leafOf = (data: unknown): number => (isRecord(data) ? Math.max(0, num(data.leaf) ?? 0) : 0);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The arrival letter's lines from what happened to the member since they were last here: raids
 * and wars (their Leaf summed), quests finished, the levels reached, milestones. Each shows the
 * Leaf the guild's ledger has already paid for it, and pays nothing.
 */
export function letterLines(events: readonly Ev[]): AwayLine[] {
  let raids = 0;
  let raidLeaf = 0;
  let wars = 0;
  let warLeaf = 0;
  const quests: string[] = [];
  let questLeaf = 0;
  let level = 0;
  let levelLeaf = 0;
  const labels: string[] = [];
  let milestoneLeaf = 0;
  for (const e of events) {
    if (e.type === "leaf_earned" && e.data.source === "raid") {
      raids++;
      raidLeaf += leafOf(e.data);
    } else if (e.type === "leaf_earned" && e.data.source === "war") {
      wars++;
      warLeaf += leafOf(e.data);
    } else if (e.type === "quest_completed" && isRecord(e.data.quest)) {
      quests.push(typeof e.data.quest.title === "string" ? e.data.quest.title : "a quest");
      questLeaf += isRecord(e.data.quest.reward) ? leafOf(e.data.quest.reward) : 0;
    } else if (e.type === "level_up") {
      level = Math.max(level, num(e.data.level) ?? 0);
      levelLeaf += leafOf(e.data);
    } else if (e.type === "achievement_paid") {
      labels.push(typeof e.data.label === "string" ? e.data.label : "a milestone");
      milestoneLeaf += leafOf(e.data);
    }
  }
  const lines: AwayLine[] = [];
  const line = (art: AwayLine["art"], text: string, got: number): void => {
    lines.push(got > 0 ? { art, text, got } : { art, text });
  };
  if (raids > 0) line("leaf", `${plural(raids, "raid", "raids")} with the guild`, raidLeaf);
  if (wars > 0) line("banner", `${plural(wars, "war", "wars")} for the guild`, warLeaf);
  if (quests.length > 0)
    line(
      "leaf",
      quests.length === 1 ? `A quest finished: ${quests[0] ?? ""}` : `${quests.length} quests finished`,
      questLeaf,
    );
  if (level > 0) line("leaf", `You reached level ${level}`, levelLeaf);
  if (labels.length > 0)
    line(
      "leaf",
      labels.length === 1 ? `A milestone reached: ${labels[0] ?? ""}` : `${labels.length} milestones reached`,
      milestoneLeaf,
    );
  return lines;
}

const WEEK = 7 * 24 * 3_600_000;

/**
 * What the member did with the guild this week, from their newest news: raids, wars and quests,
 * each a line of a sheet. If that news does not reach back a whole week, each number has a "+".
 */
export function weekOf(events: readonly Ev[], now: number, asked = 50): Count[] {
  const since = now - WEEK;
  const recent = events.filter((e) => e.at >= since);
  const whole = events.length < asked || events.some((e) => e.at < since);
  const more = whole ? "" : "+";
  const earned = (source: string): number =>
    recent.filter((e) => e.type === "leaf_earned" && e.data.source === source).length;
  const quests = recent.filter((e) => e.type === "quest_completed").length;
  return [
    ["Raids", `${earned("raid")}${more}`],
    ["Wars", `${earned("war")}${more}`],
    ["Quests", `${quests}${more}`],
  ];
}

/**
 * How long after Leaf wrote down the first of a raid party's or a war's events the town begins to
 * stage it, in milliseconds: Leaf's stream looks for news every 2 seconds, so by then every page
 * has heard of everybody in it.
 */
export const BEGINS = 6000;
/** How many raid parties and wars the page keeps for staging, the newest: a later row of one of them is not another. */
export const KEPT = 50;

const when = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : NaN);

/**
 * What Leaf says of the guild's day with its newest events (`GET /v1/game/guild/events`): the
 * UTC day and how many raids and wars the guild finished in it, and the last war; null for an
 * answer without them.
 */
export function readDay(body: unknown): { day: Deeds["day"]; flag: { land: string; happened: number } | null } | null {
  const today = isRecord(body) && isRecord(body.today) ? body.today : null;
  const from = when(today?.from);
  const raids = num(today?.raids);
  const wars = num(today?.wars);
  if (!isRecord(body) || !Number.isFinite(from) || raids === null || wars === null) return null;
  const war = isRecord(body.last_war) ? body.last_war : null;
  const happened = when(war?.occurred_at);
  return {
    day: { from, party: raids, war: wars },
    flag:
      war && typeof war.territory === "string" && Number.isFinite(happened) ? { land: war.territory, happened } : null,
  };
}

/** What makes a moment itself: its events share what it was and when it happened. */
const keyOf = (m: Moment): string => `${m.kind}|${m.what}|${m.happened}`;
const fought = (m: Moment): { land: string; happened: number } => ({ land: m.what, happened: m.happened });

/**
 * The guild's news, turned into the town's moments. Everybody paid for the same raid at the same
 * time is one party (and the same for a war), which begins `BEGINS` after Leaf wrote down the
 * first of them, with whoever Leaf had written down by then: the same on every page, whenever each
 * heard. `due` tells each once as it begins, but not one already over; a level or a milestone is
 * told at once, unless it is `old` (what a page that opens reads to catch up).
 *
 * How many raids and wars the day has had and where the guild last fought are Leaf's to say, which
 * has every event (`said`, with the newest events it was counted with, which are `old`); each raid
 * or war first heard of after that is one more in the UTC day it happened, and a war that happened
 * later than the last is the last. So a page open for long shows what one just opened does. The
 * newest `KEPT` moments are kept for staging. No amount of Leaf goes with any of it.
 */
export function makeNews(meId: string): {
  said(day: Deeds["day"], flag: { land: string; happened: number } | null): void;
  add(e: Ev, old?: boolean): void;
  due(now: number): Happening[];
  deeds(): Deeds;
} {
  let last = -Infinity;
  /** Each moment kept by what it was and when it happened, first heard first, with whether it has been told. */
  const known = new Map<string, { m: Moment & { who: Person[] }; told: boolean }>();
  /** The last war of those no longer kept, or never: Leaf's own word of it, or one let go since. */
  let before: Moment | null = null;
  let day: Deeds["day"] = { from: 0, party: 0, war: 0 };
  let deeds: Deeds = { moments: [], day };
  const ready: Happening[] = [];
  const person = (e: Ev): Person | null => (e.who ? { id: e.who.id, name: e.who.name, you: e.who.id === meId } : null);
  const show = (): void => {
    const kept = [...known.values()].map((k) => k.m);
    deeds = { moments: before && !known.has(keyOf(before)) ? [before, ...kept] : kept, day };
  };
  return {
    said(counted, flag) {
      day = counted;
      before = flag && { kind: "war", what: flag.land, who: [], happened: flag.happened, at: 0 };
      show();
    },
    add(e, old = false) {
      if (e.id <= last) return;
      last = e.id;
      const who = person(e);
      if (!who) return;
      if (e.type === "leaf_earned" && (e.data.source === "raid" || e.data.source === "war")) {
        const kind = e.data.source === "raid" ? "party" : "war";
        const what = typeof e.data.detail === "string" ? e.data.detail : "";
        const happened = when(e.data.occurred_at);
        const m: Moment & { who: Person[] } = {
          kind,
          what,
          who: [],
          happened: Number.isFinite(happened) ? happened : e.at,
          at: e.at + BEGINS,
        };
        const key = keyOf(m);
        // A later row of the last war before those kept is not that war again; one Leaf counted the day with is its moment.
        if (!old && !known.has(key) && before && key === keyOf(before)) return;
        const k = known.get(key) ?? { m, told: false };
        if (e.at < k.m.at && !k.m.who.some((p) => p.id === who.id)) k.m.who.push(who);
        if (!known.has(key)) {
          known.set(key, k);
          // What Leaf counted the day with is in its count already.
          const from = utcDay(m.happened) * DAY_MS;
          if (!old && from > day.from) day = { from, party: 0, war: 0 };
          if (!old && from === day.from) day = { ...day, [kind]: day[kind] + 1 };
          for (const [oldest, gone] of known) {
            if (known.size <= KEPT) break;
            known.delete(oldest);
            if (gone.m.kind === "war" && (!before || later(fought(gone.m), fought(before)) > 0)) before = gone.m;
          }
        }
        show();
      } else if (old) return;
      else if (e.type === "level_up" && typeof e.data.level === "number")
        ready.push({ kind: "reached", who, level: e.data.level });
      else if (e.type === "achievement_paid")
        ready.push({ kind: "milestone", who, label: typeof e.data.label === "string" ? e.data.label : "a milestone" });
    },
    due(now) {
      for (const k of known.values()) {
        const { m } = k;
        if (k.told || m.at > now) continue;
        k.told = true;
        if (now >= m.at + HOME.over) continue;
        // The member first, if they were there.
        const who = m.who.toSorted((a, b) => Number(b.you) - Number(a.you));
        // A war's events say who fought where (and whether it was in the guild's claim), not how it went.
        ready.push(
          m.kind === "party"
            ? { kind: "party", who, raid: m.what || "a raid", at: m.at }
            : { kind: "war", who, land: m.what || "new ground", at: m.at },
        );
      }
      return ready.splice(0);
    },
    deeds: () => deeds,
  };
}

// ---------- who else is here ----------

/** The most members the town draws standing at the games at once. */
export const VISITORS_MOST = 12;
/** The most members the town draws dozing at once. */
export const RESTING_MOST = 12;

/** Somebody's rank as the town shows it from Leaf's list: `GUEST` for a guest, a member's if the list says it. */
const listedRank = (guest: boolean, rank: string | null): string | null =>
  guest ? GUEST : rank === null ? null : rankName(rank);

/** Somebody Leaf lists as gone, as the town reads them (`where.ts`): where they were last, and when they left. */
export const listedGone = ({ place, guest, ...r }: Resting): Gone => ({
  ...r,
  rank: listedRank(guest, null),
  at: place,
});

/** Somebody Leaf lists as in the game, as the town reads them: with their rank, and each thing Leaf says of them there. */
export const listedHere = ({ place, guest, ...p }: Present): Here => ({
  ...p,
  rank: listedRank(guest, p.rank),
  at: place,
});

/** What the town needs from the server before it opens. */
export interface Prepared {
  me: Member;
  quests: Quest[];
  /** The member's own news since the town last told them any, oldest first. */
  since: Ev[];
  /** Whether the town has never told this member their news (their first time in it, here). */
  first: boolean;
  /** Where the letter leaves the member's news told up to. */
  mark: number;
  week: Count[];
}

let ready: Prepared | null = null;
/** What `prepare()` fetched, once it has. */
export const prepared = (): Prepared | null => ready;

/** The most pages of news one letter reads, a hundred to a page. */
const PAGES = 10;

async function newsAfter(after: number, pages: number): Promise<Ev[] | null> {
  const a = await ask(`/v1/me/events?after=${after}`);
  if (a.status !== 200) return null;
  const page = readEvents(a.body);
  const last = page.reduce((n, e) => Math.max(n, e.id), after);
  if (page.length < 100 || pages <= 1 || last === after) return page;
  const rest = await newsAfter(last, pages - 1);
  return rest === null ? null : [...page, ...rest];
}

/**
 * Fetches the member's quests, their newest news (for the week) and their news since `cursor`, how
 * far Leaf's town says it has been told (null: never). Says whether it could; for a guest there is
 * nothing that is theirs to fetch.
 */
export async function prepare(cursor: number | null): Promise<boolean> {
  const me = member();
  if (!me) return false;
  if (me.guest) {
    // The cursor stays where a member left it, for if they are one again.
    ready = { me, quests: [], since: [], first: cursor === null, mark: cursor ?? 0, week: [] };
    return true;
  }
  const [quests, recent, since] = await Promise.all([
    ask("/v1/me/quests"),
    ask("/v1/me/events"),
    cursor === null ? Promise.resolve([]) : newsAfter(cursor, PAGES),
  ]);
  if (quests.status !== 200 || recent.status !== 200 || since === null) return false;
  ready = {
    me,
    quests: readQuests(quests.body),
    since,
    first: cursor === null,
    mark: cursor === null ? me.cursor : since.reduce((n, e) => Math.max(n, e.id), cursor),
    week: weekOf(readEvents(recent.body), outside.now()),
  };
  return true;
}

/** Forgets what was prepared (for tests). */
export function unprepare(): void {
  ready = null;
}

// ---------- the guild ----------

/** How long one account of where everybody is serves: a frame, in milliseconds. */
const FRAME_MS = 16;

/** How often the board is fetched again besides when a quest moves, in milliseconds. */
const BOARD_EVERY = 5 * 60_000;

export function makeLive(p: Prepared): Guild {
  let me = p.me;
  let quests = p.quests;
  let told = p.mark;
  /** Leaf's list of who is about, as last heard; and what the town's live room says, once it is followed. */
  let listed: { present: Here[]; resting: Gone[]; gone: Gone[] } = { present: [], resting: [], gone: [] };
  let room: RoomSays = { room: () => null, ranks: new Map(), stirred: new Map() };
  // The one account of where everybody is, worked out at most once a frame, however many ask in it
  // (the figures, the visitors, Who is about, a card), and at once when Leaf's lists come.
  let snapshot: { made: number; listed: typeof listed; where: ReadonlyMap<string, Where> } | null = null;
  const whereNow = (): ReadonlyMap<string, Where> => {
    const made = outside.now();
    if (snapshot?.listed === listed && made >= snapshot.made && made - snapshot.made < FRAME_MS) return snapshot.where;
    const where = whereabouts({
      me: me.id,
      room: room.room(),
      ...listed,
      ranks: room.ranks,
      stirred: room.stirred,
    });
    snapshot = { made, listed, where };
    return where;
  };
  let begun = false;
  const ears = new Set<(h: Happening) => void>();
  const news = makeNews(me.id);
  const pace = makePace<{ line: Line; feed: (text: string, tone: Tone) => void }>();
  const tell = (h: Happening): void => {
    for (const fn of ears) fn(h);
  };
  /** Says whichever of the news's lines has its turn now. */
  const sayDue = (): void => {
    for (const { line, feed } of pace.due(outside.now())) feed(line[0], line[1]);
  };
  let asking = false;
  /** A reroll is on its way; and how many have been answered. */
  let swapping = false;
  let swapped = 0;
  async function fetchBoard(): Promise<void> {
    if (asking) return;
    asking = true;
    const before = swapped;
    const a = await ask("/v1/me/quests");
    asking = false;
    if (a.status !== 200) return;
    // A reroll sent or answered while this was on its way knows more than this does: once the
    // reroll is answered, the board is read again.
    if (!swapping && swapped === before) quests = readQuests(a.body);
    else if (!swapping) void fetchBoard();
  }

  /** From the first moment anybody listens: the member's news, the guild's, and who is here. A guest hears only who is here. */
  function begin(): void {
    if (begun) return;
    begun = true;
    hearPresent((seen, staying, gone) => {
      listed = { present: seen.map(listedHere), resting: staying.map(listedGone), gone: gone.map(listedGone) };
    });
    // Back in view, the town asks Leaf for the purse: another device may have changed it.
    followPurse();
    if (me.guest) return;
    followLeaf(
      (type, event, id) => {
        // Told here as it happened, so the next letter does not tell it again.
        told = Math.max(told, id);
        if (type === "leaf_earned" || type === "quest_completed" || type === "quest_rerolled") void fetchBoard();
        const liked = type === "camp_liked" ? likedLine(event) : null;
        if (liked) pace.add({ line: liked, feed: hooks.feed }, outside.now());
      },
      (fresh) => {
        me = fresh;
      },
    );
    // Leaf's word of the guild's day and its newest news first, for the moments under way; then as it happens.
    void (async () => {
      let a = await ask("/v1/game/guild/events");
      // Without it the page has no word of the guild's day: one that got no answer, or Leaf's
      // trouble for one, is asked for again, a few times.
      for (let tries = 0; (a.status === 0 || a.status >= 500) && tries < 5; tries++) {
        // oxlint-disable-next-line no-await-in-loop -- waiting before trying again
        await new Promise((again) => setTimeout(again, backoff(NEWS_BACKOFF, tries)));
        // oxlint-disable-next-line no-await-in-loop -- one try at a time
        a = await ask("/v1/game/guild/events");
      }
      const newest = a.status === 200 ? readEvents(a.body) : [];
      const counted = readDay(a.body);
      if (counted) news.said(counted.day, counted.flag);
      for (const e of newest) news.add(e, true);
      const from = newest.at(-1);
      listen(
        "/v1/game/guild/events/stream",
        (e) => {
          const ev = readEvent(e.data);
          if (ev) news.add(ev);
        },
        from ? { after: from.id } : {},
      );
    })();
    setInterval(() => void fetchBoard(), BOARD_EVERY);
  }

  return {
    me(): Me {
      return {
        name: me.name,
        rank: me.guest ? GUEST : rankName(me.rank),
        level: me.level.number,
        voice: 560,
        // Until their own skin arrives.
        look: lookFor(me.name),
        xp: me.level.into,
        next: Math.max(1, me.level.next),
        skin: skinOf(me.id),
        // A guest has no week with the guild to show.
        week: me.guest ? [] : p.week,
      };
    },
    quests: () => quests,
    async reroll(id, leaf) {
      if (swapping || !quests.some((q) => q.id === id)) return null;
      swapping = true;
      const a = await ask(`/v1/me/quests/${id}/reroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaf }),
      });
      swapping = false;
      swapped++;
      const body = isRecord(a.body) ? a.body : {};
      const fresh = a.status === 200 ? readQuest(body.quest) : null;
      const left = num(body.leaf);
      if (fresh && left !== null) {
        // The purse took Leaf's word from beside the answer (`net.ts`).
        quests = quests.map((q) => (q.id === id ? fresh : q));
        return { spent: num(body.spent) ?? leaf };
      }
      // What Leaf found on the way to refusing (the quest finished meanwhile) is read.
      void fetchBoard();
      // Refused, Leaf says why; with no answer it can read, the board says so.
      const message = a.status >= 400 && a.status < 500 && typeof body.message === "string" ? body.message : null;
      return { said: message ?? NO_REROLL };
    },
    boardNote: () => (me.guest ? GUEST_BOARD : null),
    news: () => letterLines(p.since),
    hear(fn) {
      ears.add(fn);
      begin();
      return () => ears.delete(fn);
    },
    say(h, feed) {
      const line = lineFor(h);
      if (!line) return;
      pace.add({ line, feed }, outside.now());
      sayDue();
    },
    step() {
      for (const h of news.due(leafClock(outside.now()))) tell(h);
      sayDue();
    },
    deeds: () => news.deeds(),
    visitors: () =>
      standing(whereNow(), VISITORS_MOST).map(({ id, name, rank, at, acted, since }) => ({
        id,
        name,
        rank,
        at,
        skin: skinOf(id),
        acted: acted ?? since,
      })),
    resting: () =>
      resters(whereNow(), RESTING_MOST).map(({ id, name, rank, at, seen, stays }) => ({
        id,
        name,
        rank,
        at,
        skin: skinOf(id),
        seen,
        stays,
      })),
    whereabouts: whereNow,
    followRoom(says) {
      room = says;
    },
    here: sayHere,
    stay: sayStay,
    told: () => told,
  };
}
