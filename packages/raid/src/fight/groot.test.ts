/**
 * The expansion's first release in a fight, each part against its own sentence: Groot getting back
 * up in its true form, the five true forms, Rooted and the pull, Seqwawa's No GG Left Behind, and
 * Moss and Mender at 2, 3 and 4.
 */
import { describe, expect, test } from "bun:test";

import { abilityNumber, FIGURES, type UnitKind } from "../content/figures.ts";
import { formNumber } from "../content/groot.ts";
import { LEGACY_ERA } from "../content/releases.ts";
import { traitNumber } from "../content/traits.ts";
import { distance, neighbours, SEATS } from "../hex.ts";
import { playsAsKept } from "../run.ts";
import { tally } from "../tally.ts";
import { at, fightOf, inOrder, only, partyOfFigures, steps, stepUntil, still, stillSide, unitOf } from "../testkit.ts";
import { cast } from "./abilities.ts";
import { heal, hurt, knockBack, secs } from "./core.ts";
import { recordFight, resolveFight } from "./engine.ts";
import { pull } from "./moves.ts";
import type { Fight, FightEvent, Unit } from "./types.ts";

const t = traitNumber;
/** Our figures in the front row from column 0, against one Mud far off that only stands there. */
function ours(...kinds: UnitKind[]): Fight {
  const f = fightOf(
    kinds.map((kind, col) => at(kind, col, 0)),
    [at("mud", 3, 3)],
  );
  stillSide(f, 1);
  return f;
}
/** Does something to a fight outside a step, and gives back what it said. */
function said(f: Fight, act: () => void): FightEvent[] {
  const out: FightEvent[] = [];
  f.out = out;
  act();
  f.out = [];
  return out;
}
/** Brings a figure down at once. */
const fell = (f: Fight, u: Unit): FightEvent[] => said(f, () => hurt(f, u, 1_000_000, "true", "ability", null));
/** An enemy that stands and does nothing, but may still be pushed and pulled. */
function idle(u: Unit): Unit {
  u.attack = 0;
  u.manaFull = 0;
  u.maxHp = 100_000;
  u.hp = 100_000;
  return u;
}

