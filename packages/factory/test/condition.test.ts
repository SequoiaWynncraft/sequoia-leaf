/**
 * `condition` is the one place a piece's state and trouble are decided (`status` words them): for
 * each kind of piece, each way it can stand, built with commands on a small bare land.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { must } from "./yards.ts";

/** What `condition` says of the piece on a tile, as words: its state, and "trouble" while it is in trouble. */
function says(y: F.Yard, x: number, z: number): string {
  const c = F.condition(y, F.at(y, x, z));
  return c < 0 ? "-" : `${F.STATES[c % F.TROUBLE]}${c >= F.TROUBLE ? " trouble" : ""}`;
}
const run = (y: F.Yard, ticks: number): void => {
  for (let k = 0; k < ticks; k++) F.step(y);
};

/**
 * A yard with every goal of the slice done on 30 by 9 tiles, the depot's middle at (4, 4): power
 * reaches x 10 and no further on its row. Deadfall at (13, 1) to (13, 3), ore at (13, 7).
 */
function yard(): F.Yard {
  const land = bareLand(
    30,
    9,
    [
      [13, 1, "deadfall"],
      [13, 2, "deadfall"],
      [13, 3, "deadfall"],
      [13, 7, "ore"],
      [2, 8, "deadfall"],
      [1, 0, "deadfall"],
    ],
    [4, 4],
  );
  return F.create({ land, tier: 4, seed: 3 });
}

