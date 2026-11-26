/**
 * Who each banner's member is. A banner's headliner is a member Leaf names (`GET /v1/game/banners`);
 * in a camp they are a thing (`member-<banner>`) that has their name and is drawn as the town draws
 * them: from their own skin, or as their made-up look until it comes and for a member with none.
 * Every page asks, so a visitor sees who it is too. Until Leaf answers, and for a banner with
 * nobody, the thing is "A guild member": a person all of one dusk colour, since who it is is not
 * known and any other face or clothes would be somebody else's.
 */
import { ask } from "@sequoia-leaf/kit/net.ts";
import { SKY } from "@sequoia-leaf/kit/palette.ts";
import { bake, type Look, lookFor, paintSkin, skinFigure } from "@sequoia-leaf/kit/skin.ts";
import { readBanners } from "@sequoia-leaf/pulls/wire.ts";
import { isMemberThing, memberThing, thingOf, THINGS } from "@sequoia-leaf/town/things.ts";

import type { CampArt } from "./campart.ts";

/** Nobody yet: a person all of one dusk colour, with the figure's own dark edge. */
const DUSK = SKY[2];
const NOBODY: Look = {
  skin: DUSK,
  hair: DUSK,
  light: DUSK,
  eye: DUSK,
  top: DUSK,
  legs: DUSK,
  shoes: DUSK,
  style: "short",
  sleeves: "long",
};

export async function nameMembers(art: Pick<CampArt, "stand">): Promise<void> {
  const nobody = bake(paintSkin(NOBODY));
  for (const { id } of THINGS) if (isMemberThing(id)) art.stand(id, nobody);
  for (const { id, headliner } of readBanners((await ask("/v1/game/banners")).body) ?? []) {
    const thing = thingOf(memberThing(id));
    if (!thing || !headliner) continue;
    // The catalogue's own record, so that everything that names the thing names the person.
    thing.name = headliner.name;
    art.stand(thing.id, bake(paintSkin(lookFor(headliner.name))));
    skinFigure(headliner.id, (skin) => art.stand(thing.id, skin));
  }
}
