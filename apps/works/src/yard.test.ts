import { describe, expect, jest, test } from "bun:test";

import {
  ALL_ITEMS,
  at,
  BELT,
  build,
  check,
  counts,
  create,
  deliver,
  FACTORY as WORKS,
  GOALS,
  item,
  LEAD,
  ORDER_WAITS,
  readAnswer,
  stepTo,
  TICK_MS,
  type Yard,
} from "@sequoia-leaf/factory";
import { staged } from "@sequoia-leaf/factory/test/yards.ts";
import type { Trouble } from "@sequoia-leaf/kit/play.ts";
import { balance } from "@sequoia-leaf/kit/purse.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";
import { Listened, type Reply, type Sent, standin } from "@sequoia-leaf/kit/standin.ts";

import {
  act,
  clear,
  ctx,
  type FakeLeaf,
  fakeLeaf,
  isRecord,
  kindAt,
  kindOn,
  net,
  opened,
  until,
  useFakeLeaf,
} from "../test/fake-leaf.ts";
import { S } from "./state.ts";
import { cancel, place, setTool, toolHooks, undo } from "./tools.ts";
import { letters } from "./ui/letter.ts";
import {
  again,
  CATCHING_UP,
  catchingUp,
  differences,
  doNow,
  gate,
  letGo,
  onRefused,
  openYard,
  runYard,
} from "./yard.ts";

useFakeLeaf();

/** The staged mid yard, with the board up, standing for Leaf's clock now, and its first order filled. */
function board(): Yard {
  const yard = staged("mid");
  const first = yard.board[0];
  if (!first) throw new Error("no board");
  yard.at = ctx().now;
  first.filled.set(first.want);
  return yard;
}
/** A new yard with its first three lessons filled at the depot: the fourth, which puts the board up, in hand. */
function beforeTheBoard(): Yard {
  const yard = create({ seed: 7 });
  for (const [name, n] of [
    ["plank", 12],
    ["ingot", 12],
    ["brick", 12],
    ["tool", 10],
  ] as const)
    deliver(yard, item(name), n);
  return yard;
}

/** The page's clock and Leaf's run on together, `ms` past the opening; Leaf runs its yard on to the copy's tick, as it may. */
function runBoth(fake: FakeLeaf, ms: number): void {
  fake.leaf.ms = ms;
  performance.now = () => 1000 + ms;
  runYard(1000 + ms);
  stepTo(fake.leaf.yard, S.world.tick);
}

/** Leaf answers each call to `route` only when the test lets it go (`held`, oldest first), as it stands then. */
function holding(fake: FakeLeaf, route: keyof FakeLeaf["routes"]) {
  const held: (() => void)[] = [];
  net.world?.done();
  net.world = standin({
    ...fake.routes,
    [route]: (sent: Sent) => new Promise<Reply>((answer) => held.push(() => answer(fake.routes[route](sent)))),
  });
  return held;
}

/** Just enough of an element for the letter: it hears what reaches it, counts who listens, and holds nothing. */
class Part extends Listened {
  className = "";
  textContent = "";
  hidden = true;
  readonly classList = { add: (): void => undefined, remove: (): void => undefined };
  readonly setAttribute = (): void => undefined;
  readonly appendChild = <T>(kid: T): T => kid;
  readonly replaceChildren = (): void => undefined;
  readonly focus = (): void => undefined;
  readonly getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
}
/**
 * The page: a window, which hears every press first, with the gate on it, and the letter's place.
 * Made after the yard is opened, so that the kit hears nothing of it.
 */
function page(): { window: EventTarget; letter: Part } {
  const win = new EventTarget();
  const letter = new Part();
  const doc = {
    createElement: () => new Part(),
    createTextNode: () => new Part(),
    getElementById: (id: string) => (id === "letter" ? letter : null),
  };
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  gate(cancel);
  return { window: win, letter };
}

