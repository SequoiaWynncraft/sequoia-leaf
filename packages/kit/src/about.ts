/**
 * Who is about as one live connection has it (core's `about.ts`): Leaf's lists, numbered, as the
 * page comes into a room of the town, and each change after, numbered one more, made into the next
 * lists. Each set is shown as if Leaf had sent it whole. A change that does not follow the lists the
 * connection has (a number missed) is let go, and Leaf is asked for all of them again; and asked
 * again by a later change that does not follow either, once `ABOUT_ASK_AGAIN` has passed since the
 * last ask (Leaf may not have taken one, from a page that sent too much just then), until they come.
 */

import { applyAbout, readWho, type ToClient, type Who } from "@sequoia-leaf/core";

import { outside } from "./net.ts";

/** Where what is heard goes: lists to show, as Leaf sends them whole, and asking Leaf for all of them. */
interface AboutEars {
  show(who: unknown): void;
  ask(): void;
}

/** How long after asking Leaf for all of who is about the page asks again, while changes go on not following, in milliseconds. */
export const ABOUT_ASK_AGAIN = 5000;

export class AboutHeard {
  /** The lists as last made, and their number; none until Leaf gives all of them, or after a change that did not follow. */
  private lists: { readonly v: number; readonly who: Who } | null = null;
  /** When Leaf was last asked for all of the lists (`outside.elapsed`), while it has not given them; null when it has not been asked. */
  private askedAt: number | null = null;
  private readonly ears: AboutEars;

  constructor(ears: AboutEars) {
    this.ears = ears;
  }

  /** Leaf's lists, all of them, numbered `v`: what the next change follows. */
  given(v: number, who: unknown): void {
    const lists = readWho(who);
    this.lists = lists === null ? null : { v, who: lists };
    this.askedAt = null;
    this.ears.show(who);
  }

  /** A change to the lists: shown made into the next lists if it follows those there are; else they are asked for whole, now and then. */
  changed(m: Extract<ToClient, { t: "aboutChanged" }>): void {
    const next = this.lists !== null && m.v === this.lists.v + 1 ? applyAbout(this.lists.who, m) : null;
    if (next !== null) {
      this.lists = { v: m.v, who: next };
      return this.ears.show(next);
    }
    this.lists = null;
    const now = outside.elapsed();
    if (this.askedAt !== null && now - this.askedAt < ABOUT_ASK_AGAIN) return;
    this.askedAt = now;
    this.ears.ask();
  }

  /** A welcome: what the connection knows of the room begins again, and Leaf gives the lists anew. */
  forget(): void {
    this.lists = null;
    this.askedAt = null;
  }
}
