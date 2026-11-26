/**
 * A banner's member in a camp: a thing (`member-<banner>`) that has the member's name and is drawn
 * as the town draws them. Who they are and how they look is asked of Leaf once for every page that
 * shows one (`meetMembers`); here the camp's thing takes each answer.
 */
import { meetMembers } from "@sequoia-leaf/figures/member.ts";
import { memberThing, thingOf } from "@sequoia-leaf/town/things.ts";

import type { CampArt } from "./campart.ts";

export const nameMembers = (art: Pick<CampArt, "stand">): Promise<void> =>
  meetMembers((banner, name, body) => {
    const thing = thingOf(memberThing(banner));
    if (!thing) return;
    // The catalogue's own record, so that everything that names the thing names the person.
    thing.name = name;
    art.stand(thing.id, body);
  });