describe("the yard, on Leaf", () => {
  test("reads what Leaf really answers a batch of the Works' commands", async () => {
    const contract: unknown = await Bun.file(new URL("../../../contracts/leaf-game-v1.json", import.meta.url)).json();
    const exchange = isRecord(contract) ? contract["POST /v1/game/play/{game}, the Works"] : null;
    const body = isRecord(exchange) ? exchange.body : null;
    const state = isRecord(body) ? body.state : null;
    expect(readAnswer(state)).toEqual({
      clock: expect.any(Number),
      tick: expect.any(Number),
      check: expect.any(Number),
      hung: [],
    });
    expect(isRecord(body) && body.results).toEqual([{ id: "w-1", notes: [] }]);
  });

  test("opens as Leaf has it, and keeps nothing of the game in the browser", async () => {
    const fake = await opened();
    expect(S.world.seed).toBeNull();
    expect(WORKS.encode(S.world)).toBe(WORKS.encode({ ...fake.leaf.yard, seed: null }));
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    doNow(act({ do: "build", kind: "belt", dir: 0, ...a }));
    await until(() => fake.leaf.posts >= 1);
    expect([...(net.world?.store.map.keys() ?? [])].filter((k) => k.startsWith("works.save"))).toEqual([]);
  });

  test("with no Leaf answering, there is no yard", async () => {
    net.world = standin({ "GET /v1/game/play/works": "offline" });
    expect(await openYard("p", () => undefined)).toBe("closed");
  });

  test("a build shows at once, from the rules, before Leaf has even been asked", async () => {
    const fake = await opened();
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    expect("refused" in doNow(act({ do: "build", kind: "belt", dir: 0, ...a }))).toBe(false);
    expect(kindAt(a)).toBe("belt");
    expect(fake.leaf.posts).toBe(0);
    await until(() => fake.leaf.posts >= 1);
    expect(kindOn(fake.leaf.yard, a)).toBe("belt");
    // One the rules turn down is said so, and not sent.
    const refused = doNow(act({ do: "remove", x: 0, y: 0 }));
    expect("refused" in refused && refused.why).toBe("There is nothing here");
    await Bun.sleep(5);
    expect(fake.leaf.posts).toBe(1);
  });

  test("a raise still on its way stays paid for in the purse when Leaf answers the one before it", async () => {
    const yard = create({ seed: 5, tier: 3 });
    yard.at = ctx().now;
    build(yard, BELT, 20, 16, 0, Infinity);
    build(yard, BELT, 21, 16, 0, Infinity);
    const fake = await opened(yard, 1000);
    const held = holding(fake, "POST /v1/game/play/works");
    // A belt raised to grade 2 where it stands: paid for.
    doNow(act({ do: "build", kind: "belt", dir: 0, grade: 2, x: 20, y: 16 }));
    const price = 1000 - balance().coins;
    expect(price).toBeGreaterThan(0);
    await until(() => held.length >= 1);
    // The second waits behind the first; both show paid for at once.
    doNow(act({ do: "build", kind: "belt", dir: 0, grade: 2, x: 21, y: 16 }));
    expect(balance().coins).toBe(1000 - 2 * price);
    // Leaf answers the first, with its balances after the first alone: the second is still shown paid for.
    held.shift()?.();
    await until(() => held.length >= 1);
    expect(balance().coins).toBe(1000 - 2 * price);
    held.shift()?.();
    await until(() => fake.leaf.posts >= 2);
    await Bun.sleep(2);
    expect([balance().coins, fake.leaf.coins]).toEqual([1000 - 2 * price, 1000 - 2 * price]);
  });

  test("Leaf's yard, when it is not the copy, takes the copy's place", async () => {
    const fake = await opened();
    const [a, b] = clear(2);
    if (!a || !b) throw new Error("no room");
    // Another page of the member's builds a mill.
    fake.elsewhere({ do: "build", kind: "mill", dir: 0, ...b });
    expect(kindAt(b)).toBeUndefined();
    doNow(act({ do: "build", kind: "belt", dir: 0, ...a }));
    await until(() => kindAt(b) === "mill");
    expect([kindAt(a), kindAt(b)]).toEqual(["belt", "mill"]);
    expect(fake.leaf.reads).toHaveLength(2);
  });

  test("two commands in flight when the copy is found not Leaf's are both answered before Leaf's yard is asked for, and the copy is then exactly Leaf's", async () => {
    const fake = await opened();
    const [a, b, c] = clear(3);
    if (!a || !b || !c) throw new Error("no room");
    fake.elsewhere({ do: "build", kind: "mill", dir: 0, ...c });
    // The second waits for the first, which Leaf answers; it finds no network at first, then is sent again.
    fake.leaf.answers = 1;
    doNow(act({ do: "build", kind: "belt", dir: 0, ...a }));
    doNow(act({ do: "build", kind: "belt", dir: 1, ...b }));
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(20);
    expect(fake.leaf.calls).toEqual(["read", "batch"]);
    fake.leaf.answers = Infinity;
    await until(() => kindAt(c) === "mill");
    expect(fake.leaf.calls).toEqual(["read", "batch", "batch", "read"]);
    expect(WORKS.encode(S.world)).toBe(WORKS.encode({ ...fake.leaf.yard, seed: null }));
    expect(fake.leaf.yard.dir[at(fake.leaf.yard, b.x, b.y)]).toBe(1);
  });

  test("let go, the page sends nothing more: a command Leaf never answered does not reach the next Leaf there", async () => {
    const fake = await opened();
    fake.leaf.answers = 0;
    doNow(act({ do: "collect" }));
    await until(() => net.world?.sent.some((s) => s.method === "POST") ?? false);
    letGo();
    const next = fakeLeaf();
    net.world?.done();
    net.world = standin(next.routes);
    // Past the first wait before a failed batch is sent again (`RETRY`, half a second and a quarter).
    await Bun.sleep(700);
    expect(next.leaf.calls).toEqual([]);
  });

  test("a command Leaf answers alike leaves the copy as it is: the same yard, not read again", async () => {
    const fake = await opened();
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    const [copy, rev] = [S.world, S.world.rev];
    doNow(act({ do: "build", kind: "belt", dir: 0, ...a }));
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(5);
    runYard(1000);
    // The build is one change to the copy, counted once; the copy is the same yard, not read again.
    expect([S.world, S.world.rev, fake.leaf.reads.length, differences()]).toEqual([copy, rev + 1, 1, 0]);
  });

  test("two commands unanswered at once are each compared at the tick the copy did it, though it has run on", async () => {
    const fake = await opened();
    const [a, b] = clear(2);
    if (!a || !b) throw new Error("no room");
    const copy = S.world;
    fake.leaf.ms = 6000;
    doNow(act({ do: "build", kind: "belt", dir: 0, ...a }));
    // Five seconds on the copy before the second; Leaf's clock is as the page reckons it.
    runYard(1000 + 5000);
    doNow(act({ do: "build", kind: "mill", dir: 0, ...b }));
    runYard(1000 + 6000);
    expect(S.world.tick).toBe(60);
    await until(() => fake.leaf.posts >= 2);
    await Bun.sleep(5);
    expect([S.world, fake.leaf.reads.length, differences()]).toEqual([copy, 1, 0]);
  });

  test("an answer whose check is not the copy's is counted, and Leaf's yard is asked for once, with the tick, and taken as it is", async () => {
    const fake = await opened();
    const [a, b] = clear(2);
    if (!a || !b) throw new Error("no room");
    // The copy goes astray, as a fault in the rules would make it.
    S.world.till += 5;
    doNow(act({ do: "build", kind: "belt", dir: 0, ...a }));
    await until(() => fake.leaf.reads.length >= 2);
    await Bun.sleep(5);
    expect(fake.leaf.reads).toEqual(["/v1/game/play/works", "/v1/game/play/works?differs=0"]);
    expect([differences(), S.world.till, kindAt(a)]).toEqual([1, 0, "belt"]);
    expect(WORKS.encode(S.world)).toBe(WORKS.encode({ ...fake.leaf.yard, seed: null }));
    // In step again: the next is answered alike.
    doNow(act({ do: "build", kind: "belt", dir: 0, ...b }));
    await until(() => fake.leaf.posts >= 2);
    await Bun.sleep(5);
    expect([fake.leaf.reads.length, differences()]).toEqual([2, 1]);
  });

  test("a read of Leaf's yard that fails is asked again a couple of seconds on, and nothing is sent meanwhile", async () => {
    const fake = await opened();
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    let fails = true;
    net.world?.done();
    net.world = standin({
      ...fake.routes,
      "GET /v1/game/play/works": (sent) => (fails ? "offline" : fake.routes["GET /v1/game/play/works"](sent)),
    });
    S.world.till += 5;
    doNow(act({ do: "build", kind: "belt", dir: 0, ...a }));
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(5);
    // A minute on, the copy would collect, but it is not in step: nothing goes.
    runYard(1000 + 1000);
    runYard(1000 + 61_000);
    await Bun.sleep(5);
    fails = false;
    runYard(1000 + 63_000);
    await until(() => fake.leaf.calls.length >= 3);
    const asked = net.world.sent.filter((s) => s.method === "GET").length;
    expect([fake.leaf.calls, asked, differences(), S.world.till]).toEqual([["read", "batch", "read"], 3, 1, 0]);
  });

  test("while Leaf's yard is being taken, a script's command is refused and the copy stands still", async () => {
    const fake = await opened();
    const [a, b] = clear(2);
    if (!a || !b) throw new Error("no room");
    const held = holding(fake, "GET /v1/game/play/works");
    S.world.till += 5;
    doNow(act({ do: "build", kind: "belt", dir: 0, ...a }));
    await until(() => held.length >= 1);
    const [copy, tick] = [S.world, S.world.tick];
    expect(doNow(act({ do: "build", kind: "belt", dir: 0, ...b }))).toEqual({
      refused: "catching_up",
      why: CATCHING_UP,
    });
    // Three seconds on, the copy has not moved; after the first second, the line over the dock says why.
    runYard(1000 + 3000);
    expect([S.world, S.world.tick, kindAt(b), fake.leaf.posts]).toEqual([copy, tick, undefined, 1]);
    expect([catchingUp(1000 + 900), catchingUp(1000 + 1100)]).toEqual([false, true]);
    held.shift()?.();
    await until(() => !catchingUp(1000 + 1100));
    // In step again, the yard takes input.
    expect("refused" in doNow(act({ do: "build", kind: "belt", dir: 0, ...b }))).toBe(false);
    await until(() => fake.leaf.posts >= 2);
    expect([kindAt(b), differences()]).toEqual(["belt", 1]);
  });

  test("undo pressed while Leaf's yard is being taken leaves what there is to undo as it was", async () => {
    const fake = await opened();
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    const held = holding(fake, "GET /v1/game/play/works");
    const { window: win } = page();
    // The page's Z, which hears a key only after the gate.
    win.addEventListener("keydown", () => void undo());
    const said: string[] = [];
    toolHooks.said = (text) => void said.push(text);
    // The copy has gone astray: the belt is answered with a check that differs, and Leaf's yard is asked for.
    S.world.till += 5;
    setTool(BELT);
    expect(place(a.x, a.y)).toBe(true);
    await until(() => held.length >= 1);
    // The tool's ghost was put away as taking began, and the press reaches nothing.
    expect(S.aim).toBeNull();
    win.dispatchEvent(new Event("keydown"));
    expect([kindAt(a), said, fake.leaf.posts]).toEqual(["belt", [], 1]);
    held.shift()?.();
    await until(() => !catchingUp(1000 + 1100));
    // In step again, the same press undoes the belt: it was still there to undo.
    win.dispatchEvent(new Event("keydown"));
    expect([kindAt(a), said]).toEqual([undefined, []]);
    await until(() => fake.leaf.posts >= 2);
  });

  test("the letter's button pressed while Leaf's yard is being taken leaves the letter up, and collects when pressed after", async () => {
    const fake = await opened();
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    const held = holding(fake, "GET /v1/game/play/works");
    const { window: win, letter: part } = page();
    // A press goes on from the window down to the letter, unless the gate stops it.
    win.addEventListener("click", () => part.dispatchEvent(new Event("click")));
    const letter = letters(scope());
    letter.show({ seconds: 600, coins: 0, made: counts() }, () => undefined);
    S.world.till += 5;
    doNow(act({ do: "build", kind: "belt", dir: 0, ...a }));
    await until(() => held.length >= 1);
    win.dispatchEvent(new Event("click"));
    expect([letter.reading(), fake.leaf.posts]).toEqual([true, 1]);
    held.shift()?.();
    await until(() => !catchingUp(1000 + 1100));
    win.dispatchEvent(new Event("click"));
    expect(letter.reading()).toBe(false);
    await until(() => fake.leaf.posts >= 2);
    expect(fake.leaf.commands.map((c) => isRecord(c) && c.do)).toEqual(["build", "collect"]);
  });

  test("the letter put away by a key takes its click off the page with it", async () => {
    await opened();
    const { letter: part } = page();
    const letter = letters(scope());
    letter.show({ seconds: 600, coins: 0, made: counts() }, () => undefined);
    expect(part.listening).toBe(1);
    expect(letter.putAway()).toBe(true);
    expect([letter.reading(), part.listening]).toEqual([false, 0]);
    expect(letter.putAway()).toBe(false);
  });

  test("a letter shown while the one before it fades is not put away by that fading, nor sounds its lines", async () => {
    await opened();
    const { letter: part } = page();
    jest.useFakeTimers();
    try {
      const letter = letters(scope());
      const away = { seconds: 600, coins: 0, made: counts() };
      letter.show(away, () => undefined);
      letter.putAway();
      letter.show(away, () => undefined);
      jest.advanceTimersByTime(2000);
      expect([letter.reading(), part.hidden, part.listening]).toEqual([true, false, 1]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("a yard staged from outside is taken once what is in flight is answered, from a read set off after the staging", async () => {
    const fake = await opened();
    const [a, b] = clear(2);
    if (!a || !b) throw new Error("no room");
    const held = holding(fake, "POST /v1/game/play/works");
    doNow(act({ do: "build", kind: "belt", dir: 0, ...a }));
    await until(() => held.length >= 1);
    // Staged on Leaf while the belt is on its way.
    fake.elsewhere({ do: "build", kind: "mill", dir: 0, ...b });
    const staging = again();
    const first = await Promise.race([staging.then(() => "taken"), Bun.sleep(20).then(() => "waiting")]);
    expect([first, fake.leaf.reads.length]).toEqual(["waiting", 1]);
    held.shift()?.();
    await staging;
    expect([kindAt(a), kindAt(b), catchingUp(Infinity)]).toEqual(["belt", "mill", false]);
    expect(WORKS.encode(S.world)).toBe(WORKS.encode({ ...fake.leaf.yard, seed: null }));
  });

  test("a read of Leaf's yard that ends the page goes to its screen, and is not asked again", async () => {
    const fake = fakeLeaf();
    let opening = true;
    net.world = standin({
      ...fake.routes,
      "GET /v1/game/play/works": (sent) =>
        opening
          ? fake.routes["GET /v1/game/play/works"](sent)
          : { status: 401, body: { code: "unauthorized", message: "Signed out" } },
    });
    const told: Trouble[] = [];
    expect(await openYard("p", (why) => told.push(why))).toBeNull();
    opening = false;
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    S.world.till += 5;
    doNow(act({ do: "build", kind: "belt", dir: 0, ...a }));
    await until(() => told.length > 0);
    for (const later of [2000, 4000, 10_000, 60_000]) runYard(1000 + later);
    await Bun.sleep(5);
    const reads = net.world.sent.filter((s) => s.method === "GET").length;
    expect([told, reads]).toEqual([["signedout"], 2]);
    // The screen that says why can be pressed: the page is no longer taking, so nothing is stopped.
    expect(catchingUp(performance.now() + 60_000)).toBe(false);
    // Nor does a later frame begin taking again, however far behind the copy is by then.
    runYard(performance.now() + 600_000);
    expect(catchingUp(performance.now() + 700_000)).toBe(false);
  });

  test("a copy run ahead of Leaf's clock takes Leaf's yard, once, and stays in step under steady building", async () => {
    const fake = await opened();
    const [a, b, ...more] = clear(8);
    if (!a || !b) throw new Error("no room");
    // Ten seconds ahead by the page's reckoning; Leaf's clock has not moved.
    runYard(1000 + 10_000);
    doNow(act({ do: "build", kind: "belt", dir: 0, ...a }));
    await until(() => fake.leaf.reads.length >= 2);
    await Bun.sleep(5);
    // Leaf did it at its clock and LEAD ticks ahead, and the copy is Leaf's yard, there.
    expect([S.world.tick, kindAt(a)]).toEqual([LEAD, "belt"]);
    doNow(act({ do: "build", kind: "belt", dir: 0, ...b }));
    for (const t of more) doNow(act({ do: "build", kind: "belt", dir: 0, ...t }));
    await until(() => fake.leaf.commands.length >= 8);
    await Bun.sleep(5);
    expect([fake.leaf.reads.length, differences(), more.map(kindAt)]).toEqual([2, 0, more.map(() => "belt")]);
  });

  test("a command Leaf turns down: the member is told, and the copy becomes Leaf's yard, with no difference counted", async () => {
    const fake = await opened();
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    const told: string[] = [];
    onRefused((why) => told.push(why));
    // Another page of the member's put a mill where this one sets a belt down.
    fake.elsewhere({ do: "build", kind: "mill", dir: 0, ...a });
    doNow(act({ do: "build", kind: "belt", dir: 0, ...a }));
    await until(() => kindAt(a) === "mill");
    expect([told, fake.leaf.reads.length, differences()]).toEqual([["That could not be done after all"], 2, 0]);
  });

  /** Ways Leaf hangs an order: a yard to open, and what the member (or the depot) does to it. */
  const hangings: [string, () => Yard, (fake: FakeLeaf) => void][] = [
    ["a hand-over", board, () => void doNow(act({ do: "handOver", order: S.world.board[0]?.id ?? 0 }))],
    ["a swap", board, () => void doNow(act({ do: "swap", order: S.world.board[1]?.id ?? 0 }))],
    [
      "the lesson that puts the board up, filled in the depot",
      beforeTheBoard,
      (fake) => {
        const want = S.world.hand === -1 ? counts() : (GOALS[S.world.hand]?.want ?? counts());
        for (const w of [S.world, fake.leaf.yard]) for (const n of ALL_ITEMS) deliver(w, n, want[n] ?? 0);
        // The board is up and empty: the page asks Leaf, which hangs its orders.
        runYard(1000);
      },
    ],
  ];
  test.each(hangings)(
    "an order Leaf hangs for %s comes with its answer, and the copy agrees with Leaf's yard before, at and after it counts, with no yard taken",
    async (_, yard, hang) => {
      const y = yard();
      y.at = ctx().now;
      const fake = await opened(y);
      const before = new Set(fake.leaf.yard.board.map((o) => o.id));
      hang(fake);
      await until(() => S.world.board.length === fake.leaf.yard.open.hooks);
      await Bun.sleep(5);
      const ids = fake.leaf.yard.board.map((o) => o.id);
      expect(ids.filter((id) => !before.has(id)).length).toBeGreaterThan(0);
      expect([S.world.board.map((o) => o.id), check(S.world)]).toEqual([ids, check(fake.leaf.yard)]);
      const starts = Math.max(...fake.leaf.yard.board.map((o) => o.starts));
      const opening = fake.leaf.yard.tick;
      for (const tick of [starts - 1, starts, starts + 30]) {
        runBoth(fake, (tick - opening) * TICK_MS);
        expect([tick, S.world.tick, check(S.world)]).toEqual([tick, tick, check(fake.leaf.yard)]);
      }
      expect([fake.leaf.reads.length, differences()]).toEqual([1, 0]);
    },
  );

  test("an order heard of after it began to count takes Leaf's yard, once", async () => {
    const fake = await opened(board());
    const held: (() => void)[] = [];
    net.world?.done();
    net.world = standin({
      ...fake.routes,
      "POST /v1/game/play/works": (sent) =>
        new Promise<Reply>((answer) => held.push(() => answer(fake.routes["POST /v1/game/play/works"](sent)))),
    });
    doNow(act({ do: "handOver", order: S.world.board[0]?.id ?? 0 }));
    await until(() => held.length >= 1);
    // The answer is a long time coming: the copy has run past the tick the order counts from.
    runBoth(fake, (ORDER_WAITS + 10) * TICK_MS);
    held.shift()?.();
    await until(() => fake.leaf.reads.length >= 2);
    await Bun.sleep(5);
    expect([fake.leaf.reads.length, differences()]).toEqual([2, 0]);
    expect(S.world.board.map((o) => o.id)).toEqual(fake.leaf.yard.board.map((o) => o.id));
  });

  test("a hundred hand-overs, five seconds apart, take no yard", async () => {
    const fake = await opened(board());
    const handed = fake.leaf.yard.handed;
    for (let k = 1; k <= 100; k++) {
      // The oldest order is filled in both yards at the same tick, as the depot would fill it, and five seconds on it is handed over.
      const order = S.world.board[0];
      if (!order) throw new Error("no board");
      for (const w of [S.world, fake.leaf.yard]) {
        const same = w.board.find((o) => o.id === order.id);
        if (same) same.filled.set(same.want);
      }
      runBoth(fake, k * ORDER_WAITS * TICK_MS);
      expect("refused" in doNow(act({ do: "handOver", order: order.id }))).toBe(false);
      // oxlint-disable-next-line no-await-in-loop -- one hand-over after another
      await until(() => S.world.board.length === 3);
    }
    await Bun.sleep(5);
    expect([fake.leaf.reads.length, differences(), fake.leaf.yard.handed - handed]).toEqual([1, 0, 100]);
  });

  test.each([
    ["before", ORDER_WAITS - 5],
    ["after", ORDER_WAITS + 10],
  ])(
    "an earlier batch's answer naming an order the member has since swapped out does not put it back, %s it counts",
    async (_, late) => {
      const fake = await opened(board());
      const held = holding(fake, "POST /v1/game/play/works");
      const [a] = clear(1);
      if (!a) throw new Error("no room");
      /** The page's clock and Leaf's, `ticks` past the opening; Leaf runs its yard only as it is sent commands. */
      const on = (ticks: number): void => {
        fake.leaf.ms = ticks * TICK_MS;
        performance.now = () => 1000 + ticks * TICK_MS;
        runYard(1000 + ticks * TICK_MS);
      };
      // An order is handed over, and Leaf's answer brings the one it hangs in its place.
      doNow(act({ do: "handOver", order: S.world.board[0]?.id ?? 0 }));
      await until(() => held.length >= 1);
      held.shift()?.();
      await until(() => S.world.board.length === 3);
      const hung = S.world.board.at(-1);
      if (!hung) throw new Error("no order hung");
      // A belt goes, and before Leaf answers it the member swaps the new order out.
      on(5);
      doNow(act({ do: "build", kind: "belt", dir: 0, ...a }));
      await until(() => held.length >= 1);
      on(40);
      expect("refused" in doNow(act({ do: "swap", order: hung.id }))).toBe(false);
      // The belt's answer still names the order, and comes when the copy is `late` ticks on.
      on(late);
      held.shift()?.();
      await until(() => held.length >= 1);
      expect(S.world.board.map((o) => o.id)).not.toContain(hung.id);
      held.shift()?.();
      await until(() => S.world.board.length === 3);
      await Bun.sleep(5);
      const ids = fake.leaf.yard.board.map((o) => o.id);
      expect([S.world.board.map((o) => o.id), ids.includes(hung.id)]).toEqual([ids, false]);
      expect([fake.leaf.reads.length, differences()]).toEqual([1, 0]);
    },
  );

  test("what a frame's steps made known is told even when that frame also collects", async () => {
    const fake = await opened();
    const done = { kind: "done", goal: "planks", title: "Planks for the Treasury", pay: 80 } as const;
    runYard(1000 + 30_000);
    S.world.news.push(done);
    // A minute after the yard opened, this frame collects; the collection must not swallow the news.
    expect(runYard(1000 + 60_000)).toEqual([done]);
    await until(() => fake.leaf.posts >= 1);
  });

  test("a tab that comes back asks Leaf for its yard once every two seconds, however often it draws", async () => {
    const fake = await opened();
    let asked = 0;
    net.world?.done();
    net.world = standin({
      ...fake.routes,
      "GET /v1/game/play/works": () => {
        asked += 1;
        return "offline";
      },
    });
    // Ten minutes on, with no network: ten frames in a row ask once, and a frame two seconds later asks again.
    const back = 1000 + 600_000;
    for (let frame = 0; frame < 10; frame++) runYard(back + frame * 16);
    await Bun.sleep(5);
    expect(asked).toBe(1);
    runYard(back + 2000);
    await Bun.sleep(5);
    expect(asked).toBe(2);
  });

  test("a frame that runs the yard to where it stands still holds its clock there, and its owner's next command starts it from then", async () => {
    const fake = await opened();
    // Leaf answers nothing more: the copy is the page's own.
    fake.leaf.answers = 0;
    // Its owner was last there ten seconds short of eight hours ago.
    S.world.seen = { ...S.world.seen, tick: S.world.tick - S.world.open.away + 100 };
    // A tab back after fifty seconds runs the copy ten, to where it stands still.
    runYard(1000 + 50_000);
    expect(S.world.tick).toBe(100);
    doNow(act({ do: "collect" }));
    runYard(1000 + 50_016);
    expect(S.world.tick).toBe(100);
    runYard(1000 + 51_000);
    expect(S.world.tick).toBe(110);
  });

  test("a tab that comes back shows its letter once: an answer from before the collect does not bring it back", async () => {
    const fake = await opened();
    // While the tab was away, Leaf ran the yard ten minutes: it has a letter for its owner.
    stepTo(fake.leaf.yard, 6000);
    fake.leaf.yard.at = ctx().now;
    // Leaf takes its time to answer a question for the yard, with the yard as it was asked.
    const held: (() => void)[] = [];
    net.world?.done();
    net.world = standin({
      ...fake.routes,
      "GET /v1/game/play/works": () => {
        const reply = {
          status: 200,
          body: { rev: fake.leaf.posts, now: "x", state: WORKS.view(fake.leaf.yard, ctx()) },
        };
        return new Promise<Reply>((answer) => held.push(() => answer(reply)));
      },
    });
    const back = 1000 + 600_000;
    performance.now = () => back;
    runYard(back);
    runYard(back + 2000);
    await Bun.sleep(5);
    expect(held).toHaveLength(1);
    held.shift()?.();
    await Bun.sleep(5);
    runYard(back + 16);
    expect(S.world.away).not.toBeNull();
    doNow(act({ do: "collect" }));
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(5);
    runYard(back + 32);
    expect(S.world.away).toBeNull();
    for (const answer of held) answer();
    await Bun.sleep(5);
    runYard(back + 48);
    expect(S.world.away).toBeNull();
  });

  test("runs the copy on by Leaf's clock, and takes a yard put in place of another as it stands", async () => {
    const fake = await opened();
    // Fifty seconds, and fifty more: the copy runs on by itself, five hundred ticks each time.
    runYard(1000 + 50_000);
    runYard(1000 + 100_000);
    expect(S.world.tick).toBe(1000);
    // Leaf's yard is replaced by a new one, back at its first tick.
    fake.leaf.yard = WORKS.create(ctx());
    performance.now = () => 1000 + 100_000;
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    doNow(act({ do: "build", kind: "belt", dir: 0, ...a }));
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(5);
    runYard(1000 + 100_000);
    // The build, made at the old yard's tick, was done as far ahead of the new one's clock as Leaf does one.
    expect(S.world.tick).toBe(LEAD);
    expect(kindAt(a)).toBe("belt");
  });
});
