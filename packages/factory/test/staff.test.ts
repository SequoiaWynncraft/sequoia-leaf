import { describe, expect, test } from "bun:test";

import { type Ctx, isRefused } from "@sequoia-leaf/core";

import * as F from "../src/index.ts";
import { near, xy } from "./near.ts";
import { buying, must } from "./yards.ts";

const ACTOR = { by: "10000000-0000-4000-8000-000000000004", name: "Dave" } as const;
const CTX: Ctx = {
  now: 1_800_000_000_000,
  player: { id: "10000000-0000-4000-8000-000000000001", guest: false },
  seed: 7,
  room: 1e9,
  awards: [],
  postcards: {},
};

const allTiles = (y: F.Yard): number[] => Array.from({ length: y.land.w * y.land.h }, (_, i) => i);

function runStaff(y: F.Yard, raw: Record<string, unknown>) {
  const cmd = F.readStaffCommand({ ...ACTOR, ...raw });
  if (cmd === null) throw new Error(`readStaffCommand rejected ${JSON.stringify(raw)}`);
  return F.FACTORY.apply(y, cmd, CTX);
}

describe("readCommand vs readStaffCommand", () => {
  const staffSamples: Record<string, unknown>[] = [
    { do: "learn", goals: ["felling"], ...ACTOR },
    { do: "plots", plots: ["meadow"], ...ACTOR },
    { do: "pieces", code: "wb1.x", x: 1, y: 2, turn: 0, replace: false, ...ACTOR },
    { do: "pieces", packed: "", replace: true, ...ACTOR },
    { do: "restore", yard: "{}", ...ACTOR },
  ];

  test("readCommand rejects every staff command, with or without tick and id", () => {
    for (const sample of staffSamples) {
      expect(F.readCommand(sample)).toBeNull();
      expect(F.readCommand({ ...sample, tick: 0 })).toBeNull();
      expect(F.readCommand({ ...sample, tick: 0, id: "c1" })).toBeNull();
    }
  });

  test("readStaffCommand rejects player commands and malformed payloads", () => {
    for (const bad of [
      { do: "collect", ...ACTOR },
      { do: "build", kind: "belt", x: 1, y: 1, dir: 0, ...ACTOR },
      { do: "learn", goals: [] as string[], ...ACTOR },
      { do: "learn", goals: ["felling"], name: "Dave" },
      { do: "plots", plots: [] as string[], ...ACTOR },
      { do: "pieces", replace: false, ...ACTOR },
      { do: "pieces", code: "wb1.x", packed: "", x: 0, y: 0, turn: 0, ...ACTOR },
      { do: "pieces", code: "wb1.x", x: 0, y: 0, turn: 4, ...ACTOR },
      { do: "restore", yard: "", ...ACTOR },
    ]) {
      expect(F.readStaffCommand(bad)).toBeNull();
    }
  });

  test("FACTORY.echo returns null for staff commands without throwing", () => {
    const y = F.create({ seed: 1 });
    for (const sample of staffSamples) {
      const cmd = F.readStaffCommand(sample);
      expect(cmd).not.toBeNull();
      if (cmd) expect(F.FACTORY.echo?.(y, cmd)).toBeNull();
    }
  });
});

function beltCode(count: number): string {
  const pieces: F.Piece[] = Array.from({ length: count }, (_, k) => ({
    kind: F.BELT,
    x: k,
    y: 0,
    dir: 0,
    span: 0,
  }));
  return F.packedCode(F.packPrint(F.packPieces(pieces)));
}

