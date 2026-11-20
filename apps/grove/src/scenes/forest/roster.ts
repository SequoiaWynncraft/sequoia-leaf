/**
 * A made-up guild of seventy members for the lab. Every name is invented; none is a real player.
 *
 * The levels follow the real guild's shape: about half at level 1, the 90th percentile at level 5
 * and one member at the top, level 10. Members are listed oldest first. Tenure and level go
 * together loosely, as they do in a real guild: a few early members are still seedlings, and a few
 * newer ones have shot up.
 */

import { type StageName, stageOf } from "../../game/stages.ts";

export interface Member {
  name: string;
  /** The tree's seed: the member, so a member always grows the same tree. */
  seed: string;
  level: number;
  /** 0 is the guild's oldest member. */
  tenure: number;
  stage: StageName;
}

const OLDEST_FIRST: readonly (readonly [string, number])[] = [
  ["mossbeard", 10],
  ["Tealwick", 8],
  ["Bramblewood", 9],
  ["quietkettle", 7],
  ["SorrelFox", 6],
  ["Lanternmoth", 1],
  ["oakenshy", 7],
  ["Wrenfeather", 5],
  ["pinecrumb", 6],
  ["mapleglow", 5],
  ["Fernmuddle", 2],
  ["Hollowpip", 5],
  ["lichenlad", 4],
  ["CinderPip", 5],
  ["ripplestone", 3],
  ["acornstack", 5],
  ["Brooklet_", 1],
  ["sprucecap", 4],
  ["Emberwisp", 5],
  ["Toadstool77", 3],
  ["MarshMellow", 5],
  ["bluebell_k", 4],
  ["Thistlebun", 4],
  ["Puddlejump", 1],
  ["knotholes", 3],
  ["Sapwood", 5],
  ["nettlecake", 2],
  ["Glimmerroot", 4],
  ["Rootbeer_", 3],
  ["Duskwhistle", 2],
  ["mosslight", 4],
  ["pebblequill", 1],
  ["Juniperjam", 3],
  ["Cloudberry9", 2],
  ["Owlet", 1],
  ["tinderbox_", 3],
  ["Hazelnutz", 2],
  ["Stumpy_", 1],
  ["leafletter", 2],
  ["Barkbiscuit", 1],
  ["ferrous_fern", 1],
  ["Kettlecorn", 2],
  ["Mudlarkk", 1],
  ["snailmail", 1],
  ["Thimbleweed", 1],
  ["Willowisp_", 2],
  ["Copperkettle", 1],
  ["Pinewhistle", 1],
  ["shadeberry", 1],
  ["Burrowbun", 1],
  ["Drizzlecat", 1],
  ["cedarsmoke", 1],
  ["Teacakes", 1],
  ["Bogwaddle", 1],
  ["fireflyjar", 1],
  ["Driftmoss", 1],
  ["Honeycomb_", 1],
  ["lumenotter", 1],
  ["Riverpebble", 1],
  ["Sporeling", 1],
  ["Quillfeather", 1],
  ["Cobblecrab", 1],
  ["Mapletoffee", 1],
  ["gingerroot", 1],
  ["Starmoss", 1],
  ["Bumblesap", 1],
  ["Lampwick", 1],
  ["Twigsnap", 1],
  ["Sundewdrop", 1],
  ["dewdrop42", 1],
];

export const ROSTER: readonly Member[] = OLDEST_FIRST.map(([name, level], tenure) => ({
  name,
  seed: name,
  level,
  tenure,
  stage: stageOf(level),
}));

export const stageLabel = (stage: StageName): string => stage[0]?.toUpperCase() + stage.slice(1);
