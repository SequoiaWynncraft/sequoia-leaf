import {
  encodeSnapshot,
  type Entry,
  Flag,
  type LiveMember,
  type Motion,
  type RoomKind,
  roomKind,
  type ToClient,
} from "@sequoia-leaf/core";
import type { Effect } from "effect";

/**
 * What became of the frames written at a tick, counted as each is (`Connection.writeIf`): written
 * there and then (`direct`, once the socket's writer has done the write), put in a connection's
 * line behind what was waiting (`queued`), or not for the page any more (`passed`).
 */
export interface Tally {
  direct: number;
  queued: number;
  passed: number;
}

export const noTally = (): Tally => ({ direct: 0, queued: 0, passed: 0 });

/** A way through to somebody's page, as it is when a snapshot is made for them. */
export interface Connection {
  /**
   * Writes from the fiber this runs in what `take()` says to write when its turn comes, if
   * anything: nothing is written to the page between its saying and the writing. What became of
   * it is counted in `tally`.
   */
  writeIf(take: () => Uint8Array | null, tally: Tally): Effect.Effect<void>;
}

/**
 * Where a room sends what it has to say to one of the people in it: the player. `send` puts a
 * frame in line on whichever connection they have now, and says whether one took it;
 * `connection` is that connection, if any, for a snapshot written to it at the tick.
 */
export interface Outbox {
  send(frame: string | Uint8Array): boolean;
  connection(): Connection | null;
}

/** Somebody in a room: who they are, their latest motion, and whether it has changed since the room last said. */
export interface Occupant {
  readonly member: LiveMember;
  readonly outbox: Outbox;
  /** What the room shows of them, moved only by `moved`, `halted`, `reconnected` and the room's tick. */
  shown: Shown;
  /** How many times the room has greeted them (`greet`), each a welcome and all of its motion. */
  greeted: number;
}

/** Somebody a snapshot is for, as they stood when it was made: on this connection, greeted so many times. */
interface Recipient {
  readonly occupant: Occupant;
  readonly connection: Connection;
  readonly greeted: number;
}

/** Somebody a snapshot shows, and their motion as it shows it. */
interface Shows {
  readonly occupant: Occupant;
  readonly entry: Entry;
}

/**
 * A room's snapshot at a tick, and everybody it is for, each as their page stood with the room then
 * (`Recipient`). Each is told it when their turn comes (`for`), which may be later: the tick lets
 * others run between one write and the next, and meanwhile anything may have been sent to a page.
 * Whatever was, the snapshot never says anything a page was told otherwise since it was made. Of
 * every frame a room or Live puts on a page's connection:
 *
 * - A welcome (`greet`: in another room, in this one again, or on a new connection), and all of
 *   the room's motion after it, newer than this: the page has begun again from that, and is told
 *   nothing of this. This is the only other frame that says where anybody is.
 * - `left`: whoever left is not shown. The frame is made again without them, once a leaving, and
 *   everybody else's motion still goes, so nobody loses a move.
 * - `joined`: nobody who came in since is in it, as they were not in the room when it was made; nor
 *   is anybody it shows who left and whose number was given to somebody new, which is a leaving.
 * - `act`, `did`, `changed`, `about`, `aboutChanged`, `error`, `pong`: none says where anybody is,
 *   and it goes as it is.
 * - A close: nothing is written after it (`Connection.writeIf`).
 *
 * The next snapshot comes only after this one has gone to everybody: one tick at a time. The room's
 * tests keep the text frames whole: a new kind (`ToClient`) does not compile there until it is
 * placed. Binary frames are kept whole by hand: only `greet` and the tick's snapshot send any.
 */
export class Snapshot {
  readonly to: readonly Recipient[];
  private readonly room: Room;
  private readonly tick: number;
  private readonly time: number;
  private shows: readonly Shows[];
  private frame: Uint8Array;
  /** How many had left the room (`Room.departed`) when `frame` was made. */
  private departed: number;

  constructor(room: Room, tick: number, time: number, shows: readonly Shows[], to: readonly Recipient[]) {
    this.room = room;
    this.tick = tick;
    this.time = time;
    this.shows = shows;
    this.to = to;
    this.frame = encodeSnapshot(
      tick,
      time,
      shows.map((s) => s.entry),
    );
    this.departed = room.departed;
  }

