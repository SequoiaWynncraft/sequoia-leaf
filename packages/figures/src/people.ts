/**
 * Who each banner's people are, kept by banner id: one store a page, read by everything on it that
 * shows them (the town's camp and its Grove, the raid's table). A page tells it which banners Leaf's
 * latest answer has open (`see`, from the era of each view it is given, `bannersIn`); whenever one
 * of those has no people kept, it asks Leaf (`GET /v1/game/banners`), one question at a time, and
 * again as soon as that is answered if more banners opened while it was out. So a page left open
 * across a banner's opening learns who its people are from its next view, with no reload.
 *
 * A banner drawn from a member's skin whose headliner Leaf has not named yet (its rows not put in)
 * counts as having nobody, and is asked about again at most once a minute while it stays that way.
 */
import { type Answer, ask, outside } from "@sequoia-leaf/kit/net.ts";
import { type BannerPerson, readBanners } from "@sequoia-leaf/pulls/wire.ts";
import { BANNERS } from "@sequoia-leaf/raid/content/banners.ts";
import type { Catalog } from "@sequoia-leaf/raid/content/catalog.ts";

/** How long a banner still without its people waits before Leaf is asked about it again. */
export const ASK_AGAIN = 60_000;

/** The banners open in a catalogue's era, as Leaf's view of it says: what a page tells the store it sees. */
export const bannersIn = (cat: Catalog): readonly string[] => cat.banners.map((b) => b.id);

export interface People {
  /** Leaf's latest answer has these banners open: asks Leaf for the people of any that has none kept. */
  see(open: readonly string[]): void;
  /** Every banner's people kept, as Leaf last said them. */
  people(): readonly BannerPerson[];
  /** Hears each time Leaf has said who a banner's people are. */
  onChange(fn: () => void): void;
  /** Asks Leaf now, whatever is kept (a staged test world that has just changed them): done once answered. */
  again(): Promise<void>;
}

/** A store for a page: `askLeaf` asks Leaf for the banners and their people, `now` is the page's clock (for the minute's wait only). */
export function makePeople(askLeaf: () => Promise<Answer>, now: () => number): People {
  const kept = new Map<string, BannerPerson>();
  const seen = new Set<string>();
  const hearers: (() => void)[] = [];
  /** The question out; whether banners were seen first while it was; when Leaf was last asked. */
  const line: { out: Promise<void> | null; grew: boolean; at: number } = {
    out: null,
    grew: false,
    at: Number.NEGATIVE_INFINITY,
  };

  /** Whether a banner has nobody kept: none said, or a member's banner with no headliner named yet. */
  const nobody = (id: string): boolean => {
    const said = kept.get(id);
    return said === undefined || (said.headliner === null && BANNERS.find((b) => b.id === id)?.look === "skin");
  };

  async function answered(): Promise<void> {
    const said = await askLeaf();
    const heard = said.status === 200 ? readBanners(said.body) : null;
    for (const b of heard ?? []) kept.set(b.id, b);
    line.out = null;
    if (heard) for (const fn of hearers) fn();
    // Banners opened while it was out: asked about at once.
    if (line.grew) pump(true);
  }
  function asking(): Promise<void> {
    line.grew = false;
    line.at = now();
    line.out = answered();
    return line.out;
  }
  function pump(grew: boolean): void {
    if (![...seen].some(nobody)) return;
    if (line.out) {
      line.grew ||= grew;
      return;
    }
    if (grew || now() - line.at >= ASK_AGAIN) void asking();
  }

  return {
    see(open) {
      const before = seen.size;
      for (const id of open) seen.add(id);
      pump(seen.size > before);
    },
    people: () => [...kept.values()],
    onChange: (fn) => void hearers.push(fn),
    async again() {
      // One out was asked before the change; the one after it, if any, was asked since.
      if (line.out) await line.out;
      await (line.out ?? asking());
    },
  };
}

/** The page's store: asked of Leaf as the page's views say banners are open. */
export const PEOPLE: People = makePeople(
  () => ask("/v1/game/banners"),
  () => outside.now(),
);
