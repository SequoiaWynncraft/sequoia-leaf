/** The gatherer on the page: a gnome in his grade's hat, at work on his deposit, with his basket, rake, barrow and cart. */
import { ALL_ITEMS, GATHER_WORK, isItem, isRaw, makes, NONE, WORK, type Yard } from "@sequoia-leaf/factory";
import { GREEN, WATER } from "@sequoia-leaf/kit/palette.ts";
import { perMinute } from "@sequoia-leaf/kit/say.ts";
import { hash, makeCanvas, must } from "@sequoia-leaf/kit/util.ts";

import { cart } from "../art/grade4.ts";
import { gathererHat } from "../art/hats.ts";
import type { Art } from "../art/index.ts";
import { itemRef } from "../ui/refs.ts";
import type { Drawn, KindPage } from "./kind.ts";

/**
 * His pose: asleep where power does not reach, lifting what he has out, else as far as his work on the
 * next has come, of the work in gathering what lies under him (`GATHER_WORK`: star crystal's own).
 */
export function poseOf(y: Yard, at: Pick<Drawn, "i" | "work" | "powered" | "out" | "working">): number {
  const p = at.work / (GATHER_WORK[y.land.deposit[at.i] ?? NONE] ?? WORK.gather);
  if (!at.powered) return 4;
  if (at.out !== NONE) return 3;
  if (!at.working) return 0;
  return p < 0.2 ? 0 : p < 0.4 ? 1 : p < 0.72 ? 2 : 3;
}

/**
 * His basket at his back, from the third grade a wheelbarrow in its place, out beside him, and at the
 * fourth an iron cart with a lilac lamp (`cart`); from the second, a rake stood in the ground on his other side.
 */
function tools(art: Art, at: Drawn, left: boolean): void {
  const { m } = art;
  const { x, foot, z, a } = at;
  if (at.look >= 2) {
    const own = left ? m.barrowLeft : m.barrow;
    const barrow = at.grade >= 4 ? cart(own, left) : own;
    at.put(barrow, left ? x + 11 : x + 5 - barrow.width, foot - barrow.height, z - 0.2, a);
  } else at.put(m.basket, left ? x + 15 - m.basket.width : x, foot - m.basket.height, z - 0.2, a);
  if (at.look > 0) at.stand(left ? m.rakeLeft : m.rake, x + (left ? 2 : 13), foot - 1, z - 0.1, a);
}

export const gatherer: KindPage = {
  // A gatherer in his grade's hat; of the second grade with his rake stood beside him, of the third his wheelbarrow too, of the fourth his cart.
  picture: ({ m }, grade) => {
    const gnome = must(m.gnome[gathererHat(grade)]?.[0], "gnome").c;
    if (grade < 2) return gnome;
    const barrow = grade >= 4 ? cart(m.barrow, false) : grade >= 3 ? m.barrow : null;
    const left = barrow ? barrow.width - 4 : 0;
    const { c, g } = makeCanvas(left + gnome.width + 5, gnome.height);
    if (barrow) g.drawImage(barrow, 0, gnome.height - barrow.height);
    g.drawImage(m.rake.c, left + gnome.width - 2, gnome.height - m.rake.c.height);
    g.drawImage(gnome, left, 0);
    return c;
  },
  draw(art, y, at) {
    const { i, foot, cx, z } = at;
    const left = at.d === 2 || (at.d !== 0 && hash(i, 4, 7) > 0.5);
    const pose = poseOf(y, at);
    const s = (left ? art.m.gnomeLeft : art.m.gnome)[gathererHat(at.grade)]?.[pose];
    if (!s) return foot - 16;
    at.stand(s, cx, foot - 1, z, at.a);
    tools(art, at, left);
    // What he has gathered, held up over his head.
    const carried = at.out !== NONE ? at.out : pose === 3 ? (y.land.deposit[i] ?? NONE) : NONE;
    let head = foot - 15;
    if (isItem(carried) && at.real) {
      const pic = art.item(carried);
      at.put(pic, cx - Math.floor(pic.width / 2), foot - 16 - pic.height, z + 0.1);
      head -= pic.height;
    }
    if (!at.powered) at.put(art.zed.c, cx + 3, foot - 19 - Math.round(Math.sin(at.t * 2) * 1.5), z + 0.3);
    return head;
  },
  pointer: "bare",
  sleeps: true,
  map: [WATER[2], WATER[0]],
  dot: GREEN[4],
  dock: 4,
  pace: (k, grade) => ({ label: "Gathers", value: perMinute(makes(k, grade, null)) }),
  // Standing, what it gathers now of what lies under it, at that thing's own pace (`rateOf`): a star
  // crystal gatherer is far slower than its kind's pace says.
  standing: { pace: (p) => ({ label: "Gathers", value: perMinute(p.rate ?? 0) }) },
  rows: () => [{ label: "Gathers", things: ALL_ITEMS.filter(isRaw).map((r) => ({ ref: itemRef(r) })) }],
  faces: true,
};