describe("Groot", () => {
  test("is the five named after the raids, at 2, 3 and 5; nobody has a rise to come without it", () => {
    expect(unitOf(ours("worm", "moth"), "worm").rises).toBe(true);
    expect(unitOf(ours("worm", "emberkit"), "worm").rises).toBe(false);
    expect(ours("worm", "moth").traits[0].groot).toBe(1);
    expect(ours("worm", "moth", "rock").traits[0].groot).toBe(2);
    expect(ours("worm", "moth", "rock", "greg", "whitefox").traits[0].groot).toBe(3);
  });

  test("(2) the first Groot figure to fall gets back up 1 second later in its true form, with its share of health; the next stays down", () => {
    const f = ours("worm", "moth");
    const worm = unitOf(f, "worm");
    const moth = unitOf(f, "moth");
    const standing = f.standing[0];
    const down = fell(f, worm);
    expect(only(down, "fall")[0]).toMatchObject({ id: worm.id, back: secs(t("groot", "wait", 1)) });
    expect(worm.alive).toBe(false);
    // Down for the moment, it still counts as standing.
    expect(f.standing[0]).toBe(standing);
    expect(only(steps(f, secs(1) - 1), "rise")).toEqual([]);
    const up = only(steps(f, 1), "rise");
    expect(up).toEqual([
      {
        t: "rise",
        id: worm.id,
        hp: Math.round((worm.maxHp * t("groot", "health", 1)) / 100),
        why: "groot",
        form: "true",
        cell: worm.cell,
      },
    ]);
    expect(worm.alive && worm.form === "true").toBe(true);
    // Only the first: the Moth falls for good.
    expect(only(fell(f, moth), "fall")[0]?.back).toBeUndefined();
    expect(f.standing[0]).toBe(standing - 1);
    expect(only(steps(f, secs(2)), "rise")).toEqual([]);
    expect(moth.alive).toBe(false);
  });

  test("(3) every Groot figure gets back up, once a fight", () => {
    const f = ours("worm", "moth", "rock");
    const [worm, moth, rock] = [unitOf(f, "worm"), unitOf(f, "moth"), unitOf(f, "rock")];
    for (const u of [worm, moth, rock]) fell(f, u);
    const up = only(steps(f, secs(1)), "rise");
    expect(inOrder(up.map((r) => r.id))).toEqual(inOrder([worm.id, moth.id, rock.id]));
    expect(up.every((r) => r.why === "groot" && r.form === "true")).toBe(true);
    // Once: down again, it stays down.
    expect(only(fell(f, worm), "fall")[0]?.back).toBeUndefined();
    expect(only(steps(f, secs(2)), "rise")).toEqual([]);
    expect(worm.alive).toBe(false);
  });

  test("(5) they get back up with more of their health, and their mana bar at least half full", () => {
    const f = ours("worm", "moth", "rock", "greg", "whitefox");
    const moth = unitOf(f, "moth");
    moth.mana = 0;
    fell(f, moth);
    const up = only(
      stepUntil(f, (e) => e.t === "rise"),
      "rise",
    )[0];
    expect(up?.hp).toBe(Math.round((moth.maxHp * t("groot", "health", 3)) / 100));
    expect(t("groot", "health", 3)).toBeGreaterThan(t("groot", "health", 2));
    expect(moth.mana).toBe(Math.round((moth.manaFull * t("groot", "mana", 3)) / 100));
    expect(t("groot", "mana", 3)).toBe(50);
  });

  test("a figure in its true form has more attack and ability power; the Rock, Standing, attacks", () => {
    const f = ours("worm", "moth", "rock");
    const [worm, rock] = [unitOf(f, "worm"), unitOf(f, "rock")];
    const [attack, power] = [worm.attack, worm.power];
    expect(rock.attack).toBe(0);
    fell(f, worm);
    fell(f, rock);
    steps(f, secs(1));
    const more = 1 + t("groot", "more", 1) / 100;
    expect(more).toBeGreaterThan(1);
    expect(worm.attack).toBe(Math.round(attack * more));
    expect(worm.power).toBeCloseTo(power * more);
    expect(rock.attack).toBe(Math.round(formNumber("rock", "attack") * more));
    expect(rock.speed).toBe(formNumber("rock", "speed"));
  });

  test("with nowhere free to stand, it stays down for good", () => {
    const f = ours("worm", "moth");
    const worm = unitOf(f, "worm");
    fell(f, worm);
    // Every hex taken.
    f.taken = f.taken.map((id) => (id === -1 ? 999 : id));
    expect(only(steps(f, secs(1)), "rise")).toEqual([]);
    expect(worm.alive).toBe(false);
    expect(worm.fellAt).toBeGreaterThanOrEqual(0);
  });

  test("it gets up on the nearest free open hex anywhere on the board, however far, across the middle too; with none it stays down", () => {
    const f = ours("worm", "moth");
    const worm = unitOf(f, "worm");
    fell(f, worm);
    // Every hex taken but one on their half, five hexes from where it fell, across the middle line.
    const far = Array.from({ length: SEATS }, (_, cell) => cell).find((cell) => distance(worm.cell, cell) === 5) ?? -1;
    expect(far).toBeGreaterThanOrEqual(0);
    f.taken = f.taken.map((id, cell) => (cell === far ? -1 : id === -1 ? 999 : id));
    expect(only(steps(f, secs(1)), "rise")).toMatchObject([{ id: worm.id, cell: far }]);
    // Of two free hexes, the nearer; of two as near, the one the fight would take beside it (the lower).
    const g = ours("worm", "moth");
    const w = unitOf(g, "worm");
    fell(g, w);
    const [a, b] = [neighbours(w.cell)[0] ?? -1, neighbours(w.cell)[1] ?? -1];
    g.taken = g.taken.map((id, cell) => (cell === far || cell === a || cell === b ? -1 : id === -1 ? 999 : id));
    expect(only(steps(g, secs(1)), "rise")).toMatchObject([{ id: w.id, cell: Math.min(a, b) }]);
    // A full board: it stays down.
    const h = ours("worm", "moth");
    const x = unitOf(h, "worm");
    fell(h, x);
    h.taken = h.taken.map((id) => (id === -1 ? 999 : id));
    expect(only(steps(h, secs(1)), "rise")).toEqual([]);
    expect(x.alive).toBe(false);
  });

  test("a fight with figures getting back up plays the same, step by step or straight to its end", () => {
    const setup = {
      seed: 11,
      era: LEGACY_ERA,
      sides: [
        partyOfFigures([at("worm", 2, 0), at("moth", 3, 3), at("rock", 3, 0), at("greg", 4, 0), at("whitefox", 1, 0)]),
        partyOfFigures([at("badger", 2, 0, 3), at("badger", 4, 0, 3), at("fogowl", 3, 0, 2)]),
      ],
    } satisfies Parameters<typeof resolveFight>[0];
    const outcome = resolveFight(setup);
    const recorded = recordFight(setup);
    expect(recorded.summary).toEqual(outcome);
    expect(playsAsKept({ setup, outcome })).toBe(true);
    const rises = only(recorded.steps.flat(), "rise");
    expect(rises.length).toBeGreaterThan(0);
    expect(rises.every((r) => r.why === "groot" && r.form === "true")).toBe(true);
  });
});

