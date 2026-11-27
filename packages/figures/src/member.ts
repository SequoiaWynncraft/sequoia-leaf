/**
 * Who each banner's people are, for any page that shows one: the raid's table, where they are
 * figures, and the town, where they stand in a camp. A banner's member is a member Leaf names
 * (`GET /v1/game/banners`), and every page asks, so a visitor sees who it is too. A banner may name
 * more people than its headliner (`called`): Groot Night's grooters, whom the Commodore calls.
 *
 * They are drawn as the town draws anybody: from their own skin, or as their made-up look until it
 * comes and for a member with none. Until Leaf answers, and for a banner with nobody, they are
 * nobody yet (`NOBODY`), under the name the rules give their figure. A banner that shows its
 * headliner by a title (`shows: "title"`) keeps the rules' name and takes only the skin.
 */
import { ask } from "@sequoia-leaf/kit/net.ts";
import { bake, type Body, lookFor, NOBODY, paintSkin, skinFigure } from "@sequoia-leaf/kit/skin.ts";
import { readBanners } from "@sequoia-leaf/pulls/wire.ts";
import { type Banner, BANNERS } from "@sequoia-leaf/raid/content/banners.ts";
import { catalogAt } from "@sequoia-leaf/raid/content/catalog.ts";
import { figureIn, SUMMONS } from "@sequoia-leaf/raid/content/figures.ts";
import { isMemberId, type MemberId } from "@sequoia-leaf/raid/content/members.ts";
import { LAST_ERA } from "@sequoia-leaf/raid/content/releases.ts";

import { CALLED, type PersonId, wear } from "./sprites.ts";

/**
 * Asks Leaf who each banner's people are. `seen` hears of each banner's headliner every time they
 * are better known: at once as nobody yet, then by name in their made-up look, then in their own
 * skin once it has come. By then the raid's figure of them (`framesOf`, `nameOf`) is the same
 * person. The grooters a banner calls are worn the same way, and only the raid's table shows them.
 */
export async function meetMembers(seen: (banner: string, name: string, body: Body) => void): Promise<void> {
  const nobody = bake(paintSkin(NOBODY));
  const known = (banner: string, figure: MemberId, name: string, body: Body): void => {
    wear(figure, name, body);
    seen(banner, name, body);
  };
  // Until Leaf says who each is, everyone goes by their figure's name, as the catalogue with every release open has it.
  for (const { id } of BANNERS) {
    const figure = memberOf(id, BANNERS);
    if (figure) known(id, figure, ruleName(figure), nobody);
  }
  for (const id of CALLED) wear(id, SUMMONS[id].name, nobody);
  // Leaf says who by the banner; the figure they are is the one that banner names, whatever its id.
  for (const { id, headliner, called } of readBanners((await ask("/v1/game/banners")).body) ?? []) {
    const figure = memberOf(id, BANNERS);
    if (headliner && figure) {
      const name = shownName(id, figure, headliner.name);
      known(id, figure, name, bake(paintSkin(lookFor(headliner.name))));
      skinFigure(headliner.id, (body) => known(id, figure, name, body));
    }
    called.forEach((person, i) => {
      const grooter = CALLED[i];
      if (grooter) meet(grooter, person.id, person.name);
    });
  }
}

/** Has a person who is no headliner be a member from now on: their made-up look at once, their skin once it comes. */
function meet(figure: PersonId, id: string, name: string): void {
  wear(figure, name, bake(paintSkin(lookFor(name))));
  skinFigure(id, (body) => wear(figure, name, body));
}

/** What the rules call a member's figure, as the catalogue with every release open has it. */
const ruleName = (figure: MemberId): string => figureIn(catalogAt(LAST_ERA), figure).name;
/** What a banner's headliner is called: the member's name, or for a banner that shows a title, the rules' name for the figure. */
const shownName = (banner: string, figure: MemberId, member: string): string =>
  BANNERS.find((b) => b.id === banner)?.shows === "title" ? ruleName(figure) : member;

/** The figure a banner names as its headliner, when it is drawn from a member's skin; null for any other banner. */
export function memberOf(banner: string, rows: readonly Banner[]): MemberId | null {
  const row = rows.find((b) => b.id === banner);
  return row?.look === "skin" && isMemberId(row.headliner) ? row.headliner : null;
}
