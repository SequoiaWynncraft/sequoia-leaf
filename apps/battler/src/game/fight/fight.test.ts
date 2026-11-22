import { describe, expect, test } from "bun:test";

import { boonNumber } from "../content/boons.ts";
import { FIGURES, specOf, starScale } from "../content/figures.ts";
import { FIGHT } from "../content/rooms.ts";
import { traitNumber } from "../content/traits.ts";
import { backRow, CELLS, cellSeat, distance, rowOf, seatCell } from "../hex.ts";
import {
  at,
  fightOf,
  inOrder,
  onCell,
  only,
  partyOfFigures,
  ready,
  steps,
  stepUntil,
  still,
  stillSide,
  unitOf,
  unitsOf,
} from "../testkit.ts";
import { burn, drawOf, heal, hurt, HZ, shieldUp, slow, stun, taunt } from "./core.ts";
import { openFight, recordFight, resolveFight, runFight, speedNow, stepFight } from "./engine.ts";
import type { Fight, FightSetup } from "./types.ts";

const brawl = (seed: number): FightSetup => ({
  seed,
  sides: [
    partyOfFigures(
      [
        at("crab7", 3, 0, 2, ["wasptail"]),
        at("slug", 2, 0),
        at("emberkit", 4, 0, 2),
        at("finch", 3, 2),
        at("kettle", 2, 2),
        at("worm", 0, 3),
        at("bushgnome", 6, 3),
      ],
      { boons: ["secondwind"] },
    ),
    partyOfFigures(
      [
        at("barrowgnome", 3, 0, 2),
        at("glorp", 2, 0),
        at("jay", 4, 0),
        at("moth", 3, 2, 2, ["glowcap"]),
        at("crab12", 2, 2),
        at("cindernewt", 4, 1),
        at("mossmote", 5, 2),
      ],
      { charms: ["mist"] },
    ),
  ],
});

describe("a fight is decided by the two boards and a seed", () => {
  test("the same seed gives the same fight, event for event", () => {
    const a = recordFight(brawl(11));
    const b = recordFight(brawl(11));
    expect(b.opening).toEqual(a.opening);
    expect(b.steps).toEqual(a.steps);
    expect(b.summary).toEqual(a.summary);
    expect(a.steps.length).toBeGreaterThan(40);
  });
  test("another seed is another fight", () => {
    const tapes = [11, 12, 13, 14].map((seed) => JSON.stringify(recordFight(brawl(seed)).steps));
    expect(new Set(tapes).size).toBeGreaterThan(1);
  });
  test("stepping it and running it straight through come to the same end", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const stepped = openFight(brawl(seed));
      while (!stepped.over) stepFight(stepped);
      const ran = resolveFight(brawl(seed));
      expect(ran.result).toBe(stepped.result ?? "draw");
      expect(ran.ticks).toBe(stepped.tick);
      expect(ran.units.map((u) => u.hp)).toEqual(stepped.units.map((u) => Math.max(0, u.hp)));
    }
  });
  test("a fight can be picked up half way and run to the same end", () => {
    const whole = resolveFight(brawl(21));
    const half = openFight(brawl(21));
    steps(half, 100);
    expect(runFight(half)).toEqual(whole);
  });
  test("the last event is the end, and nothing happens after it", () => {
    const f = openFight(brawl(3));
    let last = steps(f, 1);
    while (!f.over) last = stepFight(f);
    const end = last.at(-1);
    expect(end?.t).toBe("end");
    if (end?.t === "end") {
      expect(end.result).toBe(f.result ?? "draw");
      expect(end.standing).toEqual([f.standing[0], f.standing[1]]);
    }
    expect(stepFight(f)).toEqual([]);
  });
  test("it runs thousands of fights a second", () => {
    const setup = brawl(1);
    resolveFight(setup);
    const started = performance.now();
    const count = 300;
    for (let i = 0; i < count; i++) resolveFight({ ...setup, seed: i });
    const perSecond = (count / (performance.now() - started)) * 1000;
    // Seven a side with abilities, summons and items. The bar is set low so a busy machine does not fail it.
    expect(perSecond).toBeGreaterThan(1000);
  });
});