describe("staff learn", () => {
  test("marks goals and unmet transitive needs done in need order, clears line, pays nothing", () => {
    const y = F.create({ seed: 1, tier: 3 });
    must(y, { do: "study", research: "workshop" });
    must(y, { do: "study", research: "oilpress" });
    const tillBefore = y.till;
    const paidBefore = y.paid;

    const res = runStaff(y, { do: "learn", goals: ["tooling3"] });
    expect(isRefused(res)).toBe(false);
    if (isRefused(res)) return;

    expect(res.coins).toEqual([]);
    expect(res.log).toEqual([]);
    const note = F.readStaffNote(res.notes[0]);
    expect(note).not.toBeNull();
    // tooling3 needs tooling, which needs workshop: must appear in need order.
    expect(note?.goals).toEqual(["workshop", "tooling", "tooling3"]);
    expect(note?.cost).toBe(0);

    const next = res.state;
    expect(next.till).toBe(tillBefore);
    expect(next.paid).toBe(paidBefore);
    expect(next.line).not.toContain(F.goal("workshop"));
    // Unlearned research stays in line.
    expect(next.line).toContain(F.goal("oilpress"));
    // Reopen updated unlocked grades for mill/bench/workshop to 3.
    expect(next.open.kinds[F.MILL]).toBeGreaterThanOrEqual(3);
    expect(next.open.kinds[F.WORKSHOP]).toBeGreaterThanOrEqual(3);
  });

  test("removes learned nodes from hand and queue, and emits no works_story log on later commands", () => {
    const y = F.create({ seed: 1, tier: 4 });
    const handGoal = y.hand;
    expect(handGoal).not.toBe(-1);
    const handId = F.GOALS[handGoal]?.id ?? "";
    const queueId = "flags";
    must(y, { do: "queue", node: queueId });
    must(y, { do: "study", research: "tooling3" });
    must(y, { do: "study", research: "flywheel2" });

    const res = runStaff(y, { do: "learn", goals: [handId, queueId, "tooling3"] });
    expect(isRefused(res)).toBe(false);
    if (isRefused(res)) return;

    const next = res.state;
    expect(next.hand).toBe(-1);
    expect(next.queue).not.toContain(handGoal);
    expect(next.queue).not.toContain(F.goal(queueId));
    expect(next.line).not.toContain(F.goal("tooling3"));
    expect(next.line).toContain(F.goal("flywheel2"));

    // Subsequent player command must NOT emit works_story activity for staff-learned goals.
    const collect = F.FACTORY.command({ tick: next.tick, do: "collect" });
    expect(collect).not.toBeNull();
    if (collect) {
      const afterCollect = F.FACTORY.apply(next, collect, CTX);
      expect(isRefused(afterCollect)).toBe(false);
      if (!isRefused(afterCollect)) expect(afterCollect.log).toEqual([]);
    }
  });

  test("is idempotent when goals are already done", () => {
    const y = F.create({ seed: 1, tier: 4 });
    const res = runStaff(y, { do: "learn", goals: ["planks"] });
    expect(isRefused(res)).toBe(false);
    if (isRefused(res)) return;
    expect(F.readStaffNote(res.notes[0])?.goals).toEqual([]);
  });

  test("refuses unknown_goal and leaves yard untouched", () => {
    const y = F.create({ seed: 1 });
    const before = F.encode(y);
    const res = runStaff(y, { do: "learn", goals: ["planks", "not_a_goal"] });
    expect(res).toMatchObject({ refused: "unknown_goal" });
    expect(F.encode(y)).toBe(before);
  });
});

