/**
 * Live: players in the same place see each other move as it happens. This is the wire between the
 * game and Leaf, shared by both so that they cannot disagree about it.
 *
 * One WebSocket at `LIVE_PATH?v=<LIVE_VERSION>`. Two kinds of frame travel on it:
 *
 * - **Binary, the hot path.** A player's motion (`encodeMove`, 23 bytes) from the game, and the
 *   room's changes since the last tick (`encodeSnapshot`, 15 bytes and 24 a player) from Leaf. They
 *   are fixed-size, little-endian, and the first byte says which (`Op`).
 * - **Text, the cold path.** Everything else is a small JSON object with a `t`: joining and leaving a
 *   room, who is in it, clock pings, and actions (`ToServer`, `ToClient`).
 *
 * Why Leaf closes a connection is said by its close code alone (`CLOSE`).
 *
 * Motion is state, never an event: each frame says all of where a player is, and only the newest
 * counts. Even a jump is state, a counter that goes up by one each time (`jump`), so no later frame
 * can lose it. Positions are in a room's own units (the town's are its art pixels) and kept inside
 * its bounds. `facing`, `pose` and the high bits of `flags` are the game's to define: Leaf passes
 * them on.
 */

export const LIVE_PATH = "/v1/game/live";
/** The wire's version. Version 1 had no jump count, and no client ever spoke it. */
export const LIVE_VERSION = 2;

/** How often Leaf sends a room's changes, a second. */
export const SERVER_HZ = 30;
/** How often, at most, the game sends its player's motion, a second. */
export const CLIENT_HZ = 20;
/** How far behind the server's clock the game draws other players, in milliseconds, to have two snapshots to go between. */
export const INTERP_MS = 100;

/** What a binary frame is, by its first byte. */
export const Op = { Move: 1, Snapshot: 2 } as const;

/** What `flags` mean to Leaf; bits 1 to 7 are the game's. */
export const Flag = {
  /** The player is moving. */
  Moving: 1,
} as const;

/** Where a player is and how they are moving, in the room's units. */
export interface Motion {
  x: number;
  y: number;
  /** Units a second, for drawing them a little ahead when a snapshot is late. */
  vx: number;
  vy: number;
  facing: number;
  pose: number;
  flags: number;
  /**
   * How many times the player has jumped (came through a door, was set down), wrapping at 256: the
   * game counts its own player's; Leaf counts each player's for everybody else, from the game's
   * count and their connections. When it changes they are drawn where they are at once, not on the way.
   */
  jump: number;
}

/** A player's motion in a snapshot: their number in the room, and the last of their moves it is. */
export interface Entry extends Motion {
  id: number;
  seq: number;
}

export interface Snapshot {
  /** Leaf's tick, counting up. */
  tick: number;
  /** Leaf's clock when it was sent, in milliseconds since 1970. */
  time: number;
  entries: Entry[];
}

export const MOVE_BYTES = 23;
export const SNAPSHOT_HEAD_BYTES = 15;
export const ENTRY_BYTES = 24;

const u8 = (n: number): number => n & 0xff;
const u16 = (n: number): number => n & 0xffff;
const finite = (...ns: number[]): boolean => ns.every((n) => Number.isFinite(n));

function writeMotion(view: DataView, at: number, m: Motion): void {
  view.setFloat32(at, m.x, true);
  view.setFloat32(at + 4, m.y, true);
  view.setFloat32(at + 8, m.vx, true);
  view.setFloat32(at + 12, m.vy, true);
  view.setUint8(at + 16, u8(m.facing));
  view.setUint8(at + 17, u8(m.pose));
  view.setUint8(at + 18, u8(m.flags));
  view.setUint8(at + 19, u8(m.jump));
}

function readMotion(view: DataView, at: number): Motion | null {
  const x = view.getFloat32(at, true);
  const y = view.getFloat32(at + 4, true);
  const vx = view.getFloat32(at + 8, true);
  const vy = view.getFloat32(at + 12, true);
  if (!finite(x, y, vx, vy)) return null;
  return {
    x,
    y,
    vx,
    vy,
    facing: view.getUint8(at + 16),
    pose: view.getUint8(at + 17),
    flags: view.getUint8(at + 18),
    jump: view.getUint8(at + 19),
  };
}