  /**
   * What to write to `r` now: the room's motion as it was at the tick, but for anybody who has left
   * since; or nothing, when it is no longer for them (they have left the room, even to come back in
   * as another, or have been greeted since, on this connection or a new one), or nobody it showed
   * is still there.
   */
  for(r: Recipient): Uint8Array | null {
    const { occupant } = r;
    if (!this.room.has(occupant) || occupant.outbox.connection() !== r.connection || occupant.greeted !== r.greeted)
      return null;
    if (this.departed !== this.room.departed) {
      this.shows = this.shows.filter((s) => this.room.has(s.occupant));
      this.frame = encodeSnapshot(
        this.tick,
        this.time,
        this.shows.map((s) => s.entry),
      );
      this.departed = this.room.departed;
    }
    return this.shows.length === 0 ? null : this.frame;
  }
}

/**
 * What a room shows of somebody: nothing before their first move (`unseen`); then (`seen`) their
 * motion as everybody is shown it, the number their game gave the move, when the room took it,
 * whether it changed since the room last told everybody, the room's count of their jumps (what
 * everybody else is shown), and the jump count their game last sent on its present connection
 * (`heard`; null on a new connection, whose first move is a jump, wherever it counts from).
 */
export type Shown =
  | { readonly state: "unseen" }
  | {
      readonly state: "seen";
      readonly motion: Motion;
      readonly seq: number;
      readonly movedAt: number;
      readonly changed: boolean;
      readonly jump: number;
      readonly heard: number | null;
    };

/** The fastest a motion may say a player moves, in the room's units a second. */
const MOST_SPEED = 1024;
/**
 * How long somebody shown walking may go without a move before the room stands them still where
 * they are, in milliseconds. A game says where its walking player is twenty times a second; one that
 * says nothing for this long has stopped drawing them (its tab hidden, its page stalled), and they
 * are not walking anywhere.
 */
export const QUIET_MS = 300;
/** How much further than the room's pace a move may go before it is a jump: half as far again, and a little. */
const PACE_SLACK = 1.5;
const PACE_REACH = 8;

/**
 * Whether a move from one place to another, `ms` after the last, goes further than somebody can
 * get at a room's pace (`speed` a second): half as far again as that, and 8 units, allow for moves
 * that arrive bunched together. A game that says its player is somewhere they could not have
 * walked to only has them jump there.
 */
function outpaced(from: { x: number; y: number }, to: { x: number; y: number }, ms: number, speed: number) {
  return Math.hypot(to.x - from.x, to.y - from.y) > (speed * Math.max(0, ms) * PACE_SLACK) / 1000 + PACE_REACH;
}

const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n));

/**
 * Somebody's move `m`, numbered `seq` by their game, taken at `time` in a room of `kind`: kept
 * inside the room and below the fastest anybody moves. The room's count of their jumps goes up
 * whenever their game's count changes (or on a new connection's first move), and whenever the move
 * goes further than the room's pace allows since the last (`outpaced`). Says too whether they went
 * anywhere: a first move, or one that only turns them, does not.
 */
export function moved(
  shown: Shown,
  seq: number,
  m: Motion,
  time: number,
  kind: Pick<RoomKind, "width" | "height" | "speed">,
): { readonly shown: Shown; readonly went: boolean } {
  const x = clamp(m.x, 0, kind.width);
  const y = clamp(m.y, 0, kind.height);
  const was = shown.state === "seen" ? shown : null;
  const jumped = was === null || was.heard !== m.jump || outpaced(was.motion, { x, y }, time - was.movedAt, kind.speed);
  const jump = ((was?.jump ?? 0) + (jumped ? 1 : 0)) & 0xff;
  const motion = {
    x,
    y,
    vx: clamp(m.vx, -MOST_SPEED, MOST_SPEED),
    vy: clamp(m.vy, -MOST_SPEED, MOST_SPEED),
    facing: m.facing,
    pose: m.pose,
    flags: m.flags,
    jump,
  };
  return {
    shown: { state: "seen", motion, seq, movedAt: time, changed: true, jump, heard: m.jump },
    went: was !== null && (was.motion.x !== x || was.motion.y !== y),
  };
}

type Seen = Extract<Shown, { state: "seen" }>;

/** Somebody seen walking stops where they are, and everybody is to be told; standing, they stay as they are. */
const stood = (shown: Seen): Seen =>
  (shown.motion.flags & Flag.Moving) !== 0
    ? {
        ...shown,
        motion: { ...shown.motion, vx: 0, vy: 0, flags: shown.motion.flags & ~Flag.Moving },
        changed: true,
      }
    : shown;

/** Somebody shown walking stops where they are, and everybody is to be told; anybody else stays as they are. */
export const halted = (shown: Shown): Shown => (shown.state === "seen" ? stood(shown) : shown);

