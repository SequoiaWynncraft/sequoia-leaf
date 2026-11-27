/**
 * The raid page's live connection, held while the member has a live table or the Versus card up
 * (`hearLive`), opened as the town's page opens one (the kit's `joinLive`: it connects again after a
 * drop). It is into the room of the open tables (core's `SITTINGS_ROOM`), a listening one, so Leaf
 * holds it as the player's listener: beside their presence connection (the town's page around the
 * raid's frame, or in another tab), never replacing it nor replaced by it. On it Leaf says when the
 * open tables' list changed, and when the member's sitting moved on (core's `Nudge`). The page reads
 * what it is told of, then: nothing of a table travels on the connection.
 *
 * While the page is in the room (`hearing`), nothing is read on a timer but a stage's deadline; while
 * it is not (connecting, dropped, let go of, or with no Leaf), what is followed is read every
 * `POLL_EVERY`. Welcomed into the room, the first time and after every drop, the page has not heard
 * what was said meanwhile, and asks for what it follows to be read once (`onHearing`). When each is
 * read is its follower's to say (`follow.ts`).
 *
 * The page holds the connection a while after nothing wants it (`LINGER_MS`), so that going from card
 * to card opens nothing (Leaf allows a player only so many openings). Told another raid page of the
 * player's listens now (`replaced`), or that they signed out, it lets go, and opens no other: it
 * reads on the timer from then on.
 */
import { type Nudge, SITTINGS_ROOM } from "@sequoia-leaf/core";
import { outside } from "@sequoia-leaf/kit/net.ts";
import { joinLive, type LiveEars, type LiveRoom } from "@sequoia-leaf/kit/realtime.ts";

/** How often what is followed is read while the page is not in the room. */
export const POLL_EVERY = 5000;
/** How long the connection is held once nothing wants it. */
export const LINGER_MS = 10_000;

/** What opens the connection: the kit's, or a test's. */
export type Opens = (room: string, ears: LiveEars) => LiveRoom;

const H: {
  room: LiveRoom | null;
  /** Whether the page is in the room just now: welcomed, and not dropped since. */
  hearing: boolean;
  /** When nothing came to want the connection, by the page's clock; null while something does. */
  unwanted: number | null;
  /** Leaf said the player is live elsewhere, or signed out: no connection is opened again. */
  letGo: boolean;
  opens: Opens;
} = { room: null, hearing: false, unwanted: null, letGo: false, opens: joinLive };

const nudgeHearers: ((n: Nudge) => void)[] = [];
const hearingHearers: ((hearing: boolean) => void)[] = [];

/** Whether the page is in the room of the open tables just now, hearing what Leaf says. */
export const hearing = (): boolean => H.hearing;

/** Hears each nudge Leaf sends. */
export const onNudge = (fn: (n: Nudge) => void): void => void nudgeHearers.push(fn);
/** Hears the page come into the room (true: read what is followed once) and lose it (false: read on the timer). */
export const onHearing = (fn: (hearing: boolean) => void): void => void hearingHearers.push(fn);

function heard(now: boolean): void {
  if (H.hearing === now) return;
  H.hearing = now;
  for (const fn of hearingHearers) fn(now);
}

const ears: LiveEars = {
  welcome: () => heard(true),
  status(s) {
    if (s === "open") return;
    heard(false);
    if (s === "replaced" || s === "signedout") H.letGo = true;
  },
  nudged: (n) => {
    for (const fn of nudgeHearers) fn(n);
  },
};

/**
 * Whether the page wants the connection now: wanted, it is opened if it is not (unless let go of);
 * not, it is closed once nothing has wanted it for `LINGER_MS`.
 */
export function hearLive(wanted: boolean): void {
  const now = outside.now();
  if (wanted) {
    H.unwanted = null;
    if (!H.room && !H.letGo) H.room = H.opens(SITTINGS_ROOM, ears);
    return;
  }
  H.unwanted ??= now;
  if (H.room && now - H.unwanted >= LINGER_MS) {
    H.room.close();
    H.room = null;
    heard(false);
  }
}

/** For tests: the connection opened by `opens`, and nothing held or heard. */
export function hearFresh(opens: Opens = joinLive): void {
  H.room?.close();
  Object.assign(H, { room: null, hearing: false, unwanted: null, letGo: false, opens });
  nudgeHearers.length = 0;
  hearingHearers.length = 0;
}
