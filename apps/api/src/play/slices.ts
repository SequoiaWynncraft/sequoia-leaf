/**
 * Which of the slices asked for runs next, in the play service's one budget of slices. Players'
 * slices go round: each state with one asked for gets one in its turn, in the order they were
 * asked for, so a state far behind cannot keep another's command waiting for all of its catching
 * up; one state's jobs ask one slice at a time, in the order they came. Leaf's own tends wait their
 * turn: the one that came first runs after every `tendWaits` of the players', and whenever no
 * player's is asked for.
 */

/** A slice asked for, as the budget weighs it: Leaf's own tend's, or a player's, and when its job came. */
export interface Asked {
  readonly tend: boolean;
  readonly seq: number;
}

/** The slice to run next (its place among those asked for), and how many players' slices a waiting tend has let go since. */
export interface Turn {
  readonly index: number;
  readonly waited: number;
}

/**
 * The next turn, from the slices asked for, in the order they were asked for, and how many players'
 * slices a waiting tend has let go (`waited`); null when none is asked for.
 */
export function nextSlice(asks: readonly Asked[], waited: number, tendWaits: number): Turn | null {
  let player = -1;
  let tend = -1;
  for (const [index, ask] of asks.entries()) {
    if (!ask.tend) {
      if (player < 0) player = index;
    } else if (tend < 0 || ask.seq < (asks[tend]?.seq ?? Infinity)) tend = index;
  }
  if (player < 0 && tend < 0) return null;
  const toTend = tend >= 0 && (player < 0 || waited >= tendWaits);
  return { index: toTend ? tend : player, waited: !toTend && tend >= 0 ? waited + 1 : 0 };
}
