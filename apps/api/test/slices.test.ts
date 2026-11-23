import { describe, expect, it } from "bun:test";

import { type Asked, nextSlice } from "../src/play/slices.ts";

/** A state's job asking for slices: a player's or a tend, with when it came, and how many slices it has left. */
interface Asking extends Asked {
  readonly name: string;
  left: number;
}

/**
 * Runs the budget as the play service does: the slice chosen runs, and its state asks for its next
 * at the back, until each has had all it needs. Says whose each slice was, in order.
 */
function run(states: readonly Asking[], tendWaits = 3): string[] {
  const asks = [...states];
  const ran: string[] = [];
  let waited = 0;
  for (let turn = nextSlice(asks, waited, tendWaits); turn !== null; turn = nextSlice(asks, waited, tendWaits)) {
    waited = turn.waited;
    const [ask] = asks.splice(turn.index, 1);
    if (ask === undefined) throw new Error("No slice at that place");
    ran.push(ask.name);
    if (--ask.left > 0) asks.push(ask);
  }
  return ran;
}

const player = (name: string, seq: number, left: number): Asking => ({ name, tend: false, seq, left });
const tend = (name: string, seq: number, left: number): Asking => ({ name, tend: true, seq, left });

describe("the slices' budget", () => {
  it("runs nothing when nothing is asked for", () => {
    expect(nextSlice([], 0, 3)).toBeNull();
  });

  it("goes round the players' states, so one far behind does not keep a newer command waiting for all of it", () => {
    // Three yards catching up from their owners' opens, and a command behind them that needs one slice.
    const ran = run([player("a", 1, 6), player("b", 2, 6), player("c", 3, 6), player("d", 4, 1)]);

    expect(ran.indexOf("d")).toBe(3);
    expect(ran.join("")).toBe("abcdabcabcabcabcabc");
  });

  it("lets the tend that came first run after every three of the players' slices, and the next once it is done", () => {
    const ran = run([player("a", 5, 6), player("b", 6, 6), tend("T", 2, 2), tend("U", 1, 2)]);

    expect(ran.join("")).toBe("abaUbabUabaTbabT");
  });

  it("gives Leaf's own tends every slice while no player asks for one, one tend after another", () => {
    expect(run([tend("T", 2, 2), tend("U", 1, 3)]).join("")).toBe("UUUTT");
  });

  it("counts again from nothing once a tend has had its slice, or none waits", () => {
    expect(nextSlice([player("a", 1, 1), tend("T", 2, 1)], 3, 3)).toEqual({ index: 1, waited: 0 });
    expect(nextSlice([player("a", 1, 1), tend("T", 2, 1)], 2, 3)).toEqual({ index: 0, waited: 3 });
    expect(nextSlice([player("a", 1, 1)], 7, 3)).toEqual({ index: 0, waited: 0 });
  });
});