describe("a piece's condition", () => {
  test("is nothing where nothing stands, and giving for the depot", () => {
    const y = yard();
    expect([says(y, 20, 1), says(y, 4, 4)]).toEqual(["-", "giving"]);
  });

  test("of a pylon or a waterwheel is giving where power reaches it, and unpowered, in trouble, where it does not", () => {
    const y = yard();
    must(y, { do: "build", kind: "pylon", x: 9, y: 4, dir: 0 });
    must(y, { do: "build", kind: "pylon", x: 28, y: 4, dir: 0 });
    expect([says(y, 9, 4), says(y, 28, 4)]).toEqual(["giving", "unpowered trouble"]);
  });

  test("of a boiler is unpowered out of reach, cold with no deadfall, and giving while it burns", () => {
    const y = yard();
    must(y, { do: "build", kind: "boiler", x: 28, y: 1, dir: 0 });
    must(y, { do: "build", kind: "boiler", x: 6, y: 1, dir: 0 });
    expect([says(y, 28, 1), says(y, 6, 1)]).toEqual(["unpowered trouble", "cold trouble"]);
    // Deadfall gathered at (1, 0) and handed east into the boiler at (2, 0).
    must(y, { do: "build", kind: "boiler", x: 2, y: 0, dir: 0 });
    must(y, { do: "build", kind: "gatherer", x: 1, y: 0, dir: 0 });
    run(y, 80);
    expect(says(y, 2, 0)).toBe("giving");
  });

  test("of a crate is idle empty, carrying while it holds something, and shut while it lets nothing out", () => {
    const y = yard();
    must(y, { do: "build", kind: "crate", x: 7, y: 1, dir: 0 });
    expect(says(y, 7, 1)).toBe("idle");
    must(y, { do: "crate", x: 7, y: 1, open: false });
    expect(says(y, 7, 1)).toBe("shut");
    must(y, { do: "build", kind: "gatherer", x: 2, y: 8, dir: 0 });
    must(y, { do: "build", kind: "crate", x: 3, y: 8, dir: 0 });
    run(y, 60);
    expect(says(y, 3, 8)).toBe("carrying");
  });

  test("of a belt is idle empty, carrying while a thing crosses it, waiting behind a full one, and blocked where nothing ahead takes it", () => {
    const y = yard();
    // A gatherer at (13, 1) hands west onto belts running west into nothing.
    must(y, { do: "build", kind: "pylon", x: 11, y: 2, dir: 0 });
    must(y, { do: "build", kind: "gatherer", x: 13, y: 1, dir: 2 });
    must(y, { do: "build", kind: "belt", x: 12, y: 1, dir: 2 });
    must(y, { do: "build", kind: "belt", x: 11, y: 1, dir: 2 });
    must(y, { do: "build", kind: "belt", x: 20, y: 6, dir: 0 });
    expect(says(y, 20, 6)).toBe("idle");
    run(y, 18);
    expect(says(y, 12, 1)).toBe("carrying");
    run(y, 400);
    expect([says(y, 11, 1), says(y, 12, 1)]).toEqual(["blocked trouble", "waiting"]);
    // Pointed at a pylon, which never takes anything: blocked too.
    must(y, { do: "build", kind: "pylon", x: 10, y: 1, dir: 0 });
    expect(says(y, 11, 1)).toBe("blocked trouble");
  });

  test("of a splitter is blocked, in trouble, with all three ways shut, whether or not it holds anything", () => {
    const y = yard();
    must(y, { do: "build", kind: "splitter", x: 20, y: 6, dir: 0 });
    for (const way of [0, 1, 2]) must(y, { do: "way", x: 20, y: 6, way, open: false });
    expect(says(y, 20, 6)).toBe("blocked trouble");
  });

  test("of a tunnel's way-in mouth is carrying while something is under the ground, and waiting at its end", () => {
    const y = yard();
    must(y, { do: "build", kind: "pylon", x: 11, y: 2, dir: 0 });
    must(y, { do: "build", kind: "gatherer", x: 13, y: 2, dir: 2 });
    must(y, { do: "build", kind: "tunnel", x: 12, y: 2, dir: 2 });
    const mouth = F.at(y, 12, 2);
    expect(F.tunnelOf(y, mouth)).toBeGreaterThanOrEqual(0);
    run(y, 40);
    expect(["carrying", "waiting"]).toContain(says(y, 12, 2));
    run(y, 400);
    const far = F.otherMouth(y, mouth);
    expect(says(y, far % y.land.w, Math.floor(far / y.land.w))).toBe("blocked trouble");
  });

  test("of a machine is unpowered, in trouble, out of reach; a gatherer in reach is working", () => {
    const y = yard();
    must(y, { do: "build", kind: "gatherer", x: 13, y: 3, dir: 1 });
    expect(says(y, 13, 3)).toBe("unpowered trouble");
    must(y, { do: "build", kind: "pylon", x: 11, y: 2, dir: 0 });
    expect(says(y, 13, 3)).toBe("working");
  });

  test("of a gatherer or a machine holding something ready is waiting while there is room ahead to come, and blocked when nothing ahead will ever take it", () => {
    const y = yard();
    must(y, { do: "build", kind: "pylon", x: 11, y: 2, dir: 0 });
    must(y, { do: "build", kind: "gatherer", x: 13, y: 1, dir: 3 });
    run(y, 60);
    // Off the land to the north: nothing stands there.
    expect(says(y, 13, 1)).toBe("blocked trouble");
    must(y, { do: "build", kind: "gatherer", x: 13, y: 2, dir: 2 });
    must(y, { do: "build", kind: "pylon", x: 12, y: 2, dir: 0 });
    run(y, 60);
    expect(says(y, 13, 2)).toBe("blocked trouble");
    must(y, { do: "build", kind: "gatherer", x: 13, y: 3, dir: 2 });
    must(y, { do: "build", kind: "belt", x: 12, y: 3, dir: 2 });
    must(y, { do: "build", kind: "belt", x: 11, y: 3, dir: 1 });
    must(y, { do: "build", kind: "belt", x: 11, y: 4, dir: 0 });
    must(y, { do: "build", kind: "belt", x: 12, y: 4, dir: 3 });
    run(y, 400);
    // A ring of belts: full, but each takes from the one behind it, so the gatherer waits.
    expect(says(y, 13, 3)).toBe("waiting");
  });

  test("of a mill is idle with nothing, in trouble holding what no recipe takes, waiting for parts, and working", () => {
    const y = yard();
    must(y, { do: "build", kind: "mill", x: 6, y: 1, dir: 0 });
    expect(says(y, 6, 1)).toBe("idle");
    const r = F.holderOf(y, F.at(y, 6, 1));
    F.put(y.holders, r, F.item("plank"));
    expect(says(y, 6, 1)).toBe("idle trouble");
    must(y, { do: "tipOut", x: 6, y: 1, item: null });
    must(y, { do: "build", kind: "bench", x: 6, y: 7, dir: 0 });
    must(y, { do: "recipe", x: 6, y: 7, item: "tool" });
    expect(says(y, 6, 7)).toBe("waiting");
    F.put(y.holders, F.holderOf(y, F.at(y, 6, 7)), F.item("plank"));
    F.put(y.holders, F.holderOf(y, F.at(y, 6, 7)), F.item("ingot"));
    expect(says(y, 6, 7)).toBe("working");
  });

  test("of a machine full of one part and short of another is starved, in trouble", () => {
    const y = yard();
    must(y, { do: "build", kind: "bench", x: 6, y: 7, dir: 0 });
    must(y, { do: "recipe", x: 6, y: 7, item: "tool" });
    const r = F.holderOf(y, F.at(y, 6, 7));
    for (let k = 0; k < F.BUFFER; k++) F.put(y.holders, r, F.item("plank"));
    expect(says(y, 6, 7)).toBe("starved trouble");
  });

  test("of a Study is idle with nothing studied, waiting for folios, and working on one the research wants", () => {
    const y = F.create({ land: bareLand(13, 9, [], [9, 4]), tier: 3, seed: 1 });
    must(y, { do: "build", kind: "study", x: 5, y: 7, dir: 0 });
    expect(says(y, 5, 7)).toBe("idle");
    must(y, { do: "study", research: "workshop" });
    expect(says(y, 5, 7)).toBe("waiting");
    F.put(y.holders, F.holderOf(y, F.at(y, 5, 7)), F.item("timber"));
    expect(says(y, 5, 7)).toBe("working");
  });
});

