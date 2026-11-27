import { type Device, LIVE_VERSION } from "@sequoia-leaf/core";

import { Allowance } from "../allowance.ts";
import type { Identity } from "../api/api.ts";
import { type Link, NO_LINK } from "./lifecycle.ts";
import type { Pipe } from "./pipe.ts";
import type { Occupant, Room } from "./room.ts";

/**
 * Allowances, as a steady rate a second and a burst, all the player's own, kept across their
 * connections: moves, texts, actions within the texts, connections opened, and strikes (frames over
 * an allowance or that cannot be read; with none left, the connection is closed).
 */
const MOVES = { rate: 30, burst: 40 } as const;
const TEXTS = { rate: 8, burst: 20 } as const;
const ACTS = { rate: 3, burst: 6 } as const;
const OPENS = { rate: 0.1, burst: 10 } as const;
/**
 * Openings that hand a player over between their own pages (`handsOver`: the town and a game open in
 * it, a reload): a few at once and one every two seconds, besides the openings proper. One past it
 * is charged as an opening proper; openings that fail, are refused or drop never hand over.
 */
const HANDOFFS = { rate: 0.5, burst: 10 } as const;
const STRIKES = { rate: 1, burst: 200 } as const;

/** Where a player is in Live: in no room, or in one as its occupant, with what stops them hearing it. */
export type Place =
  | { readonly at: "none" }
  | { readonly at: "room"; readonly room: Room; readonly occupant: Occupant; readonly hearing: () => void };
export const NOWHERE: Place = { at: "none" };

/**
 * A player in Live: who they are, their place in a room, their allowances, their presence connection
 * now, and their listener, if one is open (`listen.ts`: a connection in no room, beside the presence
 * one, that only hears what Leaf tells the player). A player outlives their connections: a new
 * presence one (after a drop, or from another tab) takes over the same place, and the room never
 * notices. A player with no connection stays, standing, for a grace
 * period, and then leaves the room. Their record is kept for as long as anything is left of them: a
 * connection, a place, or an allowance not yet filled up again, so that leaving and coming back
 * never refills one.
 */
export class Player {
  identity: Identity;
  /** Where they are: in no room, or in one as its occupant, hearing what Leaf tells it (`Watchers`). */
  place: Place = NOWHERE;
  /** Their presence connection: none, open, or gone a moment ago, in their grace (`lifecycle.ts` moves it). */
  link: Link<Pipe> = NO_LINK;
  /** Their listener, while one is open: no grace, no room, and no part of their presence. */
  listener: Pipe | null = null;
  /** Connections of theirs let in and not yet open: while there are any, the record is theirs. */
  opening = 0;
  /** What their connection's page said it is on, if it did. */
  device: Device | null = null;
  /** When Leaf was last told they did something here (`Visits.acted`), now and then. */
  actedTold = Number.NEGATIVE_INFINITY;
  readonly moves: Allowance;
  readonly texts: Allowance;
  readonly acts: Allowance;
  readonly opens: Allowance;
  readonly handoffs: Allowance;
  readonly strikes: Allowance;

  constructor(identity: Identity, now: number) {
    this.identity = identity;
    this.moves = new Allowance(MOVES, now);
    this.texts = new Allowance(TEXTS, now);
    this.acts = new Allowance(ACTS, now);
    this.opens = new Allowance(OPENS, now);
    this.handoffs = new Allowance(HANDOFFS, now);
    this.strikes = new Allowance(STRIKES, now);
  }

  /** Their connection, while one is open. */
  get pipe(): Pipe | null {
    return this.link.state === "open" ? this.link.pipe : null;
  }

  /** The version of the wire their connection's page speaks; with none, the newest, as nothing is sent. */
  get speaks(): number {
    return this.pipe?.speaks ?? LIVE_VERSION;
  }

  /** The room's outbox for this player: whichever connection they have now, or none; says whether one took the frame. */
  send(frame: string | Uint8Array): boolean {
    return this.pipe?.send(frame) ?? false;
  }

  /** Their connection now, for a room's snapshot (`Outbox`). */
  connection(): Pipe | null {
    return this.pipe;
  }

  /** Something of the player's own, on every connection they have open; says whether any took it. */
  tell(frame: string): boolean {
    const heard = this.send(frame);
    return (this.listener?.send(frame) ?? false) || heard;
  }

  /** Whether nothing is left of them: no connection, opening, open or in its grace, no listener, no place, and nothing owed on any allowance. */
  gone(now: number): boolean {
    return (
      this.opening === 0 &&
      this.link.state === "none" &&
      this.listener === null &&
      this.place.at === "none" &&
      [this.moves, this.texts, this.acts, this.opens, this.handoffs, this.strikes].every((a) => a.full(now))
    );
  }
}
