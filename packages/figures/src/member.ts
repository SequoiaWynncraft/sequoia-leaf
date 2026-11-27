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
import { type Banner, BANNERS } from "@sequoia-leaf/raid/content/banners.ts";
import { catalogAt } from "@sequoia-leaf/raid/content/catalog.ts";
import { figureIn } from "@sequoia-leaf/raid/content/figures.ts";
import { isMemberId, type MemberId } from "@sequoia-leaf/raid/content/members.ts";
import { LAST_ERA } from "@sequoia-leaf/raid/content/releases.ts";

import { wear } from "./sprites.ts";

/**
 * Asks Leaf who each banner's member is. `seen` hears of each one every time they are better known:
 * at once as nobody yet, then by name in their made-up look, then in their own skin once it has
 * come. By then the raid's figure of them (`framesOf`, `nameOf`) is the same person.
 */
export async function meetMembers(seen: (banner: string, name: string, body: Body) => void): Promise<void> {
  const known = (banner: string, figure: MemberId, name: string, body: Body): void => {
    wear(figure, name, body);
    seen(banner, name, body);
  };
  const nobody = bake(paintSkin(NOBODY));
  // Until Leaf says who each is, a banner's member goes by its figure's name, as the catalogue with every release open has it.
  for (const { id } of BANNERS) {
    const figure = memberOf(id, BANNERS);
    if (figure) known(id, figure, figureIn(catalogAt(LAST_ERA), figure).name, nobody);
  }
  // Leaf says who by the banner; the figure they are is the one that banner names, whatever its id.
  for (const { id, headliner } of readBanners((await ask("/v1/game/banners")).body) ?? []) {
    const figure = memberOf(id, BANNERS);
    if (!headliner || !figure) continue;
    const { name } = headliner;
    known(id, figure, name, bake(paintSkin(lookFor(name))));
    skinFigure(headliner.id, (body) => known(id, figure, name, body));
  }
}

/** The figure a banner names as its headliner, when it is drawn from a member's skin; null for any other banner. */
export function memberOf(banner: string, rows: readonly Banner[]): MemberId | null {
  const row = rows.find((b) => b.id === banner);
  return row?.look === "skin" && isMemberId(row.headliner) ? row.headliner : null;
}