describe("sitting down", () => {
  test("each side's seats map onto its half, front lines facing", () => {
    const f = fightOf([at("crab7", 3, 0), at("finch", 0, 3)], [at("gnat", 3, 0), at("gnat", 6, 3)]);
    expect(unitOf(f, "crab7").cell).toBe(seatCell(0, 3));
    expect(rowOf(unitOf(f, "crab7").cell)).toBe(4);
    expect(rowOf(unitOf(f, "finch").cell)).toBe(backRow(0));
    const gnats = unitsOf(f, "gnat", 1);
    expect(inOrder(gnats.map((g) => rowOf(g.cell)))).toEqual([0, 3]);
    expect(f.taken.filter((id) => id >= 0).length).toBe(4);
  });
  test("stars multiply health and attack", () => {
    const f = fightOf([at("emberkit", 0, 0, 1), at("emberkit", 2, 0, 2), at("emberkit", 4, 0, 3)], [at("gnat", 3, 3)]);
    const [one, two, three] = unitsOf(f, "emberkit", 0);
    const base = FIGURES.emberkit;
    expect(one?.maxHp).toBe(base.hp);
    expect(two?.maxHp).toBe(Math.round(base.hp * starScale(2)));
    expect(three?.maxHp).toBe(Math.round(base.hp * starScale(3)));
    expect(three?.attack).toBe(Math.round(base.attack * starScale(3)));
    expect(starScale(2)).toBeCloseTo(1.8);
  });
  test("a party's might scales its health and attack", () => {
    const f = fightOf([at("crab7", 3, 0)], [at("mud", 3, 0)], { theirs: { might: 150 } });
    expect(unitOf(f, "mud", 1).maxHp).toBe(Math.round(specOf("mud").hp * 1.5));
    expect(unitOf(f, "mud", 1).attack).toBe(Math.round(specOf("mud").attack * 1.5));
  });
  test("an empty side has lost before it starts", () => {
    const f = fightOf([], [at("gnat", 3, 0)]);
    expect(f.over).toBe(true);
    expect(f.result).toBe("loss");
    expect(resolveFight({ seed: 1, sides: [partyOfFigures([at("gnat", 0, 0)]), partyOfFigures([])] }).result).toBe(
      "win",
    );
  });
});