/** One of ours, plain or in its true form and ready to cast, against Muds that do nothing. */
function formed(kind: UnitKind, form: "plain" | "true", foes: [number, number][]): { f: Fight; u: Unit } {
  const f = fightOf(
    [at(kind, 3, kind === "moth" ? 3 : 0)],
    foes.map(([col, row]) => at("mud", col, row)),
  );
  stillSide(f, 1);
  const u = unitOf(f, kind);
  u.form = form;
  u.mana = u.manaFull;
  return { f, u };
}
/** The enemies an ability of `u` hurt, by id, in order. */
const hurtBy = (events: readonly FightEvent[], u: Unit): number[] =>
  inOrder([
    ...new Set(
      only(events, "hit")
        .filter((h) => h.by === u.id && h.source === "ability")
        .map((h) => h.id),
    ),
  ]);
/** The Moth's first Wing Dust, plain or with its wings open, on a Mud in front and another two hexes behind it. */
function mothLands(form: "plain" | "true"): { events: FightEvent[]; u: Unit } {
  const { f, u } = formed("moth", form, [
    [3, 0],
    [3, 2],
  ]);
  return { events: stepUntil(f, (e) => e.t === "hit" && e.by === u.id), u };
}
/** How many hexes the first dust laid covers. */
const dusted = (events: FightEvent[]): number => only(events, "zone").find((z) => z.on)?.cells.length ?? 0;

describe("the true forms", () => {
  test("the Whole Worm: Under And Up also hits every enemy touching where it comes up", () => {
    // A full back row, so wherever it comes up beside the furthest it touches more than one.
    const foes = [0, 1, 2, 3, 4, 5, 6].map((col): [number, number] => [col, 3]);
    const plain = formed("worm", "plain", foes);
    expect(
      hurtBy(
        said(plain.f, () => cast(plain.f, plain.u)),
        plain.u,
      ),
    ).toHaveLength(1);
    const whole = formed("worm", "true", foes);
    const events = said(whole.f, () => cast(whole.f, whole.u));
    const touching = whole.f.units.filter((o) => o.side === 1 && distance(o.cell, whole.u.cell) <= 1);
    expect(touching.length).toBeGreaterThan(1);
    expect(hurtBy(events, whole.u)).toEqual(inOrder(touching.map((o) => o.id)));
  });

  test("Moth, Wings Open: Wing Dust covers the hexes two away as well", () => {
    const plain = mothLands("plain");
    const wide = mothLands("true");
    expect(hurtBy(plain.events, plain.u)).toHaveLength(1);
    expect(hurtBy(wide.events, wide.u)).toHaveLength(2);
    expect(dusted(wide.events)).toBeGreaterThan(dusted(plain.events));
  });

  test("Greg, Unnamed: Greg Sits Down first pulls every enemy within 3 hexes 1 hex nearer; the Rooted are never pulled", () => {
    const f = fightOf([at("greg", 3, 0)], [at("mud", 3, 0), at("mud", 1, 2), at("mud", 5, 2), at("seqwawa", 3, 2)]);
    for (const o of f.units) if (o.side === 1) idle(o);
    const greg = unitOf(f, "greg");
    greg.form = "true";
    const before = new Map(f.units.map((o) => [o.id, o.cell]));
    const events = said(f, () => expect(cast(f, greg)).toBe(true));
    const pulls = only(events, "leap").filter((l) => l.why === "pull");
    expect(pulls.length).toBeGreaterThan(0);
    for (const p of pulls) expect(distance(p.to, greg.cell)).toBe(distance(p.from, greg.cell) - 1);
    const seq = unitOf(f, "seqwawa", 1);
    expect(seq.cell).toBe(before.get(seq.id) ?? -1);
    expect(pulls.some((p) => p.id === seq.id)).toBe(false);
    // His plain self pulls nobody.
    const g = fightOf([at("greg", 3, 0)], [at("mud", 3, 0), at("mud", 1, 2), at("mud", 5, 2)]);
    for (const o of g.units) if (o.side === 1) idle(o);
    const plain = said(g, () => cast(g, unitOf(g, "greg")));
    expect(only(plain, "leap").filter((l) => l.why === "pull")).toEqual([]);
  });

  test("Orphion, Alight: Antlers Ring also gives the party 8% of its health back", () => {
    const f = fightOf([at("whitefox", 3, 0), at("crab7", 2, 0)], [at("mud", 3, 0)]);
    stillSide(f, 1);
    const [fox, crab] = [unitOf(f, "whitefox"), unitOf(f, "crab7")];
    crab.hp = 50;
    const plain = said(f, () => cast(f, fox));
    expect(only(plain, "heal")).toEqual([]);
    fox.form = "true";
    const alight = said(f, () => cast(f, fox));
    expect(only(alight, "heal").find((h) => h.id === crab.id)).toMatchObject({
      by: fox.id,
      amount: Math.round((crab.maxHp * formNumber("whitefox", "heal")) / 100),
    });
  });
});