describe("staff plots", () => {
  test("grants ring-1 and ring-2 plots as owned and cleared, drops matching active clearing, reports cost without moving Coins", () => {
    const y = F.create({ seed: 2, tier: 5 });
    must(y, buying(y, "meadow"));
    must(y, { do: "clearPlot", plot: "workings" });
    expect(y.clearing?.plot).toBe(F.plot("workings"));

    const expectedCost =
      F.plotPrice(y, F.plot("stream")) +
      F.plotPrice(y, F.plot("workings")) +
      F.plotPrice({ land: y.land, plots: [...y.plots, F.plot("workings")] }, F.plot("ridge"));

    const res = runStaff(y, { do: "plots", plots: ["stream", "workings", "ridge"] });
    expect(isRefused(res)).toBe(false);
    if (isRefused(res)) return;

    expect(res.coins).toEqual([]);
    expect(res.log).toEqual([]);
    const note = F.readStaffNote(res.notes[0]);
    expect(note?.plots).toEqual(["stream", "workings", "ridge"]);
    expect(note?.cost).toBe(expectedCost);

    const next = res.state;
    expect(next.plots).toContain(F.plot("stream"));
    expect(next.plots).toContain(F.plot("workings"));
    expect(next.plots).toContain(F.plot("ridge"));
    // Ring-2 plots with clearings are marked cleared; ring-1 plot (stream) has no clearing.
    expect(next.cleared).toContain(F.plot("workings"));
    expect(next.cleared).toContain(F.plot("ridge"));
    expect(next.cleared).not.toContain(F.plot("stream"));
    expect(next.clearing).toBeNull();
    // Survives encode/decode roundtrip cleanly.
    const back = F.decode(F.encode(next));
    expect(back?.plots).toEqual(next.plots);
    expect(back?.cleared).toEqual(next.cleared);
  });

  test("refuses unknown_plot and leaves yard untouched", () => {
    const y = F.create({ seed: 2 });
    const before = F.encode(y);
    const res = runStaff(y, { do: "plots", plots: ["meadow", "atlantis"] });
    expect(res).toMatchObject({ refused: "unknown_plot" });
    expect(F.encode(y)).toBe(before);
  });
});

