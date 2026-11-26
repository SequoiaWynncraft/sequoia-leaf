/**
 * The banners' members: for each pull banner, a figure of the raid that is a guild member. It is
 * written like any figure (`figures.ts` puts these among `FIGURES`), and is nobody in particular
 * here: who a banner's member is comes from Leaf, and the page gives the figure their name and
 * their picture.
 *
 * It is not one of the twenty-eight (`FIGURE_IDS`): the main way never offers it, the regulars
 * never bring it and the almanac does not count it. Only a run with the member's own figures sells
 * it, to a member who has pulled it (`own.ts`).
 */
import type { FigureSpec } from "./figures.ts";

/** A banner's member is known by its banner's id, as the pull game knows the banner. */
export const MEMBER_IDS = ["banner-1"] as const;
export type MemberId = (typeof MEMBER_IDS)[number];
export const isMemberId = (v: unknown): v is MemberId => MEMBER_IDS.some((id) => id === v);

export const MEMBERS: Record<MemberId, FigureSpec> = {
  "banner-1": {
    name: "A guild member",
    tier: 5,
    kin: "feather",
    calling: "mender",
    extra: [],
    hp: 640,
    attack: 46,
    speed: 0.75,
    range: 3,
    armour: 30,
    ward: 35,
    mana: [20, 90],
    ability: {
      name: "On My Way",
      shape: "ally",
      text: "Runs over to the friend who is most hurt and stands by them: {heal} health back for the friend, and a shield of {shield} for {lasts} seconds on them both.",
      n: { heal: [260, 455, 1000], shield: [180, 315, 700], lasts: [4, 4, 4] },
      short: "Leaps to most hurt ally, heals {heal}. Shield {shield} for {lasts}s on both.",
    },
    quip: "One of the guild. Came as soon as they heard.",
  },
};