describe("Rooted and the pull", () => {
  test("Seqwawa does not move or attack, and gains 12 mana a second", () => {
    const f = fightOf([at("seqwawa", 3, 3)], [at("mud", 3, 0)]);
    stillSide(f, 1);
    const seq = unitOf(f, "seqwawa");
    seq.manaFull = 1000;
    const start = seq.mana;
    const events = steps(f, secs(3));
    const its = events.filter((e) => "id" in e && e.id === seq.id && ["move", "swing", "shot", "leap"].includes(e.t));
    expect(its).toEqual([]);
    expect(seq.mana).toBe(start + 3 * t("rooted", "mana", 1));
    expect(seq.manaRate).toBe(12);
  });
  test("a Rooted figure cannot be pushed or pulled", () => {
    const f = fightOf([at("crab40", 3, 0)], [at("seqwawa", 3, 1), at("mud", 2, 0)]);
    const seq = unitOf(f, "seqwawa", 1);
    const crab = unitOf(f, "crab40");
    const cell = seq.cell;
    expect(pull(f, crab, seq)).toBe(false);
    expect(knockBack(f, seq, crab.cell, 2)).toBe(0);
    expect(seq.cell).toBe(cell);
    // Anyone else is pulled.
    expect(pull(f, crab, idle(unitOf(f, "mud", 1)))).toBe(true);
  });
});

/** Seqwawa behind a front row of three (and `more` in the second row), nobody hurt yet; the clock at 100. */
function stump(...more: UnitKind[]): { f: Fight; seq: Unit; crab: Unit; ember: Unit; gnome: Unit } {
  const f = fightOf(
    [
      at("seqwawa", 3, 3),
      at("crab7", 2, 0),
      at("emberkit", 3, 0),
      at("barrowgnome", 4, 0),
      ...more.map((k, i) => at(k, i, 1)),
    ],
    [at("mud", 3, 3)],
  );
  stillSide(f, 1);
  f.tick = 100;
  return {
    f,
    seq: unitOf(f, "seqwawa"),
    crab: unitOf(f, "crab7"),
    ember: unitOf(f, "emberkit"),
    gnome: unitOf(f, "barrowgnome"),
  };
}

describe("No GG Left Behind", () => {
  test("every friend gets 200 health back", () => {
    const { f, seq, crab, ember, gnome } = stump();
    for (const o of [crab, ember, gnome]) o.hp = 10;
    const events = said(f, () => expect(cast(f, seq)).toBe(true));
    for (const o of [crab, ember, gnome])
      expect(only(events, "heal").find((h) => h.id === o.id)?.amount).toBe(abilityNumber("seqwawa", "heal", 1));
  });
  test("the last friend to fall, if it fell in the last 3 seconds, gets back up with 200 health", () => {
    const { f, seq, crab, ember, gnome } = stump();
    fell(f, crab);
    f.tick += 10;
    fell(f, ember);
    f.tick += secs(3) - 10;
    gnome.hp = 50;
    const standing = f.standing[0];
    const events = said(f, () => cast(f, seq));
    expect(only(events, "rise")).toEqual([
      {
        t: "rise",
        id: ember.id,
        hp: abilityNumber("seqwawa", "back", 1),
        why: "seqwawa",
        form: "plain",
        cell: ember.cell,
      },
    ]);
    expect(f.standing[0]).toBe(standing + 1);
    expect(crab.alive).toBe(false);
  });
  test("one that fell longer ago than that stays down", () => {
    const { f, seq, crab, ember } = stump();
    fell(f, crab);
    f.tick += secs(3) + 1;
    ember.hp = 50;
    expect(
      only(
        said(f, () => cast(f, seq)),
        "rise",
      ),
    ).toEqual([]);
  });
  test("with Mender on, the health it gets back with counts for more, as healing does", () => {
    const { f, seq, crab, ember } = stump("mossmote");
    expect(seq.mending).toBe(t("mender", "mending", 1));
    fell(f, crab);
    ember.hp = 50;
    const up = only(
      said(f, () => cast(f, seq)),
      "rise",
    )[0];
    expect(up?.hp).toBe(Math.round(abilityNumber("seqwawa", "back", 1) * (1 + seq.mending / 100)));
  });
  test("it waits, as a heal does, while everyone is above 85% health", () => {
    const { f, seq } = stump();
    expect(cast(f, seq)).toBe(false);
  });
  test("it does not wait while a friend that fell in the last 3 seconds could be stood back up, though nobody is hurt", () => {
    const { f, seq, crab } = stump();
    fell(f, crab);
    f.tick += secs(1);
    const events = said(f, () => expect(cast(f, seq)).toBe(true));
    expect(only(events, "rise").map((r) => r.id)).toEqual([crab.id]);
  });
  test("of two friends falling on the same step, it stands up the one that fell last", () => {
    const { f, seq, crab, ember } = stump();
    expect(crab.id).toBeLessThan(ember.id);
    fell(f, crab);
    fell(f, ember);
    expect(
      only(
        said(f, () => cast(f, seq)),
        "rise",
      ).map((r) => r.id),
    ).toEqual([ember.id]);
    // And the other way round.
    const other = stump();
    fell(other.f, other.ember);
    fell(other.f, other.crab);
    expect(
      only(
        said(other.f, () => cast(other.f, other.seq)),
        "rise",
      ).map((r) => r.id),
    ).toEqual([other.crab.id]);
  });
});