describe("staff pieces", () => {
  test("places a blueprint code at x,y with turn, fells redwoods under it, clears Undo history, free", () => {
    const y = F.create({ seed: 3, tier: 5 });
    must(y, buying(y, "meadow"));
    // Build a belt via player command so Undo history is non-empty.
    must(y, { do: "build", kind: "belt", ...near(2, 2), dir: 0 });
    expect(y.history.length).toBeGreaterThan(0);

    // (-2, 15) from depot is a redwood in Meadow!
    const [rx, ry] = xy(-2, 15);
    expect(F.redwoodAt(y, F.at(y, rx, ry))).toBe(true);
    const treeCost = F.fellPrice(y);

    const code = beltCode(3);
    const res = runStaff(y, { do: "pieces", code, x: rx, y: ry, turn: 1, replace: false });
    expect(isRefused(res)).toBe(false);
    if (isRefused(res)) return;

    expect(res.coins).toEqual([]);
    expect(res.log).toEqual([]);
    const note = F.readStaffNote(res.notes[0]);
    expect(note?.piecesBefore).toBe(1);
    expect(note?.piecesAfter).toBe(4);
    expect(note?.cost).toBeGreaterThanOrEqual(treeCost);

    const next = res.state;
    expect(next.history).toEqual([]);
    expect(F.redwoodAt(next, F.at(next, rx, ry))).toBe(false);
    // Turned 1 quarter right: 3 horizontal belts become 3 vertical belts facing south (dir 1).
    for (let dy = 0; dy < 3; dy++) {
      const i = F.at(next, rx, ry + dy);
      expect(next.kind[i]).toBe(F.BELT);
      expect(next.dir[i]).toBe(1);
    }
  });

  test("replace mode clears existing pieces first and accepts packed piece list", () => {
    const src = F.create({ seed: 4, tier: 4 });
    must(src, { do: "build", kind: "belt", ...near(2, 2), dir: 0 });
    must(src, { do: "build", kind: "belt", ...near(3, 2), dir: 0 });
    const packed = F.toBase64(F.packPrint(F.packPieces(F.piecesAt(src, allTiles(src)))));

    const dst = F.create({ seed: 5, tier: 4 });
    must(dst, { do: "build", kind: "mill", ...near(-3, -3), dir: 1 });
    expect(F.piecesAt(dst, allTiles(dst)).length).toBe(1);

    const res = runStaff(dst, { do: "pieces", packed, replace: true });
    expect(isRefused(res)).toBe(false);
    if (isRefused(res)) return;

    const note = F.readStaffNote(res.notes[0]);
    expect(note?.piecesBefore).toBe(1);
    expect(note?.piecesAfter).toBe(2);
    // Old mill is gone, new belts stand.
    expect(dst.kind[F.at(dst, ...xy(-3, -3))]).toBe(F.MILL); // original untouched
    expect(res.state.kind[F.at(res.state, ...xy(-3, -3))]).toBe(F.NONE);
    expect(res.state.kind[F.at(res.state, ...xy(2, 2))]).toBe(F.BELT);
    expect(res.state.kind[F.at(res.state, ...xy(3, 2))]).toBe(F.BELT);
  });

  test("refuses all error cases cleanly with plain codes and leaves yard untouched", () => {
    const y = F.create({ seed: 6, tier: 1 });
    must(y, { do: "build", kind: "mill", ...near(2, 2), dir: 0 });
    const before = F.encode(y);
    const code = beltCode(2);

    // invalid_code
    expect(runStaff(y, { do: "pieces", code: "not-a-code", x: 0, y: 0, turn: 0, replace: false })).toMatchObject({
      refused: "invalid_code",
    });
    // invalid_pieces
    expect(runStaff(y, { do: "pieces", packed: "!!!not-base64!!!", replace: false })).toMatchObject({
      refused: "invalid_pieces",
    });
    // empty_pieces when replace is false
    expect(runStaff(y, { do: "pieces", packed: "", replace: false })).toMatchObject({
      refused: "empty_pieces",
    });
    // off_land
    expect(runStaff(y, { do: "pieces", code, x: -5, y: 0, turn: 0, replace: false })).toMatchObject({
      refused: "off_land",
    });
    // plot_not_owned (top-left corner is an unowned outer plot)
    expect(runStaff(y, { do: "pieces", code, x: 0, y: 0, turn: 0, replace: false })).toMatchObject({
      refused: "plot_not_owned",
    });
    // on_depot
    const [dx, dy] = y.land.depot;
    expect(runStaff(y, { do: "pieces", code, x: dx, y: dy, turn: 0, replace: false })).toMatchObject({
      refused: "on_depot",
    });
    // on_water: find a water tile on the owned yard plot
    const yardPlot = y.land.plots.find((p) => p.plot === F.plot("yard"));
    let waterTile: [number, number] | null = null;
    if (yardPlot) {
      for (let z = yardPlot.y; z < yardPlot.y + yardPlot.h && !waterTile; z++) {
        for (let x = yardPlot.x; x < yardPlot.x + yardPlot.w; x++) {
          if (y.land.water[F.at(y, x, z)] === 1) {
            waterTile = [x, z];
            break;
          }
        }
      }
    }
    if (waterTile) {
      const single = beltCode(1);
      expect(
        runStaff(y, { do: "pieces", code: single, x: waterTile[0], y: waterTile[1], turn: 0, replace: false }),
      ).toMatchObject({ refused: "on_water" });
    }
    // occupied (non-replace onto existing mill)
    const [mx, my] = xy(2, 2);
    expect(runStaff(y, { do: "pieces", code: beltCode(1), x: mx, y: my, turn: 0, replace: false })).toMatchObject({
      refused: "occupied",
    });
    // overlap (two belts on the same tile in packed list)
    const [fx, fy] = xy(3, 3);
    const overlapping = F.toBase64(
      F.packPrint(
        F.packPieces([
          { kind: F.BELT, x: fx, y: fy, dir: 0, span: 0 },
          { kind: F.BELT, x: fx, y: fy, dir: 1, span: 0 },
        ]),
      ),
    );
    expect(runStaff(y, { do: "pieces", packed: overlapping, replace: false })).toMatchObject({
      refused: "overlap",
    });
    // locked (workshop not unlocked at tier 1)
    const lockedCode = F.packedCode(F.packPrint(F.packPieces([{ kind: F.WORKSHOP, x: 0, y: 0, dir: 0, span: 0 }])));
    expect(runStaff(y, { do: "pieces", code: lockedCode, x: fx, y: fy, turn: 0, replace: false })).toMatchObject({
      refused: "locked",
    });
    // cannot_place (gatherer on bare ground with no deposit)
    const gathererCode = F.packedCode(F.packPrint(F.packPieces([{ kind: F.GATHERER, x: 0, y: 0, dir: 0, span: 0 }])));
    expect(runStaff(y, { do: "pieces", code: gathererCode, x: fx, y: fy, turn: 0, replace: false })).toMatchObject({
      refused: "cannot_place",
    });

    // Original yard must be completely untouched after all refusals!
    expect(F.encode(y)).toBe(before);
  });
});

