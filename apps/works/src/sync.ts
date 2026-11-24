/**
 * The page's link to Leaf for its yard, as one value (`Link`) moved by one function (`step`).
 *
 * - `closed`: nothing opened yet (or let go, in tests). Nothing is sent.
 * - `inStep`: Leaf's play is open and the copy is Leaf's yard; each command sent waits in `sent`
 *   for Leaf's answer, with the copy's tick and check just after it.
 * - `givingWay`: the copy must give way to Leaf's yard (a check that differs, a command Leaf turned
 *   down, a tab away, another page of the owner's acting). It takes no input and stands still; what
 *   was sent is still answered; Leaf's yard is asked for (`asked`, once nothing is on its way), and
 *   when it is read the copy becomes it (`took`). `differs` is the tick at which the copy was found
 *   not to be Leaf's yard, for Leaf to log as a fault, when it was one.
 * - `ended`: play has ended (signed out, Leaf will not have it). Nothing more is sent or run.
 *
 * Leaf's yard read while in step (`took`) is taken too: the kit reads it of itself after a minute
 * without a call (`STILL_HERE`), and a read is always Leaf's yard as it is.
 *
 * Nothing here reads the yard, the clock or the network: `yard.ts` hands in what happened.
 */

import type { Trouble } from "@sequoia-leaf/kit/play.ts";

/** A command sent and not answered yet: the copy's tick and check just after it was done. */
export interface Sent<C> {
  readonly command: C;
  readonly tick: number;
  readonly check: number;
}

export type Link<L, C> =
  | { readonly is: "closed" }
  | { readonly is: "inStep"; readonly leaf: L; readonly sent: readonly Sent<C>[] }
  | {
      readonly is: "givingWay";
      readonly leaf: L;
      readonly sent: readonly Sent<C>[];
      readonly since: number;
      readonly asked: number;
      readonly differs: number | undefined;
    }
  | { readonly is: "ended"; readonly why: Trouble };

export type LinkEvent<L, C> =
  /** Leaf's play opened, with Leaf's yard read. */
  | { readonly do: "open"; readonly leaf: L }
  /** A command done on the copy and handed to the kit. */
  | { readonly do: "send"; readonly sent: Sent<C> }
  /** Leaf answered these commands. */
  | { readonly do: "answered"; readonly commands: readonly C[] }
  /** The copy must give way to Leaf's yard (at `now`); `differs`, the tick it was found not Leaf's, for a fault. */
  | { readonly do: "giveWay"; readonly now: number; readonly differs?: number }
  /** Leaf's yard was asked for. */
  | { readonly do: "ask"; readonly now: number }
  /** Leaf's yard was read, and the copy became it. */
  | { readonly do: "took" }
  /** Play has ended. */
  | { readonly do: "end"; readonly why: Trouble }
  /** Everything let go. */
  | { readonly do: "close" };

export function step<L, C>(l: Link<L, C>, e: LinkEvent<L, C>): Link<L, C> {
  switch (e.do) {
    case "open":
      return { is: "inStep", leaf: e.leaf, sent: [] };
    case "close":
      return { is: "closed" };
    case "end":
      return { is: "ended", why: e.why };
    case "send":
      return l.is === "inStep" ? { ...l, sent: [...l.sent, e.sent] } : l;
    case "answered":
      return l.is === "inStep" || l.is === "givingWay"
        ? { ...l, sent: l.sent.filter((s) => !e.commands.includes(s.command)) }
        : l;
    case "giveWay":
      if (l.is === "inStep") return { ...l, is: "givingWay", since: e.now, asked: -Infinity, differs: e.differs };
      return l.is === "givingWay" ? { ...l, differs: e.differs ?? l.differs } : l;
    case "ask":
      return l.is === "givingWay" ? { ...l, asked: e.now } : l;
    case "took":
      return l.is === "givingWay" ? { is: "inStep", leaf: l.leaf, sent: l.sent } : l;
  }
}

/** Leaf's play, while the link has one. */
export const leafOf = <L, C>(l: Link<L, C>): L | null => (l.is === "inStep" || l.is === "givingWay" ? l.leaf : null);

/** How often Leaf is asked for its yard while it is being taken, until it has come. */
export const ASK_EVERY = 2000;

/** Whether Leaf's yard should be asked for now: while giving way, once nothing is on its way, and no sooner than `ASK_EVERY` after the last. */
export const askDue = <L, C>(l: Link<L, C>, now: number, waiting: boolean): boolean =>
  l.is === "givingWay" && !waiting && now - l.asked >= ASK_EVERY;

/**
 * Where a page is in the yard's room on Leaf (`joinVisit`), where Leaf tells each batch it keeps of
 * the yard: not in it (none to join, or let go: signed in elsewhere since), waiting for it (opening,
 * or open again after a drop and not welcomed yet), or in it, hearing every batch.
 */
export type Room<R> =
  { readonly is: "out" } | { readonly is: "waiting"; readonly room: R } | { readonly is: "live"; readonly room: R };

export type RoomEvent<R> =
  | { readonly do: "join"; readonly room: R | null }
  | { readonly do: "welcome" }
  | { readonly do: "status"; readonly status: "connecting" | "open" | "closed" | "replaced" | "signedout" }
  | { readonly do: "leave" };

export function roomStep<R>(r: Room<R>, e: RoomEvent<R>): Room<R> {
  switch (e.do) {
    case "join":
      return e.room === null ? { is: "out" } : { is: "waiting", room: e.room };
    case "leave":
      return { is: "out" };
    case "welcome":
      return r.is === "out" ? r : { is: "live", room: r.room };
    case "status":
      if (r.is === "out" || e.status === "open") return r;
      // Let go for good: signed in elsewhere since, or signed out.
      if (e.status === "replaced" || e.status === "signedout") return { is: "out" };
      return { is: "waiting", room: r.room };
  }
}