describe("the rows of the side tables", () => {
  test("are read by the kind that owns them: a tunnel has no holder's row and a crate no tunnel's, whatever `row` holds", () => {
    const y = yard();
    must(y, { do: "build", kind: "crate", x: 6, y: 1, dir: 0 });
    must(y, { do: "build", kind: "tunnel", x: 20, y: 6, dir: 0 });
    const crate = F.at(y, 6, 1);
    const tunnel = F.at(y, 20, 6);
    // Both are the first row of their own table.
    expect([y.row[crate], y.row[tunnel]]).toEqual([0, 0]);
    expect([F.holderOf(y, crate), F.tunnelOf(y, crate)]).toEqual([0, -1]);
    expect([F.holderOf(y, tunnel), F.tunnelOf(y, tunnel)]).toEqual([-1, 0]);
    // The far mouth and a belt have neither.
    const far = F.otherMouth(y, tunnel);
    must(y, { do: "build", kind: "belt", x: 20, y: 7, dir: 0 });
    for (const i of [far, F.at(y, 20, 7), F.at(y, 25, 1)])
      expect([F.holderOf(y, i), F.tunnelOf(y, i)]).toEqual([-1, -1]);
  });

  test("are read through `holderOf` and `tunnelOf` everywhere in the rules but where the yard keeps them", async () => {
    const dir = new URL("../src/", import.meta.url).pathname;
    const glob = new Bun.Glob("**/*.ts");
    const reads: string[] = [];
    for await (const file of glob.scan(dir)) {
      if (file === "yard.ts") continue;
      const text = await Bun.file(dir + file).text();
      text.split("\n").forEach((line, n) => {
        if (/\brow\[/.test(line) || /\{[^}]*\brow\b[^}]*\}\s*=\s*y\b/.test(line)) reads.push(`${file}:${n + 1}`);
      });
    }
    expect(reads).toEqual([]);
  });
});
