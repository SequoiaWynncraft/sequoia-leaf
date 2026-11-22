/**
 * Whose statue each banner's is. A banner's headliner is a member Leaf names (`GET /v1/game/banners`);
 * their statue (`statue-<banner>`) is called "Statue of NAME" and carved from their own skin, on
 * every page, so a visitor sees whose it is too. A member with no skin of their own is carved as
 * the town draws them (their made-up look). Until Leaf answers, and for a banner with nobody, it
 * stays "A statue": an uncarved block.
 */
import { ask, isRecord } from "@sequoia-leaf/kit/net.ts";
import { bake, lookFor, paintSkin, skinOf } from "@sequoia-leaf/kit/skin.ts";
import { thingOf } from "@sequoia-leaf/town/things.ts";

import type { CampArt } from "./campart.ts";

export async function nameStatues(art: CampArt): Promise<void> {
  const { body } = await ask("/v1/game/banners");
  if (!isRecord(body) || !Array.isArray(body.banners)) return;
  for (const banner of body.banners) {
    if (!isRecord(banner) || !isRecord(banner.headliner)) continue;
    const { id, name } = banner.headliner;
    const thing = typeof banner.id === "string" ? thingOf(`statue-${banner.id}`) : null;
    if (!thing || typeof id !== "string" || typeof name !== "string") continue;
    // The catalogue's own record, so that everything that names the thing names the person.
    thing.name = `Statue of ${name}`;
    const carve = (sheet: Parameters<typeof bake>[0]): void => {
      const figure = bake(sheet).frames[0]?.[0];
      if (figure) art.carve(thing.id, figure);
    };
    // As the town draws them until their skin comes, and for good if they have none.
    carve(paintSkin(lookFor(name)));
    const img = new Image();
    img.addEventListener("load", () => {
      try {
        carve(img);
      } catch {
        // A picture that cannot be read: the statue stays as it was.
      }
    });
    img.src = skinOf(id);
  }
}
