import { describe, expect, test } from "bun:test";

import { type Party, type RaidNote, type RunView, startRun, wingOf } from "@sequoia-leaf/raid";

import { backLines, bossOfWing, ruleLine, ruleTitle, shiftedLine } from "./wilds.ts";

const party = (who: string, title: string, boss = false): Party => ({
  who,
  title,
  figures: [{ kind: boss ? "oldbramble" : "rock", stars: 1, seat: 3, items: [], fed: 0 }],
  boons: [],
  might: 100,
});
/** A run of the Wilds in a room (from 0), its last room fought against a party with a result. */
function runAt(room: number, across: Party | null, result: "win" | "loss" | "draw" = "loss"): RunView {
  const run = startRun(3, { endless: "wilds" });
  run.room = room;
  run.resolve = 9;
  run.stage = { phase: "plan", picks: [] };
  if (across) {
    run.record.push({ room: room - 1, kind: "spar", result, standing: [0, 2], boss: null });
    run.last = { seed: 1, sides: [party("You", ""), across] };
  }
  return run;
}

describe("the card that picks a run of the Wilds back up", () => {
  test("says where the run is in its wing, the wing's rule, the boss waiting, the best ever and the last room", () => {
    const run = runAt(36, party("Hodge", "brought Moss Fangs"));
    run.wing = { rule: "fog", at: wingOf(36), stumps: [] };
    expect(backLines(run, 44)).toEqual({
      where: "Room 37 of the wing ending at 40. Health 9.",
      rule: "Fog: No attack reaches further than 2 hexes.",
      boss: "The boss waiting: Swipe, room 40.",
      best: "Best ever: room 44.",
      last: "Last room: lost to Hodge's party.",
    });
  });
  test("before the first rule, with a rule to pick, and with none in an old run's wing, it says when one is picked", () => {
    expect(backLines(runAt(2, null), 0)).toMatchObject({
      rule: "After the boss in room 5, you pick a rule for each 5 rooms.",
      boss: "The boss waiting: Snag, room 5.",
      best: null,
      last: null,
    });
    const picking = runAt(5, party("Greg", "brought Mist Fangs"), "win");
    picking.stage = { phase: "plan", picks: [{ kind: "rule", options: ["fog", "long"] }] };
    expect(backLines(picking, 5)).toMatchObject({
      rule: "You pick the rule for rooms 6 to 10 next.",
      last: "Last room: won against Greg's party.",
    });
    expect(backLines(runAt(22, party("Nipper", "brought Ember Slingers"), "draw"), 22)).toMatchObject({
      rule: "No rule in these rooms. You pick one after the boss in room 25.",
      last: "Last room: a draw with Nipper's party.",
    });
    // A party kept under a regular's old signature, or a boss's old title, reads as it is called now.
    expect(backLines(runAt(22, party("a Barrow Gnome", "brought Moss Fangs")), 22).last).toBe(
      "Last room: lost to Hodge's party.",
    );
    expect(backLines(runAt(5, party("The forest", "Old Bramble", true)), 0).last).toBe("Last room: lost to Snag.");
  });
  test("names the forest's party by its plan: a boss by its name, the rest as words", () => {
    expect(backLines(runAt(8, party("The forest", "Gnats in the brambles")), 0).last).toBe(
      "Last room: lost to gnats in the brambles.",
    );
    expect(backLines(runAt(5, party("The forest", "Snag", true)), 0).last).toBe("Last room: lost to Snag.");
  });
});

describe("the rule's words", () => {
  test("a rule holds on the room's card only in its own wing", () => {
    const wing = { rule: "elbow" as const, at: 1, stumps: [] };
    expect(ruleLine({ room: 7, wing })).toBe(
      "Elbow Room: A figure that starts with no friend touching it has 30% more attack.",
    );
    expect(ruleLine({ room: 10, wing })).toBeNull();
    expect(ruleLine({ room: 7, wing: null })).toBeNull();
  });
  test("the pick is titled with its wing's rooms, and the boss beside it is the wing's last room's", () => {
    expect(ruleTitle(5)).toBe("A rule for rooms 6 to 10");
    expect(ruleTitle(35)).toBe("A rule for rooms 36 to 40");
    expect(bossOfWing(5)).toEqual({ room: 10, name: "Swipe", kind: "hoardmagpie" });
    expect(bossOfWing(10)).toEqual({ room: 15, name: "Zero", kind: "bigcrab" });
  });
  test("figures moved off closed hexes are named in one line", () => {
    const run = startRun(3, { endless: "wilds" });
    run.board[4] = { id: 50, kind: "rock", stars: 1, items: [], fed: 0 };
    run.bench[0] = { id: 51, kind: "finch", stars: 1, items: [], fed: 0 };
    const notes: RaidNote[] = [
      { t: "shifted", piece: 50, from: 0, to: { on: "board", at: 4 } },
      { t: "shifted", piece: 51, from: 6, to: { on: "bench", at: 0 } },
    ];
    expect(shiftedLine(notes, run)).toBe("Moved off closed hexes: Rock, Twig.");
    expect(shiftedLine([], run)).toBeNull();
  });
});
