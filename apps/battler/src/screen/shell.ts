/**
 * Crab #8's Was Never Here on the table, in five beats (`LOOK-BAR.md`):
 *
 * 1. Wind-up (`LOOKS.crab8.wind`): it stops and pulls its legs in (the `crouch` body).
 * 2. The catch (the step it goes off): one hard cut and it is a shut shell on its hex (its cast
 *    picture, held while it hides: `inShell`); gold corners on the enemy with the least health.
 * 3. Dread (the rules' own second): the table dims to the marked one; the shell rocks once; the
 *    marked one shrinks and shakes.
 * 4. Release (the step it lands): a hard cut and it is beside them (`cut` in its look), one pinch,
 *    the clock held, a bump. If they fall, a second hard cut puts it beside the next.
 * 5. Aftermath: it stands half off its new hex; the hex it left keeps a wet print for a second
 *    (`litter.ts`).
 *
 * Whoever it marked is who had the least health as it went in; the rules pick again as it comes
 * up, and it comes up beside whoever they pick.
 */
import type { Ctx } from "@sequoia-leaf/kit/util.ts";
import type { Fight, FightEvent, UnitKind } from "@sequoia-leaf/raid";

import { clockNow, face, fightNow, FOOT, FV } from "./board.ts";
import { calling } from "./call.ts";
import type { Pt } from "./geometry.ts";
import { fateOf, hangs, type Hung, stillCaught } from "./hung.ts";
import { leave } from "./litter.ts";
import { LOOKS } from "./looks.ts";
import type { Actor } from "./motion.ts";
import { snd } from "./sounds.ts";
import { dimRound, goldCorners, hushing } from "./spells.ts";
import { V } from "./stage.ts";

interface Shell {
  readonly fight: Fight;
  readonly by: number;
  readonly to: number;
  readonly hung: Hung;
  rocked: boolean;
  readonly land: () => void;
}
const shells: Shell[] = [];

/** Whether a figure hides as its own shut shell (drawn as its cast picture), rather than going to ground. */
export const inShell = (kind: UnitKind): boolean => LOOKS[kind]?.lands === "shell";

/** Shuts it in its shell from step `at`, marking whoever it is for, to land `ticks` steps on with `land`. */
export function hangShell(ev: Extract<FightEvent, { t: "cast" }>, at: number, land: () => void): void {
  const fight = fightNow();
  const a = FV.actors[ev.id];
  const to = ev.targets[0] ?? -1;
  const caught = FV.actors[to];
  if (!fight || !a || !caught) return land();
  const hung = hangs(at, ev.ticks);
  a.castUntil = hung.lands;
  caught.dread = { from: at + 1, until: hung.lands };
  shells.push({ fight, by: ev.id, to, hung, rocked: false, land });
}

/** Comes up on a hard cut: simply there, out of its shell, facing whoever it came for; the hex it left is wet a moment. */
export function cutTo(a: Actor, from: Pt, to: Pt, at: number): void {
  leave("print", from);
  face(a, FV.actors[a.unit.target]);
  a.x = to.x;
  a.y = to.y;
  a.move = null;
  a.castUntil = Math.min(a.castUntil, at);
  a.landAt = at;
  snd.leap();
}

/** Lands what is due, rocks each shell once halfway, and forgets what has landed or will never. */
export function stepShells(c: number): void {
  for (const s of shells.splice(0)) {
    const fate = s.fight === fightNow() ? fateOf(s.hung, c, s.fight) : "never";
    const caught = FV.actors[s.to];
    if (fate !== "hangs") {
      if (caught) caught.dread = null;
      if (fate === "lands") s.land();
      continue;
    }
    shells.push(s);
    const a = FV.actors[s.by];
    if (a && !s.rocked && c >= (s.hung.at + s.hung.lands) / 2) {
      s.rocked = true;
      a.shy = { from: c, until: c + 4, dir: a.left ? -1 : 1 };
    }
  }
}

/** Whoever is marked, while they are still under it: their feet on the screen; null for nobody. */
function marked(s: Shell, c: number): { x: number; y: number } | null {
  const a = FV.actors[s.to];
  if (!a || !stillCaught(s.hung, a.fallAt, c)) return null;
  return { x: Math.round(V.bx + a.x), y: Math.round(V.by + a.y) };
}

/** The dark round whoever is marked, under everyone standing on the table; none while a seal or a call has it dark. */
export function drawShellsUnder(g: Ctx): void {
  const c = clockNow();
  const s = hushing() || calling() ? undefined : shells.find((x) => x.fight === fightNow());
  const at = s ? marked(s, c) : null;
  if (s && at) dimRound(g, at.x, at.y - FOOT, 14, 10, (c - s.hung.at) / 3);
}

/** The gold corners round whoever is marked, over everyone. */
export function drawShells(g: Ctx): void {
  const c = clockNow();
  for (const s of shells) {
    const at = s.fight === fightNow() ? marked(s, c) : null;
    if (at) goldCorners(g, at.x, at.y, c - s.hung.at);
  }
}