describe("attacking", () => {
  test("physical damage meets armour, magic meets ward, true damage meets nothing", () => {
    const f = fightOf([at("crab7", 3, 0)], [at("mud", 3, 0)]);
    const mud = still(unitOf(f, "mud", 1));
    mud.armour = 100;
    mud.ward = 50;
    expect(hurt(f, mud, 100, "physical", "item", null)).toBe(50);
    expect(hurt(f, mud, 100, "magic", "item", null)).toBe(67);
    expect(hurt(f, mud, 100, "true", "item", null)).toBe(100);
    expect(mud.hp).toBe(100_000 - 217);
  });
  test("a figure attacks on its own timer", () => {
    const f = fightOf([at("crab7", 3, 0)], [at("mud", 3, 0)]);
    stillSide(f, 1);
    const crab = unitOf(f, "crab7");
    crab.manaFull = 0;
    const swings = only(steps(f, 10 * HZ), "swing").filter((e) => e.id === crab.id);
    // 0.65 attacks a second for ten seconds, give or take the first one.
    expect(swings.length).toBeGreaterThanOrEqual(6);
    expect(swings.length).toBeLessThanOrEqual(7);
  });
  test("mana comes from attacking and from being hit, and the ability is used when it fills", () => {
    const f = fightOf([at("crab7", 3, 0)], [at("mud", 3, 0)]);
    const mud = still(unitOf(f, "mud", 1));
    const crab = unitOf(f, "crab7");
    const start = crab.mana;
    stepUntil(f, (e) => e.t === "swing");
    expect(crab.mana).toBe(start + FIGHT.manaAttack);
    hurt(f, crab, crab.maxHp * 0.1, "true", "attack", mud);
    expect(crab.mana).toBeGreaterThan(start + FIGHT.manaAttack);
    const events = stepUntil(f, (e) => e.t === "cast");
    expect(only(events, "cast")[0]?.id).toBe(crab.id);
    expect(crab.mana).toBeLessThan(crab.manaFull);
    expect(crab.casts).toBe(1);
  });
  test("burns and dusk fill nobody's mana", () => {
    const f = fightOf([at("crab7", 3, 0)], [at("mud", 3, 0)]);
    const crab = unitOf(f, "crab7");
    const before = crab.mana;
    hurt(f, crab, 30, "true", "burn", null);
    hurt(f, crab, 30, "true", "dusk", null);
    expect(crab.mana).toBe(before);
  });
  test("an attack from range flies, and lands when it arrives", () => {
    const f = fightOf([at("finch", 3, 2)], [at("mud", 3, 0)]);
    stillSide(f, 1);
    const finch = unitOf(f, "finch");
    finch.manaFull = 0;
    const events = stepUntil(f, (e) => e.t === "hit");
    const shot = only(events, "shot")[0];
    const hit = only(events, "hit")[0];
    expect(shot?.what).toBe("attack");
    expect(shot?.ticks).toBe(distance(shot?.from ?? 0, shot?.to ?? 0) * FIGHT.flight);
    // It was thrown at step 1 and lands that many steps later.
    expect(f.tick).toBe(1 + (shot?.ticks ?? 0));
    expect(hit?.amount).toBe(finch.attack);
    expect(hit?.kind).toBe("physical");
  });
  test("a shot in the air is as strong as when it was thrown: more attack after does not reach it", () => {
    const f = fightOf([at("finch", 3, 2)], [at("mud", 3, 0)]);
    stillSide(f, 1);
    const finch = unitOf(f, "finch");
    finch.manaFull = 0;
    const thrown = finch.attack;
    const throwing = stepUntil(f, (e) => e.t === "shot");
    expect(only(throwing, "hit").length).toBe(0);
    // A bonus lands on the Finch while its seed is in the air, as a Leafling's or an item's would.
    finch.attack += 40;
    const landing = stepUntil(f, (e) => e.t === "hit");
    expect(only(landing, "hit")[0]?.amount).toBe(thrown);
    // The next one is thrown with the bonus.
    const next = stepUntil(f, (e) => e.t === "hit");
    expect(only(next, "hit")[0]?.amount).toBe(thrown + 40);
  });
  test("a shot in the air lands hard as often as its thrower did when it was thrown", () => {
    const f = fightOf([at("finch", 3, 2)], [at("mud", 3, 0)]);
    stillSide(f, 1);
    const finch = unitOf(f, "finch");
    finch.manaFull = 0;
    finch.crit = 0;
    stepUntil(f, (e) => e.t === "shot");
    finch.crit = 100;
    const landing = stepUntil(f, (e) => e.t === "hit");
    expect(only(landing, "hit")[0]?.hard).toBe(false);
  });
  test("a shot in the air still lands, as strong as it was thrown, when its thrower falls first", () => {
    const f = fightOf([at("finch", 3, 2), at("crab7", 6, 3)], [at("mud", 3, 0)]);
    stillSide(f, 1);
    const finch = unitOf(f, "finch");
    still(unitOf(f, "crab7"));
    finch.manaFull = 0;
    const thrown = finch.attack;
    stepUntil(f, (e) => e.t === "shot");
    hurt(f, finch, 99_999, "true", "item", null);
    expect(finch.alive).toBe(false);
    const hits = only(
      stepUntil(f, (e) => e.t === "hit"),
      "hit",
    );
    expect(hits.map((h) => [h.id, h.by, h.amount])).toEqual([[unitOf(f, "mud", 1).id, finch.id, thrown]]);
  });
  test("what is thrown at somebody who falls first just drops", () => {
    const f = fightOf([at("finch", 3, 2)], [at("mud", 3, 0)]);
    const mud = still(unitOf(f, "mud", 1), 5);
    unitOf(f, "finch").manaFull = 0;
    stepUntil(f, (e) => e.t === "shot");
    hurt(f, mud, 50, "true", "item", null);
    expect(mud.alive).toBe(false);
    expect(f.pending.length).toBe(1);
    const after = steps(f, 20);
    expect(only(after, "hit").length).toBe(0);
  });
});

