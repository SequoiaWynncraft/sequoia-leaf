/**
 * Statuses starting and stopping on the table that are more than a puff: a crack, a Firewall's wall
 * and a pickaxe's halving as they start; a shield breaking, a wall going, and one hidden coming back
 * (down from the tree, up off its back, or out of the ground) as they stop; and going to ground.
 */
import { CREAM, EARTH, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import type { FightEvent } from "@sequoia-leaf/raid";

import { droppedDown } from "./canopy.ts";
import { burst } from "./fx.ts";
import { cracked } from "./litter.ts";
import { LOOKS } from "./looks.ts";
import type { Actor } from "./motion.ts";
import { snd } from "./sounds.ts";
import { wallDown, wallUp } from "./walls.ts";

type Status = Extract<FightEvent, { t: "status" }>;
const UP = -Math.PI / 2;

/** Statuses Up The Tree brings, and Grooter's crack: a wall goes up; armour halved, chips of stone come off it. */
export function treeStatus(a: Actor, ev: Status, at: number): void {
  if (ev.status === "cracked") cracked(a, ev.amount);
  else if (ev.status === "firewall") wallUp(ev.id, ev.by, at);
  else if (ev.status === "sundered") burst(a.x, a.y - 8, 6, [STONE[2], STONE[3], CREAM], { speed: 30, ttl: 0.35 });
}

/** A status stops: a shield breaks, a wall goes, one hidden comes back (down from the tree, up off its back, or out of the ground). */
export function statusOff(a: Actor, ev: Status, at: number): void {
  if (ev.status === "shield") burst(a.x, a.y - 9, 8, [WATER[3], CREAM], { speed: 34, ttl: 0.35 });
  else if (ev.status === "firewall") wallDown(ev.id);
  else if (ev.status !== "hidden") return;
  else if (droppedDown(a, at) || LOOKS[a.unit.kind]?.hides === "pose") a.hopAt = at;
  else {
    burst(a.x, a.y, 10, [EARTH[1], EARTH[2], EARTH[0]], { speed: 34, ttl: 0.45, toward: UP, spread: 2 });
    a.hopAt = at;
    snd.dig();
  }
}

/** Goes where nothing reaches it: to ground, unless it is up the tree as the fight opens or lies there as its own pose (Flop). */
export function hides(a: Actor, at: number): void {
  if (at < 0 || LOOKS[a.unit.kind]?.hides === "pose") return;
  burst(a.x, a.y, 10, [EARTH[1], EARTH[2], EARTH[0]], { speed: 30, ttl: 0.45, toward: UP, spread: 2 });
  snd.dig();
}
