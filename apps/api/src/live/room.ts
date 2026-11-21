import {
  encodeSnapshot,
  type Entry,
  Flag,
  type LiveMember,
  type Motion,
  type RoomKind,
  roomKind,
  seqAfter,
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
  motion: Motion | null;
  seq: number;
  dirty: boolean;
}

/** The fastest a motion may say a player moves, in the room's units a second. */
const MOST_SPEED = 1024;

const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n));

/**
 * One copy of a room: who is in it and where. It is plain state, changed by one thing at a time, and
 * says what it has to say through each occupant's outbox: who came and went and what they did, as
 * it happens, and everyone's changed motion once a tick (`flush`), made once for all of them.
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
    const occupant: Occupant = { member: { id, ...who }, outbox, motion: null, seq: 0, dirty: false };
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
   * Takes somebody's motion, kept inside the room and below the fastest anybody moves. A move older
   * than the one already taken (they can arrive out of order only across a reconnect) is dropped.
   * Only the newest motion counts: it is all of where they are, jumps included.
   */
  move(id: number, seq: number, m: Motion): boolean {
    const o = this.occupants.get(id);
    if (!o) return false;
    if (o.motion !== null && !seqAfter(seq, o.seq)) return false;
    o.motion = {
      x: clamp(m.x, 0, this.kind.width),
      y: clamp(m.y, 0, this.kind.height),
      vx: clamp(m.vx, -MOST_SPEED, MOST_SPEED),
      vy: clamp(m.vy, -MOST_SPEED, MOST_SPEED),
      facing: m.facing,
      pose: m.pose,
      flags: m.flags,
      jump: m.jump,
    };
    o.seq = seq;
    o.dirty = true;
    return true;
  }

  /** Somebody has stopped where they are, as when their connection drops: everyone sees them stand. */
  halt(id: number): void {
    const o = this.occupants.get(id);
    if (!o?.motion || (o.motion.flags & Flag.Moving) === 0) return;
    o.motion = { ...o.motion, vx: 0, vy: 0, flags: o.motion.flags & ~Flag.Moving };
    o.dirty = true;
  }

  /** Tells everyone else what somebody did. */
  act(id: number, kind: string, arg: string): void {
    if (!this.occupants.has(id)) return;
    this.others(id, text({ t: "act", id, kind, arg }));
  }

  /** Sends everyone the motion that changed since the last tick, if any did, in one snapshot made once. */
  flush(tick: number, time: number): boolean {
    const changed = this.entries((o) => o.dirty);
    if (changed.length === 0) return false;
    for (const o of this.occupants.values()) o.dirty = false;
    const frame = encodeSnapshot(tick, time, changed);
    for (const o of this.occupants.values()) o.outbox.send(frame);
    return true;
  }

  private entries(which: (o: Occupant) => boolean): Entry[] {
    const out: Entry[] = [];
    for (const o of this.occupants.values()) {
      if (o.motion === null || !which(o)) continue;
      out.push({ id: o.member.id, seq: o.seq, ...o.motion });
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