describe("walking", () => {
  test("a figure walks hex by hex to whoever is nearest, and attacks once in reach", () => {
    const f = fightOf([at("crab7", 0, 3)], [at("mud", 6, 3)]);
    stillSide(f, 1);
    const crab = unitOf(f, "crab7");
    const mud = unitOf(f, "mud", 1);
    const far = distance(crab.cell, mud.cell);
    const events = stepUntil(f, (e) => e.t === "swing");
    const moves = only(events, "move");
    expect(moves.length).toBe(far - 1);
    let here = seatCell(0, 3 * 7);
    for (const m of moves) {
      expect(m.from).toBe(here);
      expect(distance(m.from, m.to)).toBe(1);
      expect(m.ticks).toBe(FIGHT.walk);
      here = m.to;
    }
    expect(distance(crab.cell, mud.cell)).toBe(1);
    expect(f.taken[crab.cell]).toBe(crab.id);
    expect(f.taken[seatCell(0, 3 * 7)]).toBe(-1);
  });
  test("it goes round friends who are in the way", () => {
    // A wall of Rocks across our front row, with the Crab behind them and the trouble beyond.
    const rocks = [0, 1, 2, 3, 4, 5].map((col) => at("rock", col, 0));
    const f = fightOf([...rocks, at("crab7", 0, 2)], [at("mud", 0, 1)]);
    stillSide(f, 1);
    const crab = unitOf(f, "crab7");
    const mud = unitOf(f, "mud", 1);
    const events = stepUntil(f, (e) => e.t === "swing" && e.id === crab.id, 600);
    expect(only(events, "swing").some((e) => e.id === crab.id)).toBe(true);
    expect(distance(crab.cell, mud.cell)).toBe(1);
    // The straight way was shut: it took more steps than the distance.
    expect(only(events, "move").filter((e) => e.id === crab.id).length).toBeGreaterThan(4);
  });
  test("a Rock stays where it was put", () => {
    const f = fightOf([at("rock", 3, 3)], [at("gnat", 3, 3)]);
    const rock = unitOf(f, "rock");
    const home = rock.cell;
    const events = steps(f, 200);
    expect(only(events, "move").some((e) => e.id === rock.id)).toBe(false);
    expect(rock.cell).toBe(home);
    expect(only(events, "swing").some((e) => e.id === rock.id)).toBe(false);
  });
});

/** A Crab #7 that only attacks, facing a plain target with a thousand health. */
const duel = () => {
  const f = fightOf([at("crab7", 3, 0)], [at("mud", 3, 0)]);
  const mud = still(unitOf(f, "mud", 1), 1000);
  const crab = unitOf(f, "crab7");
  crab.manaFull = 0;
  return { f, mud, crab };
};

