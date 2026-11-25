/**
 * How the pages say every number a player reads: core's `say.ts`, where the rules and Leaf's own
 * messages say them too, and a rate drawn. A page takes them from here.
 */
import { num, PER_MINUTE } from "@sequoia-leaf/core";

import { el } from "./dom.ts";

export { coinsText, duration, exact, num, PER_MINUTE, perMinute, whole } from "@sequoia-leaf/core";

/** A rate drawn: the number as `num` says it, then "/min" small, in a span of `classes`. */
export const perMinuteNode = (v: number, classes = ""): HTMLElement =>
  el("span", classes, {}, el("span", "k-name", { text: num(v) }), el("span", "k-s k-dim", { text: PER_MINUTE }));
