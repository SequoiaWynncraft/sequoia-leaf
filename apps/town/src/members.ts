/**
 * A banner's member in a camp: a thing (`member-<banner>`) that has the member's name and is drawn
 * as the town draws them. Who they are and how they look is the page's store's to know (`PEOPLE`,
 * worn by `wearPeople`); here the camp's thing takes each answer.
 */
import { wearPeople } from "@sequoia-leaf/figures/member.ts";
import { PEOPLE, type People } from "@sequoia-leaf/figures/people.ts";
import { memberThing, thingOf } from "@sequoia-leaf/town/things.ts";

import type { CampArt } from "./campart.ts";

export const nameMembers = (art: Pick<CampArt, "stand">, store: People = PEOPLE): void =>
  wearPeople(store, (banner, name, body) => {
    const thing = thingOf(memberThing(banner));
    if (!thing) return;
    // The catalogue's own record, so that everything that names the thing names the person.
    thing.name = name;
    art.stand(thing.id, body);
  });
