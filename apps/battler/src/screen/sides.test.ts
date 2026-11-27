import { afterEach, expect, test } from "bun:test";

import { foughtOf, planRoom, SENSIBLE } from "@sequoia-leaf/raid";
import { mirror } from "@sequoia-leaf/raid/hex.ts";
import { advance } from "@sequoia-leaf/raid/sitting/clock.ts";
import { type Call, command, openSitting } from "@sequoia-leaf/raid/sitting/commands.ts";
import { CHAIRS, seatsIn, sideOf, type Sitting } from "@sequoia-leaf/raid/sitting/sitting.ts";
import { sittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { FV, shownCell } from "./board.ts";
import { playbackOf } from "./screen.ts";
import { acrossOf, OWN, ownFirst, ownResult } from "./sides.ts";

const call = (now: number, seed: number, n: number): Call => ({
  now,
  seed,
  player: { id: `leaf-${n}`, name: `M${n}` },
});
const deadline = (t: Sitting): number => (t.stage.at === "over" ? t.stage.ended : t.stage.until);

/** Eight members at a sitting, each planning as the bot does, at its first sparring fight. */
function sparring(): Sitting {
  let t = openSitting(call(0, 21, 0));
  for (let n = 1; n < CHAIRS; n++) {
    const sat = command(t, { do: "sit" }, call(n, 21 + n, n));
    if (!sat.ok) throw new Error(sat.why);
    t = sat.sitting;
  }
  for (let guard = 0; guard < 200; guard++) {
    if (t.stage.at === "fight" && t.pairs.length > 0 && t.room === 2) return t;
    if (t.stage.at === "plan") {
      t = structuredClone(t);
      for (const { run } of seatsIn(t)) planRoom(run, SENSIBLE);
    }
    t = advance(t, deadline(t));
  }
  throw new Error("no sparring fight");
}

afterEach(() => {
  ownFirst();
  FV.ours = 0;
});

test("the away seat's fight plays as Leaf decided it, from the away seat's own side", () => {
  const t = sparring();
  let turned = 0;
  for (const [home, away] of t.pairs) {
    const seat = t.seats[away];
    const view = sittingView(t, seat?.who.is === "member" ? seat.who.id : null);
    const run = view.run;
    const fought = run ? foughtOf(run) : null;
    if (!seat || !run || !fought) throw new Error("no fight");
    // Read as the solo table reads a fight, the away run's outcome is the other side's.
    ownFirst();
    if (fought.outcome.result !== "draw") {
      expect(playbackOf(run, fought, 0).kept).toBe(false);
      turned++;
    }
    OWN.side = (setup) => sideOf(setup, seat.who);
    expect(OWN.side(fought.setup)).toBe(1);
    expect(playbackOf(run, fought, 0).kept).toBe(true);
    expect(acrossOf(fought.setup).by).toBe(`leaf-${home}`);
    const home0 = t.seats[home]?.run;
    const decided = home0 ? foughtOf(home0)?.outcome.result : null;
    expect(ownResult(fought.setup, decided ?? "draw")).toBe(fought.outcome.result);
  }
  expect(turned).toBeGreaterThan(0);
});

test("with the member on the second side the board is drawn turned round", () => {
  FV.ours = 0;
  expect(shownCell(3)).toBe(3);
  FV.ours = 1;
  expect(shownCell(3)).toBe(mirror(3));
  expect(shownCell(mirror(40))).toBe(40);
});
