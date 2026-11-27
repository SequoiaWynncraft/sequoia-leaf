/**
 * Who each banner's member is, for any page that shows one: the raid's table, where they are a
 * figure, and the town, where they stand in a camp. A banner's member is a member Leaf names
 * (`GET /v1/game/banners`), and every page asks, so a visitor sees who it is too.
 *
 * They are drawn as the town draws anybody: from their own skin, or as their made-up look until it
 * comes and for a member with none. Until Leaf answers, and for a banner with nobody, they are
 * "A guild member", nobody yet (`NOBODY`).
 */
import { ask } from "@sequoia-leaf/kit/net.ts";
import { bake, type Body, lookFor, NOBODY, paintSkin, skinFigure } from "@sequoia-leaf/kit/skin.ts";
import { readBanners } from "@sequoia-leaf/pulls/wire.ts";
import { BANNERS } from "@sequoia-leaf/raid/content/banners.ts";
import { specOf } from "@sequoia-leaf/raid/content/figures.ts";
import { isMemberId, type MemberId } from "@sequoia-leaf/raid/content/members.ts";

import { wear } from "./sprites.ts";

/**
 * Asks Leaf who each banner's member is. `seen` hears of each one every time they are better known:
 * at once as nobody yet, then by name in their made-up look, then in their own skin once it has
 * come. By then the raid's figure of them (`framesOf`, `nameOf`) is the same person.
 */
export async function meetMembers(seen: (banner: MemberId, name: string, body: Body) => void): Promise<void> {
  const known = (banner: MemberId, name: string, body: Body): void => {
    wear(banner, name, body);
    seen(banner, name, body);
  };
  const nobody = bake(paintSkin(NOBODY));
  for (const { headliner } of BANNERS) if (isMemberId(headliner)) known(headliner, specOf(headliner).name, nobody);
  for (const { id, headliner } of readBanners((await ask("/v1/game/banners")).body) ?? []) {
    if (!headliner || !isMemberId(id)) continue;
    const { name } = headliner;
    known(id, name, bake(paintSkin(lookFor(name))));
    skinFigure(headliner.id, (body) => known(id, name, body));
  }
}
