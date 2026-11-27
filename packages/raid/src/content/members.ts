/**
 * The banners' members: for each pull banner, a figure of the raid that is a guild member. It is
 * written like any figure (`figures.ts` puts these among the base's figures). Its rules are made for the
 * member the banner is about (the first banner's is gaz, whose line its ability is named after),
 * but the name and the picture are not kept here: who a banner's member is comes from Leaf, and
 * the page gives the figure their name and their picture.
 *
 * It is not one of the twenty-eight (`FIGURE_IDS`), and is one of everyone's figures only while its
 * banner is open (`Figure.everyones`): at any other time the main way never offers it, the regulars
 * never bring it and the almanac does not count it. A run with the member's own figures sells it only to a member who
 * has pulled it, at its level (`own.ts`).
 */
import type { FigureSpec } from "./figures.ts";

/**
 * The banners' members: the first is known by its banner's id, as the pull game knows the banner; a
 * later one by a title of its own (`commodore`, Groot Night's), never the member's name.
 */
export const MEMBER_IDS = ["banner-1", "commodore"] as const;
export type MemberId = (typeof MEMBER_IDS)[number];
export const isMemberId = (v: unknown): v is MemberId => MEMBER_IDS.some((id) => id === v);

/** The base's member, as the base release brought it; a later member comes with its banner's release (`releases/`). */
export const MEMBERS: Readonly<Partial<Record<MemberId, FigureSpec>>> = {
  "banner-1": {
    name: "A guild member",
    tier: 5,
    kin: "feather",
    calling: "sage",
    extra: [],
    hp: 680,
    attack: 44,
    speed: 0.75,
    range: 4,
    armour: 25,
    ward: 35,
    mana: [50, 80],
    ability: {
      name: "I heard you weren't graiding.",
      shape: "bolt",
      text: "Picks the enemy who has taken the least damage so far, wherever they are, and stuns them for {stun} seconds. If several have taken the same, it picks the one who has dealt the least. One second later, {damage} magic damage to them and to every enemy touching them.",
      n: { stun: [2, 2.5, 3.5], damage: [550, 950, 2200] },
      short: "Stuns enemy with least damage taken {stun}s. 1s later, {damage} magic to them and those touching.",
    },
    quip: "Keeps the guild raid list. Checks it twice.",
  },
};