describe("statuses", () => {
  test("a stunned figure does nothing until it wears off", () => {
    const { f, mud, crab } = duel();
    stun(f, crab, 2, mud);
    const during = steps(f, 2 * HZ - 1);
    expect(only(during, "swing").length).toBe(0);
    const after = steps(f, HZ);
    expect(only(after, "status").some((e) => e.status === "stun" && !e.on && e.id === crab.id)).toBe(true);
    expect(only(after, "swing").length).toBeGreaterThan(0);
  });
  test("a slowed figure attacks slower", () => {
    const { f, mud, crab } = duel();
    const plain = speedNow(f, crab);
    slow(f, crab, 40, 3, mud);
    expect(speedNow(f, crab)).toBeCloseTo(plain * 0.6);
    steps(f, 3 * HZ + 1);
    expect(speedNow(f, crab)).toBeCloseTo(plain);
  });
  test("a burn takes a share of health every second, and makes healing weaker", () => {
    const { f, mud, crab } = duel();
    crab.attack = 0;
    const lasts = traitNumber("ember", "lasts", 1);
    burn(f, mud, 2, crab);
    const events = steps(f, lasts * HZ + 5);
    const burns = only(events, "hit").filter((e) => e.source === "burn");
    expect(burns.length).toBe(lasts);
    for (const b of burns) expect(b.amount).toBe(20);
    expect(mud.hp).toBe(1000 - 20 * lasts);
    expect(only(events, "status").some((e) => e.status === "burn" && !e.on)).toBe(true);
    // Healing: plain once the fire is out, weaker while it burns.
    expect(heal(f, mud, 50, "ability", null)).toBe(50);
    burn(f, mud, 2, crab);
    expect(heal(f, mud, 20, "ability", null)).toBe(20 * (1 - traitNumber("ember", "damp", 1) / 100));
  });
  test("a shield takes the damage first, and runs out", () => {
    const { f, mud } = duel();
    shieldUp(f, mud, 100, 2, null);
    expect(hurt(f, mud, 60, "true", "item", null)).toBe(60);
    expect(mud.hp).toBe(1000);
    expect(mud.shield).toBe(40);
    hurt(f, mud, 60, "true", "item", null);
    expect(mud.hp).toBe(980);
    expect(mud.shield).toBe(0);
    shieldUp(f, mud, 100, 2, null);
    const events = steps(f, 2 * HZ + 1).filter((e) => e.t === "status" && e.status === "shield" && !e.on);
    expect(events.length).toBe(1);
    expect(mud.shield).toBe(0);
  });
  test("a taunted figure goes for whoever taunted it", () => {
    const f = fightOf([at("finch", 3, 2)], [at("mud", 3, 0), at("puddle", 0, 3)]);
    stillSide(f, 1);
    const finch = unitOf(f, "finch");
    finch.manaFull = 0;
    finch.range = 9;
    const puddle = unitOf(f, "puddle", 1);
    const first = only(
      stepUntil(f, (e) => e.t === "shot"),
      "shot",
    )[0];
    expect(first?.target).toBe(unitOf(f, "mud", 1).id);
    taunt(f, finch, 3, puddle);
    const next = only(
      stepUntil(f, (e) => e.t === "shot"),
      "shot",
    ).at(-1);
    expect(next?.target).toBe(puddle.id);
  });
});

/** Whoever a fight's next attack goes at, thrown or up close. */
const nextAttack = (f: Fight): number | undefined => {
  const ev = stepUntil(f, (e) => e.t === "shot" || e.t === "swing").findLast((e) => e.t === "shot" || e.t === "swing");
  return ev?.t === "shot" || ev?.t === "swing" ? ev.target : undefined;
};