describe("staff restore", () => {
  test("restores an earlier yard whole and refuses invalid_yard", () => {
    const y = F.create({ seed: 9, tier: 4 });
    must(y, { do: "build", kind: "belt", ...near(2, 2), dir: 0 });
    const earlier = F.encode(y);

    const changed = runStaff(y, { do: "learn", goals: ["felling"] });
    expect(isRefused(changed)).toBe(false);
    if (isRefused(changed)) return;
    expect(changed.state.open.felling).toBe(true);

    const bad = runStaff(changed.state, { do: "restore", yard: "{not valid yard" });
    expect(bad).toMatchObject({ refused: "invalid_yard" });

    const restored = runStaff(changed.state, { do: "restore", yard: earlier });
    expect(isRefused(restored)).toBe(false);
    if (isRefused(restored)) return;
    expect(restored.state.open.felling).toBe(false);
    expect(F.encode(restored.state)).toBe(earlier);
  });
});

describe("exportYard", () => {
  test("returns empty list for an empty yard and splits a wide yard into valid 40x30 blueprint codes", () => {
    const empty = F.create({ seed: 10 });
    expect(F.exportYard(empty)).toEqual([]);

    const big = F.create({ seed: 10, tier: 5 });
    // Grant several plots spanning more than 40 tiles wide and 30 tiles tall.
    const granted = runStaff(big, {
      do: "plots",
      plots: ["meadow", "bank", "stream", "grove", "seam", "quarry", "hollow", "pond", "workings", "ridge"],
    });
    expect(isRefused(granted)).toBe(false);
    if (isRefused(granted)) return;
    const y = granted.state;

    // Stand belts across a >40x30 bounding box.
    const placedCoords: [number, number][] = [];
    for (const plotName of ["yard", "meadow", "quarry", "workings", "ridge"] as const) {
      const p = y.land.plots.find((q) => q.plot === F.plot(plotName));
      if (!p) continue;
      for (let dz = 1; dz < 4; dz++) {
        for (let dx = 1; dx < 4; dx++) {
          const x = p.x + dx;
          const z = p.y + dz;
          const i = F.at(y, x, z);
          if (y.land.water[i] === 0 && !F.redwoodAt(y, i) && y.kind[i] === F.NONE) {
            const did = F.build(y, F.BELT, x, z, 0, Infinity);
            if (did.ok) placedCoords.push([x, z]);
          }
        }
      }
    }
    const totalBox = F.boxOf(F.piecesAt(y, allTiles(y)));
    expect(totalBox.w > F.BOX_MOST.w || totalBox.h > F.BOX_MOST.h).toBe(true);

    const parts = F.exportYard(y);
    expect(parts.length).toBeGreaterThan(1);
    const reconstructed: string[] = [];
    for (const part of parts) {
      expect(part.size.w).toBeLessThanOrEqual(F.BOX_MOST.w);
      expect(part.size.h).toBeLessThanOrEqual(F.BOX_MOST.h);
      const decoded = F.codePieces(part.code);
      expect(decoded).not.toBeNull();
      if (!decoded) continue;
      expect(decoded.length).toBe(part.pieces);
      for (const p of F.placed(decoded, 0, part.corner.x, part.corner.y)) reconstructed.push(`${p.x},${p.y}`);
    }
    expect(reconstructed.toSorted()).toEqual(placedCoords.map(([x, z]) => `${x},${z}`).toSorted());
  });
});
