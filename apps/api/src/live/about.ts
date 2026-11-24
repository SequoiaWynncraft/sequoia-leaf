import { aboutChange, type ToClient, type Who } from "@sequoia-leaf/core";

/** The first version of the wire whose pages are told what changed in who is about, not all of it each time. */
export const CHANGES_FROM = 3;

/** The frames for one change to who is about: all of the lists, numbered, and what changed in them. */
export interface AboutFrames {
  /** All of the lists, numbered (`about`): for a page of a version before `CHANGES_FROM`. */
  readonly whole: string;
  /**
   * What changed since the last lists told (`aboutChanged`), for any other; or all of them, the
   * first time, and whenever saying what changed would be longer.
   */
  readonly changed: string;
}

const say = (m: ToClient): string => JSON.stringify(m);

/**
 * Who is about, as Live has told the rooms of the game's places: the lists last told and their
 * number, one more each time. A page of version 3 has all of them as it comes into such a room, and
 * then each change numbered one more than the last, which it makes into the lists itself; so Live
 * keeps the lists it told last, to say what changed from them.
 */
export class AboutTold {
  private last: { readonly v: number; readonly who: Who; readonly whole: string } | null = null;

  /** All of the lists last told, numbered, as one frame; none before any were. */
  whole(): string | null {
    return this.last?.whole ?? null;
  }

  /** The lists to tell now: numbered one more than the last, as frames for each kind of page. */
  next(who: Who): AboutFrames {
    const before = this.last;
    const v = (before?.v ?? 0) + 1;
    const whole = say({ t: "about", v, who });
    this.last = { v, who, whole };
    const changed = before === null ? whole : say({ t: "aboutChanged", v, ...aboutChange(before.who, who) });
    return { whole, changed: changed.length < whole.length ? changed : whole };
  }
}