/** Somebody's game has a new connection: whatever it counts its jumps from, its first move is one. */
export const reconnected = (shown: Shown): Shown => (shown.state === "seen" ? { ...shown, heard: null } : shown);

/**
 * One copy of a room: who is in it and where. It is plain state, changed by one thing at a time, and
 * says what it has to say through each occupant's outbox: who came and went and what they did, as
 * it happens; and once a tick it makes everyone's changed motion into one snapshot for all of them
 * (`flush`), with who it is for, which Live writes to each. In a still room (a visit's) it says only
 * who came and went.
 *
 * A room has work at a tick only while somebody's motion has changed since the last, or somebody is
 * shown walking (who stops once their game goes quiet). It is on its rooms' list of those (`busy`)
 * from the change that gives it work until the tick that finds none left, and the tick goes through
 * those rooms alone: a room of people standing, and a still room, cost nothing.
 */
export class Room {
  readonly occupants = new Map<number, Occupant>();
  /** The kind and the copy, as `town/1`. */
  readonly name: string;
  /** The kind alone, as `town`. */
  readonly kindName: string;
  readonly kind: RoomKind;
  private lastId = 0;
  /** How many have left the room since it opened, for a snapshot being told to see that somebody has (`Snapshot.for`). */
  departed = 0;
  /** The rooms with work at the next tick, this one among them while it has any. */
  private readonly busy: Set<Room>;

  constructor(kindName: string, copy: number, kind: RoomKind, busy: Set<Room> = new Set()) {
    this.kindName = kindName;
    this.name = `${kindName}/${copy}`;
    this.kind = kind;
    this.busy = busy;
  }

  get size(): number {
    return this.occupants.size;
  }

  get full(): boolean {
    return this.occupants.size >= this.kind.capacity;
  }

  /** Lets somebody in, tells everyone else that they came, and greets them. Returns them. */
  join(who: Omit<LiveMember, "id">, outbox: Outbox, time: number, hz: number, version: number): Occupant {
    const id = this.freeId();
    const occupant: Occupant = { member: { id, ...who }, outbox, shown: { state: "unseen" }, greeted: 0 };
    this.occupants.set(id, occupant);
    this.others(id, text({ t: "joined", member: occupant.member }));
    this.greet(occupant, time, hz, version);
    return occupant;
  }

  /**
   * Tells somebody in the room who is here, and then where everybody is: when they come in, and
   * again whenever they connect again. Nobody else hears of it.
   */
  greet(o: Occupant, time: number, hz: number, version: number): void {
    o.greeted++;
    const roster = [...this.occupants.values()].map((each) => each.member);
    o.outbox.send(text({ t: "welcome", v: version, you: o.member.id, room: this.name, hz, time, roster }));
    const everyone = this.entries();
    if (everyone.length > 0) o.outbox.send(encodeSnapshot(0, time, everyone));
  }

  /** Lets somebody go, and tells everyone else. */
  leave(id: number): void {
    if (!this.occupants.delete(id)) return;
    this.departed++;
    this.others(id, text({ t: "left", id }));
  }

  /**
   * Takes somebody's motion at `time` (Leaf's clock), kept inside the room and below the fastest
   * anybody moves. Moves come only from the player's present connection, in the order it sent
   * them, so the newest is the one that counts: it is all of where they are. The room keeps its own
   * count of their jumps: it goes up whenever their game's count changes, or a new connection of
   * theirs sends its first move (it may count from anywhere), so nobody is ever drawn sliding from
   * where they were; and whenever a move goes further than the room's pace allows since the last
   * (`outpaced`), so a game that says its player is anywhere it likes only has them jump there.
   * Says whether they went anywhere: a first move, or one that only turns them, does not. In a
   * still room nobody moves.
   */
  move(id: number, seq: number, m: Motion, time: number): boolean {
    const o = this.occupants.get(id);
    if (!o || this.kind.still === true) return false;
    const next = moved(o.shown, seq, m, time, this.kind);
    o.shown = next.shown;
    this.busy.add(this);
    return next.went;
  }

  /** Somebody's game has a new connection: whatever it counts its jumps from, its first move is one. */
  reconnected(id: number): void {
    const o = this.occupants.get(id);
    if (o) o.shown = reconnected(o.shown);
  }

  /** Somebody has stopped where they are, as when their connection drops: everyone sees them stand. */
  halt(id: number): void {
    const o = this.occupants.get(id);
    if (!o) return;
    o.shown = halted(o.shown);
    if (o.shown.state === "seen" && o.shown.changed) this.busy.add(this);
  }

