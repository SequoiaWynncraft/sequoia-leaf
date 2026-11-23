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

/** Where a room sends what it has to say to one of the people in it: the player, whichever connection they have now. */
export interface Outbox {
  send(frame: string | Uint8Array): void;
}

/** Somebody in a room: who they are, their latest motion, and whether it has changed since the room last said. */
export interface Occupant {
  readonly member: LiveMember;
  readonly outbox: Outbox;
  /** What the room shows of them, moved only by `moved`, `halted`, `reconnected` and `told`. */
  shown: Shown;
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

/** Somebody shown walking stops where they are, and everybody is to be told; anybody else stays as they are. */
export const halted = (shown: Shown): Shown =>
  shown.state === "seen" && (shown.motion.flags & Flag.Moving) !== 0
    ? {
        ...shown,
        motion: { ...shown.motion, vx: 0, vy: 0, flags: shown.motion.flags & ~Flag.Moving },
        changed: true,
      }
    : shown;

/** Somebody's game has a new connection: whatever it counts its jumps from, its first move is one. */
export const reconnected = (shown: Shown): Shown => (shown.state === "seen" ? { ...shown, heard: null } : shown);

/** Everybody has been told where somebody is. */
export const told = (shown: Shown): Shown =>
  shown.state === "seen" && shown.changed ? { ...shown, changed: false } : shown;

/**
 * One copy of a room: who is in it and where. It is plain state, changed by one thing at a time, and
 * says what it has to say through each occupant's outbox: who came and went and what they did, as
 * it happens, and everyone's changed motion once a tick (`flush`), made once for all of them. In a
 * still room (a visit's) it says only who came and went.
 */
export class Room {
  readonly occupants = new Map<number, Occupant>();
  /** The kind and the copy, as `town/1`. */
  readonly name: string;
  /** The kind alone, as `town`. */
  readonly kindName: string;
  readonly kind: RoomKind;
  private lastId = 0;

  constructor(kindName: string, copy: number, kind: RoomKind) {
    this.kindName = kindName;
    this.name = `${kindName}/${copy}`;
    this.kind = kind;
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
    const occupant: Occupant = { member: { id, ...who }, outbox, shown: { state: "unseen" } };
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
    const roster = [...this.occupants.values()].map((each) => each.member);
    o.outbox.send(text({ t: "welcome", v: version, you: o.member.id, room: this.name, hz, time, roster }));
    const everyone = this.entries(() => true);
    if (everyone.length > 0) o.outbox.send(encodeSnapshot(0, time, everyone));
  }

  /** Lets somebody go, and tells everyone else. */
  leave(id: number): void {
    if (!this.occupants.delete(id)) return;
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
    return next.went;
  }

  /** Somebody's game has a new connection: whatever it counts its jumps from, its first move is one. */
  reconnected(id: number): void {
    const o = this.occupants.get(id);
    if (o) o.shown = reconnected(o.shown);
  }

  /**
   * Everybody shown walking whose game has sent no move for `QUIET_MS` by `time` stops where they
   * are, as `halt` stops them: a page that has stopped drawing its player (a hidden tab) never leaves
   * them walking on the spot for everybody else. Their next move walks them on.
   */
  quiet(time: number): void {
    for (const o of this.occupants.values())
      if (o.shown.state === "seen" && time - o.shown.movedAt >= QUIET_MS) o.shown = halted(o.shown);
  }

  /** Somebody has stopped where they are, as when their connection drops: everyone sees them stand. */
  halt(id: number): void {
    const o = this.occupants.get(id);
    if (o) o.shown = halted(o.shown);
  }

  /** Tells everyone else what somebody did; in a still room, nobody. */
  act(id: number, kind: string, arg: string): void {
    if (!this.occupants.has(id) || this.kind.still === true) return;
    this.others(id, text({ t: "act", id, kind, arg }));
  }

  /** Sends everyone the motion that changed since the last tick, if any did, in one snapshot made once. */
  flush(tick: number, time: number): boolean {
    const changed = this.entries((shown) => shown.changed);
    if (changed.length === 0) return false;
    for (const o of this.occupants.values()) o.shown = told(o.shown);
    const frame = encodeSnapshot(tick, time, changed);
    for (const o of this.occupants.values()) o.outbox.send(frame);
    return true;
  }

  private entries(which: (shown: Extract<Shown, { state: "seen" }>) => boolean): Entry[] {
    const out: Entry[] = [];
    for (const o of this.occupants.values()) {
      if (o.shown.state !== "seen" || !which(o.shown)) continue;
      out.push({ id: o.member.id, seq: o.shown.seq, ...o.shown.motion });
    }
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

/**
 * Every copy of every room. A player asks for a kind of room and is put in the first copy with
 * space, or a new one; a copy is closed when its last player leaves, and its number used again.
 */
export class Rooms {
  private readonly byKind = new Map<string, Room[]>();

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
    const room = new Room(kindName, n, kind);
    this.byKind.set(
      kindName,
      [...copies, room].toSorted((a, b) => a.name.localeCompare(b.name, "en", { numeric: true })),
    );
    return room;
  }

  /** Closes a copy nobody is in. */
  tidy(room: Room): void {
    if (room.size > 0) return;
    const left = (this.byKind.get(room.kindName) ?? []).filter((r) => r !== room);
    if (left.length > 0) this.byKind.set(room.kindName, left);
    else this.byKind.delete(room.kindName);
  }

  *all(): Iterable<Room> {
    for (const copies of this.byKind.values()) yield* copies;
  }
}