describe("draw: who a figure goes for", () => {
  /** A Twig Finch on our front line that only throws, and reaches everywhere, so its first shot is its pick. */
  const FINCH = seatCell(0, 3);
  /** Hexes on the far half a number of hexes from the finch, in the order its side breaks ties (the first wins). */
  const away = (hexes: number): number[] => {
    const out: number[] = [];
    for (let cell = 0; cell < CELLS; cell++)
      if (cellSeat(1, cell) >= 0 && distance(FINCH, cell) === hexes) out.push(cell);
    return out;
  };
  const cellAt = (hexes: number, i: number): number => {
    const cell = away(hexes)[i];
    if (cell === undefined) throw new Error(`no hex ${hexes} away, number ${i}`);
    return cell;
  };
  /** The finch against some figures standing still; the id of whoever it first attacks. */
  function firstPick(foes: Parameters<typeof onCell>[]): { picked: number | undefined; f: Fight } {
    const f = fightOf(
      [onCell("finch", 0, FINCH)],
      foes.map((args) => onCell(...args)),
    );
    stillSide(f, 1);
    const finch = unitOf(f, "finch");
    finch.manaFull = 0;
    finch.range = 9;
    return { picked: nextAttack(f), f };
  }

  test("a figure's draw is its callings and items, from -1 to +2", () => {
    expect(drawOf("crab7", [])).toBe(0);
    expect(drawOf("barrowgnome", [])).toBe(1);
    expect(drawOf("greg", [])).toBe(1);
    expect(drawOf("worm", [])).toBe(-1);
    expect(drawOf("hearthcat", [])).toBe(-1);
    expect(drawOf("whitefox", [])).toBe(0);
    expect(drawOf("crab7", ["stump"])).toBe(1);
    expect(drawOf("crab7", ["stump", "bark"])).toBe(1);
    expect(drawOf("barrowgnome", ["stump"])).toBe(2);
    expect(drawOf("worm", ["stump"])).toBe(0);
    // Never above +2, however much it holds.
    expect(drawOf("barrowgnome", ["stump", "stump"])).toBe(FIGHT.drawMost);
    expect(drawOf("barrowgnome", ["stump", "stump", "stump"])).toBe(FIGHT.drawMost);
    // The forest's own and the summoned carry no calling.
    expect(drawOf("gnat", [])).toBe(0);
    expect(drawOf("bigcrab", [])).toBe(0);
    expect(drawOf("glorplet", [])).toBe(0);
    const f = fightOf([at("barrowgnome", 3, 0, 1, ["stump"]), at("worm", 2, 0)], [at("gnat", 3, 0)]);
    expect(unitOf(f, "barrowgnome").draw).toBe(2);
    expect(unitOf(f, "worm").draw).toBe(-1);
    expect(unitOf(f, "gnat", 1).draw).toBe(0);
  });
  test("a Bulwark two hexes away does not draw it from an enemy one hex away: a tie, and the nearer wins", () => {
    const { picked, f } = firstPick([
      ["barrowgnome", 1, cellAt(2, 0)],
      ["gnat", 1, cellAt(1, 0)],
    ]);
    expect(picked).toBe(unitOf(f, "gnat", 1).id);
  });
  test("at the same distance the Bulwark is picked, even where the other would have come first", () => {
    const { picked, f } = firstPick([
      ["gnat", 1, cellAt(2, 0)],
      ["barrowgnome", 1, cellAt(2, 1)],
    ]);
    expect(picked).toBe(unitOf(f, "barrowgnome", 1).id);
    // Without its draw the gnat would have been picked.
    const plain = firstPick([
      ["gnat", 1, cellAt(2, 0)],
      ["crab7", 1, cellAt(2, 1)],
    ]);
    expect(plain.picked).toBe(unitOf(plain.f, "gnat", 1).id);
  });
  test("a Sneak at the same distance is passed over", () => {
    const { picked, f } = firstPick([
      ["worm", 1, cellAt(2, 0)],
      ["gnat", 1, cellAt(2, 1)],
    ]);
    expect(picked).toBe(unitOf(f, "gnat", 1).id);
  });
  test("two draws reach a hex further than one, and no further than two", () => {
    // +2 three hexes away seems as near as one hex: it beats a figure two hexes away...
    const two = firstPick([
      ["barrowgnome", 1, cellAt(3, 0), 1, ["stump"]],
      ["gnat", 1, cellAt(2, 0)],
    ]);
    expect(two.picked).toBe(unitOf(two.f, "barrowgnome", 1).id);
    // ...but held to +2, three Stump Shields still tie with one hex away, and the nearer wins.
    const capped = firstPick([
      ["barrowgnome", 1, cellAt(3, 0), 1, ["stump", "stump", "stump"]],
      ["gnat", 1, cellAt(1, 0)],
    ]);
    expect(unitOf(capped.f, "barrowgnome", 1).draw).toBe(2);
    expect(capped.picked).toBe(unitOf(capped.f, "gnat", 1).id);
  });
  test("taunting still wins over draw, and staying on a target in reach is unchanged", () => {
    const f = fightOf(
      [onCell("finch", 0, FINCH)],
      [onCell("gnat", 1, cellAt(1, 0)), onCell("puddle", 1, cellAt(4, 0))],
    );
    stillSide(f, 1);
    const finch = unitOf(f, "finch");
    finch.manaFull = 0;
    finch.range = 9;
    const gnat = unitOf(f, "gnat", 1);
    const puddle = unitOf(f, "puddle", 1);
    expect(nextAttack(f)).toBe(gnat.id);
    // Once on the gnat, it stays on it while it is in reach, however much the puddle draws.
    puddle.draw = 9;
    expect(nextAttack(f)).toBe(gnat.id);
    // Taunted, it goes for the puddle, however much the gnat draws.
    taunt(f, finch, 3, puddle);
    puddle.draw = 0;
    gnat.draw = FIGHT.drawMost;
    expect(nextAttack(f)).toBe(puddle.id);
  });
  test("an ability aimed at its target follows the pick", () => {
    const f = fightOf([onCell("crab7", 0, FINCH)], [onCell("gnat", 1, cellAt(1, 0)), onCell("slug", 1, cellAt(1, 1))]);
    stillSide(f, 1);
    const crab = ready(unitOf(f, "crab7"));
    const cast = only(
      stepUntil(f, (e) => e.t === "cast"),
      "cast",
    )[0];
    expect(crab.target).toBe(-1);
    expect(cast?.targets).toEqual([unitOf(f, "slug", 1).id]);
  });
});