  /** Tells everyone else what somebody did; in a still room, nobody. */
  act(id: number, kind: string, arg: string): void {
    if (!this.occupants.has(id) || this.kind.still === true) return;
    this.others(id, text({ t: "act", id, kind, arg }));
  }

  /**
   * The room's tick at `time`: first, everybody shown walking whose game has sent no move for
   * `QUIET_MS` stops where they are, as `halt` stops them, so that a page that has stopped drawing
   * its player (a hidden tab) never leaves them walking on the spot for everybody else (their next
   * move walks them on); then the motion that changed since the last tick goes in one snapshot for
   * everyone in the room with a connection, each by the one they have now, or null if none did.
   * Everybody counts as told it from now: it is for whoever writes it to them (`Snapshot.for`).
   * Once nobody is left walking, the room has no work until a change.
   */
  flush(tick: number, time: number): Snapshot | null {
    const changed: Shows[] = [];
    let walking = false;
    for (const o of this.occupants.values()) {
      if (o.shown.state !== "seen") continue;
      let shown = o.shown;
      if (time - shown.movedAt >= QUIET_MS) shown = stood(shown);
      if (shown.changed) {
        changed.push({ occupant: o, entry: entryOf(o, shown) });
        shown = { ...shown, changed: false };
      }
      o.shown = shown;
      if ((shown.motion.flags & Flag.Moving) !== 0) walking = true;
    }
    if (!walking) this.busy.delete(this);
    if (changed.length === 0) return null;
    const to: Recipient[] = [];
    for (const occupant of this.occupants.values()) {
      const connection = occupant.outbox.connection();
      if (connection) to.push({ occupant, connection, greeted: occupant.greeted });
    }
    return new Snapshot(this, tick, time, changed, to);
  }

  /** Whether somebody is in the room still, as this occupant: not gone, nor gone and come back in as another. */
  has(o: Occupant): boolean {
    return this.occupants.get(o.member.id) === o;
  }

  /** Everybody seen, as a snapshot carries them. */
  private entries(): Entry[] {
    const out: Entry[] = [];
    for (const o of this.occupants.values()) if (o.shown.state === "seen") out.push(entryOf(o, o.shown));
    return out;
  }

  private others(id: number, frame: string): void {
    for (const o of this.occupants.values()) if (o.member.id !== id) o.outbox.send(frame);
  }

  /** The next number not in use, counting up from the last given and wrapping below 65536, never 0. */
  private freeId(): number {
    for (;;) {
      this.lastId = this.lastId >= 0xffff ? 1 : this.lastId + 1;
      if (!this.occupants.has(this.lastId)) return this.lastId;
    }
  }
}

const text = (message: ToClient): string => JSON.stringify(message);

/** Somebody's motion as a snapshot carries it. */
const entryOf = (o: Occupant, shown: Seen): Entry => ({ id: o.member.id, seq: shown.seq, ...shown.motion });

/**
 * Every copy of every room. A player asks for a kind of room and is put in the first copy with
 * space, or a new one; a copy is closed when its last player leaves, and its number used again.
 */
export class Rooms {
  private readonly byKind = new Map<string, Room[]>();
  /** The rooms with work at the next tick (`Room`). */
  private readonly working = new Set<Room>();

  /** A copy of the room of this kind with space for one more, opened if need be; none for a kind there is not. */
  place(kindName: string): Room | undefined {
    const kind = roomKind(kindName);
    if (kind === undefined) return undefined;
    const copies = this.byKind.get(kindName) ?? [];
    const open = copies.find((room) => !room.full);
    if (open) return open;
    const taken = new Set(copies.map((room) => room.name));
    let n = 1;
    while (taken.has(`${kindName}/${n}`)) n++;
    const room = new Room(kindName, n, kind, this.working);
    this.byKind.set(
      kindName,
      [...copies, room].toSorted((a, b) => a.name.localeCompare(b.name, "en", { numeric: true })),
    );
    return room;
  }

  /** Closes a copy nobody is in. */
  tidy(room: Room): void {
    if (room.size > 0) return;
    this.working.delete(room);
    const left = (this.byKind.get(room.kindName) ?? []).filter((r) => r !== room);
    if (left.length > 0) this.byKind.set(room.kindName, left);
    else this.byKind.delete(room.kindName);
  }

  *all(): Iterable<Room> {
    for (const copies of this.byKind.values()) yield* copies;
  }

  /** The rooms with work at this tick, as they are when it begins: each is off the list once its tick finds none left. */
  busy(): readonly Room[] {
    return [...this.working];
  }
}
