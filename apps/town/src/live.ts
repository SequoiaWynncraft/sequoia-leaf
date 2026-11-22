/**
 * The live guild: the town's questions (`guild.ts`) answered from the guild's own server, for a
 * real member. What is real comes from here: who the member is, their quests, what happened to
 * them since they were last in town, the guild's news as it happens, and who else is in the game.
 * Nothing invented comes from here: the made-up guild only lends what is not guild data (the stalls'
 * and the Treasury's wares, the mail and calls of the town's own), and has no members, news, quests
 * or Leaf of its own beside the real guild. The town's own creatures and keepers are in `folk.ts`.
 *
 * `prepare()` fetches what the town needs before it opens; `makeLive` is the guild from then on.
 *
 * A guest (signed in, not in the guild) gets the same town with none of the guild's own: no Leaf,
 * quests or news, and nothing is asked of the server that is only for members (`/v1/me...`, the
 * guild's news). Their board holds one note saying why, they are a "Guest" where a member has a
 * rank, and other guests in town are marked the same way.
 */

import { followCoins, followLeaf, type Member, member } from "@sequoia-leaf/kit/live.ts";
import { ask, isRecord, listen, outside } from "@sequoia-leaf/kit/net.ts";
import {
  hearPresent,
  here as sayHere,
  type Present,
  type Resting,
  stay as sayStay,
} from "@sequoia-leaf/kit/presence.ts";
import { skinOf } from "@sequoia-leaf/kit/skin.ts";

import type { Away, AwayLine, Guild, Happening, Mate, Me, Person, Quest, Rester, Tone, Visitor } from "./guild.ts";
import type { MadeUp } from "./madeup.ts";
import { type Line, liveLineFor, makePace } from "./news.ts";
import { parse } from "./save.ts";

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
export const GUEST_BOARD = "Quests are for members of Sequoia. Raid with the guild and yours appear here.";

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

/** The most notes the board holds. */
const BOARD_MOST = 5;

/**
 * The member's quests from `/v1/me/quests`, as notes for the board: those open now, then those
 * just finished. Each shows its nearest goal; nothing is claimed, because a quest pays itself.
 */
export function readQuests(body: unknown): Quest[] {
  if (!isRecord(body)) return [];
  const out: Quest[] = [];
  for (const q of [...list(body.quests), ...list(body.recently_completed)]) {
    if (!isRecord(q) || typeof q.id !== "string" || typeof q.title !== "string") continue;
    if (out.some((o) => o.id === q.id)) continue;
    const progress = num(q.progress);
    const target = num(q.target);
    if (progress === null || target === null || target <= 0) continue;
    const done = typeof q.completed_at === "string";
    const ends = q.slot === "timed" && !done && typeof q.expires_at === "string" ? Date.parse(q.expires_at) : NaN;
    out.push({
      id: q.id,
      title: q.title,
      have: done ? target : Math.min(progress, target),
      need: target,
      unit: unitOf(q.objective),
      reward: isRecord(q.reward) ? (num(q.reward.leaf) ?? 0) : 0,
      pays: "leaf",
      claim: false,
      ends: Number.isFinite(ends) ? ends : null,
    });
  }
  return out.slice(0, BOARD_MOST);
}

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
 * What the member did with the guild this week, as a few short counts, from their newest news. If
 * that does not reach back a whole week, the counts say "or more".
 */
export function weekOf(events: readonly Ev[], now: number, asked = 50): string[] {
  const since = now - WEEK;
  const recent = events.filter((e) => e.at >= since);
  const whole = events.length < asked || events.some((e) => e.at < since);
  const more = whole ? "" : "+";
  const raids = recent.filter((e) => e.type === "leaf_earned" && e.data.source === "raid").length;
  const wars = recent.filter((e) => e.type === "leaf_earned" && e.data.source === "war").length;
  const quests = recent.filter((e) => e.type === "quest_completed").length;
  const out: string[] = [];
  if (raids > 0) out.push(`${raids}${more} raid${raids === 1 && !more ? "" : "s"}`);
  if (wars > 0) out.push(`${wars}${more} war${wars === 1 && !more ? "" : "s"}`);
  if (quests > 0) out.push(`${quests}${more} quest${quests === 1 && !more ? "" : "s"}`);
  return out.length > 0 ? out : ["a quiet one so far"];
}

/** How long the guild's news waits for the rest of a raid party or a war to come in, in milliseconds. */
export const GATHER = 4000;
/** How long a party or war already told is remembered, so that a late name does not tell it twice. */
const REMEMBER = 10 * 60_000;

/**
 * The guild's news as it arrives, turned into the town's moments: everybody paid for the same raid
 * at the same time is one party back (and the same for a war), told once they have all come in; a
 * level or a milestone is told at once. Nothing is told twice, and no amount of Leaf goes with any
 * of it.
 */