const viewOf = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** The game's move: its number for it (counting up, wrapping at 65536) and its player's motion. */
export function encodeMove(seq: number, m: Motion): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(MOVE_BYTES);
  const view = viewOf(bytes);
  view.setUint8(0, Op.Move);
  view.setUint16(1, u16(seq), true);
  writeMotion(view, 3, m);
  return bytes;
}

/** A move, or null for anything that is not exactly one (another length, another op, a number that is not finite). */
export function decodeMove(bytes: Uint8Array): { seq: number; motion: Motion } | null {
  if (bytes.byteLength !== MOVE_BYTES || bytes[0] !== Op.Move) return null;
  const view = viewOf(bytes);
  const motion = readMotion(view, 3);
  return motion === null ? null : { seq: view.getUint16(1, true), motion };
}

/** A room's changes since the last tick, made once and sent to everyone in it. */
export function encodeSnapshot(tick: number, time: number, entries: readonly Entry[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(SNAPSHOT_HEAD_BYTES + entries.length * ENTRY_BYTES);
  const view = viewOf(bytes);
  view.setUint8(0, Op.Snapshot);
  view.setUint32(1, tick >>> 0, true);
  view.setFloat64(5, time, true);
  view.setUint16(13, entries.length, true);
  let at = SNAPSHOT_HEAD_BYTES;
  for (const e of entries) {
    view.setUint16(at, u16(e.id), true);
    view.setUint16(at + 2, u16(e.seq), true);
    writeMotion(view, at + 4, e);
    at += ENTRY_BYTES;
  }
  return bytes;
}

/** A snapshot, or null for anything that is not exactly one. */
export function decodeSnapshot(bytes: Uint8Array): Snapshot | null {
  if (bytes.byteLength < SNAPSHOT_HEAD_BYTES || bytes[0] !== Op.Snapshot) return null;
  const view = viewOf(bytes);
  const count = view.getUint16(13, true);
  if (bytes.byteLength !== SNAPSHOT_HEAD_BYTES + count * ENTRY_BYTES) return null;
  const time = view.getFloat64(5, true);
  if (!Number.isFinite(time)) return null;
  const entries: Entry[] = [];
  for (let i = 0, at = SNAPSHOT_HEAD_BYTES; i < count; i++, at += ENTRY_BYTES) {
    const motion = readMotion(view, at + 4);
    if (motion === null) return null;
    entries.push({ id: view.getUint16(at, true), seq: view.getUint16(at + 2, true), ...motion });
  }
  return { tick: view.getUint32(1, true), time, entries };
}

// ---------- the cold path ----------

/**
 * The actions there are: each kind, and the arguments it takes. Only these are passed on, so that
 * nothing a player types, not even a word spelt out in a token, reaches anybody else. A place that
 * wants a new action adds it here.
 */
export const ACTS: Readonly<Record<string, readonly string[]>> = {
  emote: ["wave", "cheer", "bow", "laugh", "heart", "sit", "dance", "crab"],
};

/** Whether an action is one there is (`ACTS`). */
export const isAct = (kind: string, arg: string): boolean =>
  Object.hasOwn(ACTS, kind) && (ACTS[kind] ?? []).includes(arg);

/** What the game sends as text. */
export type ToServer =
  /** Puts the player in a room of this kind (`ROOMS`), leaving any other. */
  | { t: "join"; room: string }
  | { t: "leave" }
  /** Something the player did that others in the room see once, one of `ACTS`: an emote, a wave. */
  | { t: "act"; kind: string; arg: string }
  /** The game's clock, for Leaf to send back with its own (`pong`). */
  | { t: "ping"; c: number };

/** Somebody in a room. `id` is their number in it, the one their motion carries. */
export interface LiveMember {
  id: number;
  /** Their block-game account's id. */
  player: string;
  name: string;
  /** Their rank in the guild as the guild writes it; null for a guest or anybody without one. */
  rank: string | null;
  guest: boolean;
}

/** Why a connection closed, as its close code says; the game acts on the code alone. */
export const CLOSE = {
  /** The game closed it. */
  done: 1000,
  /** The game sent too much Leaf could not read, or too much too fast. */
  policy: 1008,
  /** A frame over 4 KiB. */
  tooBig: 1009,
  /** Leaf is restarting, as in a deploy, or turned the game away for a moment: reconnect soon. */
  restart: 1012,
  /** The player opened the game live somewhere else: do not reconnect from here. */
  replaced: 4001,
  /** The player's session ended (signed out, revoked): do not reconnect until they sign in again. */
  signedOut: 4003,
} as const;

/** Whether the game should try again after a connection closed with this code. */
export const reconnects = (code: number): boolean => code !== CLOSE.replaced && code !== CLOSE.signedOut;

/** What Leaf sends as text. */
export type ToClient =
  | {
      t: "welcome";
      v: number;
      /** The player's own number in the room. */
      you: number;
      /** The room, with its copy: `town/1`. */
      room: string;
      hz: number;
      /** Leaf's clock, in milliseconds since 1970. */
      time: number;
      /** Everybody in the room, the player too. A snapshot of everyone's motion follows. */
      roster: LiveMember[];
    }
  | { t: "joined"; member: LiveMember }
  | { t: "left"; id: number }
  | { t: "act"; id: number; kind: string; arg: string }
  | { t: "pong"; c: number; s: number }
  | { t: "error"; code: "unknown_room" | "not_in_room" | "bad_act" };

/** What a kind of room is: how far it reaches, and how many fit in one copy of it before another is opened. */
export interface RoomKind {
  width: number;
  height: number;
  capacity: number;
}

/** The rooms there are. Each place that wants its players live adds itself here. */
export const ROOMS: Readonly<Record<string, RoomKind>> = {
  town: { width: 512, height: 352, capacity: 32 },
};

/** The kind of room a name asks for, if there is one. */
export function roomKind(name: string): RoomKind | undefined {
  return Object.hasOwn(ROOMS, name) ? ROOMS[name] : undefined;
}

// ---------- reading text frames ----------

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === "string";

function readMember(v: unknown): LiveMember | null {
  if (!record(v) || !num(v.id) || !str(v.player) || !str(v.name) || typeof v.guest !== "boolean") return null;
  if (v.rank !== null && !str(v.rank)) return null;
  return { id: v.id, player: v.player, name: v.name, rank: v.rank, guest: v.guest };
}

const ERRORS = ["unknown_room", "not_in_room", "bad_act"] as const;

/** What Leaf sent as text, or null for anything that is not one of its messages. */
export function readToClient(text: string): ToClient | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!record(v)) return null;
  switch (v.t) {
    case "welcome": {
      if (!num(v.v) || !num(v.you) || !str(v.room) || !num(v.hz) || !num(v.time) || !Array.isArray(v.roster))
        return null;
      const roster = v.roster.map(readMember);
      if (roster.some((m) => m === null)) return null;
      return {
        t: "welcome",
        v: v.v,
        you: v.you,
        room: v.room,
        hz: v.hz,
        time: v.time,
        roster: roster.filter((m) => m !== null),
      };
    }
    case "joined": {
      const member = readMember(v.member);
      return member ? { t: "joined", member } : null;
    }
    case "left":
      return num(v.id) ? { t: "left", id: v.id } : null;
    case "act":
      return num(v.id) && str(v.kind) && str(v.arg) ? { t: "act", id: v.id, kind: v.kind, arg: v.arg } : null;
    case "pong":
      return num(v.c) && num(v.s) ? { t: "pong", c: v.c, s: v.s } : null;
    case "error": {
      const code = ERRORS.find((c) => c === v.code);
      return code ? { t: "error", code } : null;
    }
    default:
      return null;
  }
}