describe("dusk", () => {
  test("falls after thirty seconds and ends a fight nobody can win", () => {
    // Two Rocks. Neither will ever do anything.
    const f = fightOf([at("rock", 3, 0)], [at("rock", 3, 0)]);
    const events = stepUntil(f, (e) => e.t === "end", 2000);
    const dusks = only(events, "dusk");
    expect(dusks[0]?.n).toBe(1);
    expect(f.over).toBe(true);
    expect(f.result).toBe("draw");
    expect(f.tick).toBeGreaterThan(FIGHT.dusk * HZ);
    expect(f.tick).toBeLessThan(FIGHT.cap * HZ);
    // It hurts more every second.
    const hits = only(events, "hit").filter((e) => e.source === "dusk" && e.id === 0);
    expect(hits.length).toBeGreaterThan(2);
    for (let i = 1; i < hits.length; i++) expect(hits[i]?.amount ?? 0).toBeGreaterThan(hits[i - 1]?.amount ?? 0);
  });
  test("leaves the side in better shape standing", () => {
    // Two Rocks again, but ours has a Winter Hoard and regrows a little every second.
    const summary = resolveFight({
      seed: 4,
      sides: [partyOfFigures([at("rock", 3, 0, 1, ["hoard"])]), partyOfFigures([at("rock", 3, 0, 1)])],
    });
    expect(summary.dusk).toBe(true);
    expect(summary.seconds).toBeLessThan(FIGHT.cap);
    expect(summary.result).toBe("win");
  });
  test("no fight outlasts the cap", () => {
    for (let seed = 0; seed < 40; seed++) expect(resolveFight(brawl(seed)).seconds).toBeLessThanOrEqual(FIGHT.cap);
  });
});

describe("falling", () => {
  test("a figure at no health falls, frees its hex, and the side with nobody left loses", () => {
    const f = fightOf([at("crab7", 3, 0)], [at("gnat", 3, 0)]);
    const gnat = unitOf(f, "gnat", 1);
    const cell = gnat.cell;
    hurt(f, gnat, 9999, "true", "item", null);
    expect(gnat.alive).toBe(false);
    expect(f.taken[cell]).toBe(-1);
    expect(f.standing).toEqual([1, 0]);
    const events = steps(f, 1);
    expect(events.at(-1)).toEqual({ t: "end", result: "win", tick: 1, standing: [1, 0] });
  });
  test("with Second Wind the first to fall gets back up, once", () => {
    const f = fightOf([at("crab7", 3, 0), at("emberkit", 2, 0)], [at("mud", 3, 0)], {
      ours: { boons: ["secondwind"] },
    });
    const crab = unitOf(f, "crab7");
    const kit = unitOf(f, "emberkit");
    f.out = [];
    hurt(f, crab, 9999, "true", "item", null);
    expect(crab.alive).toBe(true);
    expect(crab.hp).toBe(Math.round((crab.maxHp * boonNumber("secondwind", "health")) / 100));
    expect(f.out.some((e) => e.t === "rise" && e.id === crab.id)).toBe(true);
    hurt(f, kit, 9999, "true", "item", null);
    expect(kit.alive).toBe(false);
    hurt(f, crab, 9999, "true", "item", null);
    expect(crab.alive).toBe(false);
  });
  test("ready() and the rest of the kit leave a fight playable", () => {
    const f = fightOf([at("crab7", 3, 0)], [at("gnat", 3, 0)]);
    ready(unitOf(f, "crab7"));
    expect(runFight(f).result).toBe("win");
  });
});
