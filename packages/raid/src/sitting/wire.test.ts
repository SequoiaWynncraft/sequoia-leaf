import { describe, expect, test } from "bun:test";

import { planRoom, SENSIBLE } from "../bot.ts";
import { advance } from "./clock.ts";
import { type Call, command, openSitting } from "./commands.ts";
import { seatsIn, type Sitting } from "./sitting.ts";
import { sittingView } from "./view.ts";
import { readSittingView } from "./wire.ts";

const call = (now: number, seed: number): Call => ({ now, seed, player: { id: "leaf-1", name: "Mossback" } });
const deadline = (t: Sitting): number => (t.stage.at === "over" ? t.stage.ended : t.stage.until);

/** Every stage of a sitting of one member and seven regulars, the member planning as the bot does. */
function stages(): Sitting[] {
  const opened = openSitting(call(0, 7));
  const begun = command(opened, { do: "start" }, call(1000, 8));
  if (!begun.ok) throw new Error(begun.why);
  const all = [opened, begun.sitting];
  for (let guard = 0; guard < 400; guard++) {
    const now = structuredClone(all.at(-1) ?? begun.sitting);
    if (now.stage.at === "over") break;
    if (now.stage.at === "plan")
      for (const { who, run } of seatsIn(now)) if (who.is === "member") planRoom(run, SENSIBLE);
    all.push(advance(now, deadline(now)));
  }
  return all;
}
const STAGES = stages();
const wire = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

describe("a sitting's view off the wire", () => {
  test("reads back as it was sent, at every stage, for the member and for somebody not seated", () => {
    expect(new Set(STAGES.map((t) => t.stage.at))).toEqual(new Set(["open", "carousel", "plan", "fight", "over"]));
    for (const t of STAGES) {
      for (const viewer of ["leaf-1", null]) {
        const view = sittingView(t, viewer);
        expect(readSittingView(wire(view))).toEqual(view);
      }
    }
  });

  test("anything these rules could not have sent is null", () => {
    const view = wire(sittingView(STAGES[3] ?? openSitting(call(0, 1)), "leaf-1"));
    expect(readSittingView(null)).toBeNull();
    expect(readSittingView({ ...Object(view), you: 9 })).toBeNull();
    expect(readSittingView({ ...Object(view), run: null })).toBeNull();
    expect(readSittingView({ ...Object(view), stage: { at: "lunch", until: 1 } })).toBeNull();
    expect(readSittingView({ ...Object(view), seats: [{ name: "Greg" }] })).toBeNull();
  });
});