export function makeNews(meId: string): { add(e: Ev, now: number): void; due(now: number): Happening[] } {
  const heard = new Set<number>();
  const told = new Map<string, number>();
  const gathering = new Map<string, { kind: "party" | "war"; what: string; who: Person[]; due: number }>();
  const ready: Happening[] = [];
  const person = (e: Ev): Person | null => (e.who ? { id: e.who.id, name: e.who.name, you: e.who.id === meId } : null);
  return {
    add(e, now) {
      if (heard.has(e.id)) return;
      heard.add(e.id);
      const who = person(e);
      if (!who) return;
      if (e.type === "leaf_earned" && (e.data.source === "raid" || e.data.source === "war")) {
        const what = typeof e.data.detail === "string" ? e.data.detail : "";
        const key = `${e.data.source}|${what}|${String(e.data.occurred_at)}`;
        if (told.has(key)) return;
        const g = gathering.get(key) ?? {
          kind: e.data.source === "raid" ? "party" : "war",
          what,
          who: [],
          due: 0,
        };
        if (!g.who.some((p) => p.id === who.id)) g.who.push(who);
        g.due = now + GATHER;
        gathering.set(key, g);
      } else if (e.type === "level_up" && typeof e.data.level === "number")
        ready.push({ kind: "reached", who, level: e.data.level });
      else if (e.type === "achievement_paid")
        ready.push({ kind: "milestone", who, label: typeof e.data.label === "string" ? e.data.label : "a milestone" });
    },
    due(now) {
      for (const [key, g] of gathering) {
        if (g.due > now) continue;
        gathering.delete(key);
        told.set(key, now);
        // The member first, if they were there.
        const who = g.who.toSorted((a, b) => Number(b.you) - Number(a.you));
        // A war's events say who fought where (and whether it was in the guild's claim), not how it went.
        ready.push(
          g.kind === "party"
            ? { kind: "party", who, raid: g.what || "a raid" }
            : { kind: "war", who, land: g.what || "new ground", held: null },
        );
      }
      for (const [key, at] of told) if (now - at > REMEMBER) told.delete(key);
      return ready.splice(0);
    },
  };
}

// ---------- who else is here ----------

/** The most visitors the town shows at once. */
export const VISITORS_MOST = 12;

/** Who is in the game, as visitors to the town: everybody but the member, and nobody at their own camp. */
export function toVisitors(present: readonly Present[], meId: string): Visitor[] {
  const out: Visitor[] = [];
  for (const p of present) {
    if (p.id === meId || p.place === "camp" || out.length >= VISITORS_MOST) continue;
    out.push({
      id: p.id,
      name: p.name,
      rank: p.guest ? GUEST : p.rank === null ? null : rankName(p.rank),
      at: p.place,
      skin: skinOf(p.id),
    });
  }
  return out;
}

/** Somebody's rank as "Who is about" shows it: `GUEST` for a guest, a member's if the server said it. */
const aboutRank = (p: { guest: boolean; rank?: string | null }): string | null =>
  p.guest ? GUEST : p.rank === null || p.rank === undefined ? null : rankName(p.rank);

/**
 * Who is about, for "Who is about": everybody else in the game now, wherever they are, and everybody
 * gone in the last day, whether or not their character stays, newest first; never the member, nobody twice. The
 * server says no ranks here: a guest is `GUEST`, and a member's rank is left for whoever knows it.
 */
export function toAbout(
  present: readonly Present[],
  resting: readonly Resting[],
  meId: string,
): { present: Mate[]; resting: Mate[] } {
  const now: Mate[] = [];
  for (const p of present) {
    if (p.id === meId || now.some((o) => o.id === p.id)) continue;
    now.push({ id: p.id, name: p.name, rank: aboutRank(p), at: p.place, seen: null });
  }
  const gone: Mate[] = [];
  for (const r of resting.toSorted((a, b) => b.seen - a.seen)) {
    if (r.id === meId || now.some((o) => o.id === r.id) || gone.some((o) => o.id === r.id)) continue;
    gone.push({ id: r.id, name: r.name, rank: aboutRank(r), at: r.place, seen: r.seen });
  }
  return { present: now, resting: gone };
}

/** The most members the town draws dozing at once. */
export const RESTING_MOST = 12;

/**
 * Who is resting, as the town shows them: members gone in the last day whose characters stay,
 * most recent first; never the member, nobody in the game just now, nobody last at their own camp.
 */