describe("Moss and Mender at 2, 3 and 4", () => {
  test("Moss: the whole party regrows 1.2%, 2% and 3% of its health every second", () => {
    const moss: UnitKind[] = ["mossmote", "slug", "leafling", "seqwawa"];
    const regrows = [2, 3, 4].map((n) => unitOf(ours(...moss.slice(0, n), "crab7"), "crab7").regrow);
    expect(regrows).toEqual([1.2, 2, 3]);
  });
  test("Mender: healing and shields count for 20%, 30% and 35% more", () => {
    const menders: UnitKind[] = ["mossmote", "kettle", "crab23", "apothecary"];
    const mending = [2, 3, 4].map((n) => unitOf(ours(...menders.slice(0, n)), "kettle").mending);
    expect(mending).toEqual([20, 30, 35]);
  });
  test("Mender 4: healing past a friend's full health becomes a shield for 4 seconds, up to 15% of their health", () => {
    const f = ours("mossmote", "kettle", "crab23", "apothecary", "rock");
    const [kettle, rock] = [unitOf(f, "kettle"), unitOf(f, "rock")];
    rock.hp = rock.maxHp - 30;
    const events = said(f, () => heal(f, rock, 100, "ability", kettle));
    expect(only(events, "heal")[0]?.amount).toBe(30);
    const most = Math.floor((rock.maxHp * 15) / 100);
    expect(only(events, "shield")).toEqual([
      {
        t: "shield",
        id: rock.id,
        by: kettle.id,
        amount: Math.min(135 - 30, most),
        shield: Math.min(135 - 30, most),
        ticks: secs(4),
      },
    ]);
    // The shield is the healer's shielding in the tally, not the one it covers.
    const did = tally(events);
    expect(did.find((d) => d.id === kettle.id)?.shielded).toBe(Math.min(135 - 30, most));
    expect(did.find((d) => d.id === rock.id)?.shielded ?? 0).toBe(0);
    // Up to 15%, shields already on it counted: more healing at full health tops it up to that, and no further.
    expect(
      only(
        said(f, () => heal(f, rock, 1000, "ability", kettle)),
        "shield",
      )[0]?.shield,
    ).toBe(most);
    expect(
      only(
        said(f, () => heal(f, rock, 1000, "ability", kettle)),
        "shield",
      ),
    ).toEqual([]);
    // Regrowing is nobody's healing, and at Mender 3 there is no shield.
    const three = ours("mossmote", "kettle", "crab23", "rock");
    const r3 = unitOf(three, "rock");
    expect(
      only(
        said(three, () => heal(three, r3, 100, "ability", unitOf(three, "kettle"))),
        "shield",
      ),
    ).toEqual([]);
  });
});

test("Seqwawa is everyone's: a five-acorn Moss Mender, Rooted, that never attacks", () => {
  expect(FIGURES.seqwawa).toMatchObject({ tier: 5, kin: "moss", calling: "mender", extra: ["rooted"], attack: 0 });
  const f = fightOf([at("seqwawa", 3, 3)], [at("mud", 3, 0)]);
  still(unitOf(f, "mud", 1));
  expect(unitOf(f, "seqwawa").rooted).toBe(true);
});
