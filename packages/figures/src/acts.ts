/**
 * What a person on a rig (`rig.ts`) does, as stances over time: standing, walking, throwing,
 * the three parts of an ability that is aimed and lands later (raising it, holding whoever it is
 * for, bringing it down), being hit, being dazed, falling, cheering. Each is a function of how far
 * through it is, in the steps of whatever clock its table keeps (twenty to a second), so the same
 * moment always gives the same stance and nothing here keeps anything.
 *
 * `aim` is the angle of the arm that points at somebody: 3 for somebody lower, 6 for somebody higher.
 */
import { REST, type Stance } from "./rig.ts";

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** Fast, then settling. */
const ease = (k: number): number => 1 - (1 - clamp(k, 0, 1)) ** 2;

/**
 * Standing: the head dips with each breath, the weight goes onto one foot for a while and comes
 * back, and the head turns to the side it leads with while it is `keen` (about to hit somebody).
 */
export function standing(c: number, left: boolean, phase: number, keen: boolean): Stance {
  const beat = (c / 24 + phase) % 1;
  const shift = (c / 140 + phase) % 1;
  const onOne = shift > 0.55 && shift < 0.9;
  return {
    ...REST,
    left,
    nod: beat > 0.7 ? 1 : 0,
    sway: onOne ? 1 : 0,
    offLeg: onOne ? 1 : 0,
    arm: onOne ? 1 : 0,
    turn: keen ? 1 : 0,
  };
}

/** Walking, seen from the side: arms and legs swing in turn, a stride every 8 steps, and the body dips as a foot comes down. */
export function walking(c: number, left: boolean): Stance {
  const swing = Math.sin((c / 8) * Math.PI * 2);
  const leg = Math.round(swing * 2);
  return {
    ...REST,
    view: "side",
    left,
    leg,
    offLeg: -leg,
    arm: -leg,
    offArm: leg,
    sink: Math.abs(swing) > 0.8 ? 1 : 0,
  };
}

/**
 * Throwing: the arm it leads with is drawn up and back (`k` from 0 to 1), comes down to point where
 * it throws as the thing leaves its hand (`since` 0), and is held out a moment before it drops.
 */
export function throwing(k: number, since: number, left: boolean, aim: number): Stance {
  if (since < 0) {
    const back = ease(k);
    return { ...REST, left, turn: 1, arm: Math.round(2 + 5 * back), offArm: 1, sway: back > 0.5 ? -1 : 0 };
  }
  if (since < 3) return { ...REST, left, turn: 1, arm: aim, offArm: 2, sway: 1, leg: 1 };
  return { ...REST, left, turn: 1, arm: Math.round(aim * (1 - ease((since - 3) / 4))), offArm: 1 };
}

/** Raising an ability: knees bent and head down, then both arms go up and out and the chin comes up. */
export function raising(k: number, left: boolean): Stance {
  const up = ease(k * 1.2);
  return {
    ...REST,
    left,
    arm: Math.round(6 * up),
    offArm: Math.round(6 * up),
    leg: k > 0.25 ? 1 : 0,
    offLeg: k > 0.25 ? 1 : 0,
    sink: k < 0.6 ? 1 : 0,
    nod: k < 0.5 ? 1 : k > 0.85 ? -1 : 0,
  };
}

/**
 * Holding whoever an ability is for until it lands: the arm it leads with snaps out to point at them
 * and stays there, shaking a little, while the other goes up over its head; `since` is the steps
 * since it pointed and `left` the steps until the ability lands. For the last three it rears back.
 */
export function holding(since: number, toGo: number, left: boolean, aim: number): Stance {
  const feet = { leg: 1, offLeg: 1 };
  if (toGo <= 3) return { ...REST, ...feet, left, turn: 1, arm: 6, offArm: 6, nod: -1, sway: -1 };
  const shake = since > 3 && Math.floor(since / 2) % 3 === 0 ? 1 : 0;
  return {
    ...REST,
    ...feet,
    left,
    turn: 1,
    arm: aim,
    offArm: since < 2 ? 4 : clamp(1 + Math.floor(since / 4), 1, 5),
    sway: since < 2 ? 2 : 1,
    sink: shake,
  };
}

/** Bringing it down: both arms come down in front and the knees give, then it straightens. */
export function slamming(since: number, left: boolean): Stance {
  if (since < 4) return { ...REST, left, turn: 1, arm: 1, offArm: 1, leg: 1, offLeg: 1, sink: 2, nod: 1, sway: 1 };
  return { ...REST, left, turn: 1, arm: 0, offArm: 0, sink: since < 8 ? 1 : 0, nod: since < 8 ? 1 : 0 };
}

/** Hit: knocked away from the blow (`left`: toward our left), arms thrown out and head back, then gathering itself. */
export function recoiling(since: number, left: boolean, hard: boolean): Stance {
  if (since < 2)
    return { ...REST, left, arm: hard ? 5 : 3, offArm: hard ? 4 : 3, nod: -1, sway: hard ? 2 : 1, offLeg: 1 };
  return { ...REST, left, arm: 1, offArm: 2, sway: 1, sink: hard ? 1 : 0 };
}

/** Dazed: swaying from one foot to the other with its head hung and lolling, arms loose. */
export function dazed(c: number): Stance {
  const at = Math.floor(c / 4) % 4;
  const over = at === 1 || at === 3;
  return {
    ...REST,
    left: at >= 2,
    nod: 1,
    turn: over ? 1 : 0,
    sway: over ? 1 : 0,
    arm: over ? 2 : 1,
    offArm: 1,
    sink: 1,
  };
}

/**
 * Falling: knocked off its feet with arms and legs flung out, over onto its back in the air with its
 * limbs going, and down, where they settle. `left` is the way it goes over.
 */
export function falling(since: number, left: boolean): Stance {
  if (since < 2) return { ...REST, left, arm: 5, offArm: 6, leg: 2, offLeg: 1, nod: -1, sway: 2 };
  if (since < 5) {
    const flail = Math.floor(since) % 2 === 0;
    return {
      ...REST,
      left,
      lie: true,
      arm: flail ? 6 : 3,
      offArm: flail ? 3 : 6,
      leg: flail ? 2 : 0,
      offLeg: flail ? 0 : 2,
    };
  }
  const still = since >= 7;
  return { ...REST, left, lie: true, arm: still ? 3 : 4, offArm: still ? 1 : 2, leg: 1, offLeg: still ? 0 : 1 };
}

/** Cheering: both arms up for as long as a hop lasts (`k` from 0 to 1). */
export function cheering(k: number, left: boolean): Stance {
  const up = k > 0.15 && k < 0.85;
  return { ...REST, left, arm: up ? 6 : 3, offArm: up ? 6 : 3, nod: up ? -1 : 0 };
}