export function toResting(resting: readonly Resting[], present: readonly Present[], meId: string): Rester[] {
  const here = new Set(present.map((p) => p.id));
  const out: Rester[] = [];
  for (const r of resting.toSorted((a, b) => b.seen - a.seen)) {
    if (r.id === meId || here.has(r.id) || r.place === "camp" || out.some((o) => o.id === r.id)) continue;
    if (out.length >= RESTING_MOST) break;
    out.push({ id: r.id, name: r.name, rank: r.guest ? GUEST : null, at: r.place, skin: skinOf(r.id), seen: r.seen });
  }
  return out;
}

// ---------- before the town opens ----------

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
  week: string[];
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
 * Fetches the member's quests, their newest news (for the week) and their news since the cursor
 * the town kept. Says whether it could; with the made-up guild there is nothing to fetch, and for a
 * guest there is nothing that is theirs to fetch.
 */
export async function prepare(): Promise<boolean> {
  const me = member();
  if (!me) return true;
  let cursor: number | null = null;
  try {
    cursor = parse(outside.store()?.getItem("town.save.v1"))?.cursor ?? null;
  } catch {
    cursor = null;
  }
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

/** How often the board is fetched again besides when a quest moves, in milliseconds. */
const BOARD_EVERY = 5 * 60_000;

export function makeLive(madeUp: MadeUp, p: Prepared): Guild {
  let me = p.me;
  let quests = p.quests;
  let told = p.mark;
  let present: Visitor[] = [];
  let resting: Rester[] = [];
  let about: { present: Mate[]; resting: Mate[] } = { present: [], resting: [] };
  let heard = false;
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
  // The townsfolk still call at the member's camp; that is all the made-up guild says.
  madeUp.hear((h) => {
    if (h.kind === "call") tell(h);
  });

  let asking = false;
  async function fetchBoard(): Promise<void> {
    if (asking) return;
    asking = true;
    const a = await ask("/v1/me/quests");
    asking = false;
    if (a.status === 200) quests = readQuests(a.body);
  }

  /** From the first moment anybody listens: the member's news, the guild's, and who is here. A guest hears only who is here. */
  function begin(): void {
    if (begun) return;
    begun = true;
    hearPresent((seen, staying, gone) => {
      present = toVisitors(seen, me.id);
      resting = toResting(staying, seen, me.id);
      // The panel lists everybody gone in the last day; only those who stay are drawn dozing.
      about = toAbout(seen, [...staying, ...gone], me.id);
      heard = true;
    });
    // Back in view, the town asks Leaf for the Coins: a game or another device may have changed them.
    followCoins();
    if (me.guest) return;
    followLeaf(
      (type, _data, id) => {
        // Told here as it happened, so the next letter does not tell it again.
        told = Math.max(told, id);
        if (type === "leaf_earned" || type === "quest_completed" || type === "quest_rerolled") void fetchBoard();
      },
      (fresh) => {
        me = fresh;
      },
    );
    listen("/v1/game/guild/events/stream", (e) => {
      const ev = readEvent(e.data);
      if (ev) news.add(ev, outside.now());
    });
    setInterval(() => void fetchBoard(), BOARD_EVERY);
  }

  return {
    me(): Me {
      return {
        name: me.name,
        rank: me.guest ? GUEST : rankName(me.rank),
        level: me.level.number,
        voice: 560,
        look: madeUp.me().look,
        xp: me.level.into,
        next: Math.max(1, me.level.next),
        skin: skinOf(me.id),
        // A guest has no place among the ranks, and no week with the guild to show.
        ranks: me.guest ? [] : RANKS.map(capital),
        week: me.guest ? [] : p.week,
      };
    },
    quests: () => quests,
    boardNote: () => (me.guest ? GUEST_BOARD : null),
    wares: () => madeUp.wares(),
    pieces: () => madeUp.pieces(),
    stalls: () => madeUp.stalls(),
    presents: () => madeUp.presents(),
    camp: (name) => madeUp.camp(name),
    mail: (from, to) => madeUp.mail(from, to),
    lostCrab: () => madeUp.lostCrab(),
    away(from, to): Away {
      const made = madeUp.away(from, to);
      // The town's own lines stay; what the made-up guild says it paid, or did, does not.
      const townsfolk = made.lines.filter((l) => l.art === "folk" || l.art === "crab");
      return { first: made.first, hours: made.hours, lines: [...letterLines(p.since), ...townsfolk] };
    },
    hear(fn) {
      ears.add(fn);
      begin();
      return () => ears.delete(fn);
    },
    say(h, feed) {
      const line = liveLineFor(h);
      if (!line) return;
      pace.add({ line, feed }, outside.now());
      sayDue();
    },
    step(dt) {
      madeUp.step(dt);
      for (const h of news.due(outside.now())) tell(h);
      sayDue();
    },
    visitors: () => present,
    resting: () => resting,
    about: () => about,
    heard: () => heard,
    here(place) {
      sayHere(place);
    },
    stay(on) {
      sayStay(on);
    },
    told: () => told,
  };
}
