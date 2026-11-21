import { afterEach, describe, expect, test } from "bun:test";

import { SLOTS } from "./cloud.ts";
import { forgetStop, keepText, keptNames, keptText, stop, stopped } from "./keep.ts";
import { post, read } from "./postcard.ts";
import { balance, earn, forgetLedger, grant, KEY as PURSE_KEY, reset, spend } from "./purse.ts";
import { type Standin, standin } from "./standin.ts";

let world: Standin | null = null;
afterEach(() => {
  world?.done();
  world = null;
  forgetStop();
  forgetLedger();
});

/** Every name a cloud slot covers: what goes onto the member's account. */
const SLOT_NAMES = Object.values(SLOTS).flat();
const CARD = { waiting: "A raid under way", trophies: ["a banner"], till: 12 };

describe("keeping the game in the browser", () => {
  test("a page that has not stopped keeps a text, and forgets it", () => {
    world = standin({});
    expect(stopped()).toBe(false);
    expect(keepText("works.save.v2", "a yard")).toBe(true);
    expect(keptText("works.save.v2")).toBe("a yard");
    expect(keptNames()).toEqual(["works.save.v2"]);
    expect(keepText("works.save.v2", null)).toBe(true);
    expect(world.store.getItem("works.save.v2")).toBeNull();
  });

  test("once stopped, no name any cloud slot covers is written or forgotten", () => {
    world = standin({});
    expect(SLOT_NAMES.length).toBeGreaterThan(0);
    for (const name of SLOT_NAMES) world.store.setItem(name, "theirs");
    stop();
    expect(stopped()).toBe(true);
    for (const name of SLOT_NAMES) {
      expect(keepText(name, "mine")).toBe(false);
      expect(keepText(name, null)).toBe(false);
    }
    for (const name of SLOT_NAMES) expect(world.store.getItem(name)).toBe("theirs");
  });

  test("the purse is kept as it changes, until the page stops", () => {
    world = standin({});
    reset();
    earn(40, "a test");
    expect(JSON.parse(world.store.getItem(PURSE_KEY) ?? "null")).toEqual(balance());
    world.store.setItem(PURSE_KEY, '{"leaf":1,"coins":5}');
    stop();
    earn(40, "a test");
    spend("coins", 3, "a test");
    grant(10, "a test");
    reset();
    expect(world.store.getItem(PURSE_KEY)).toBe('{"leaf":1,"coins":5}');
  });

  test("a postcard is left for the town, until the page stops", () => {
    world = standin({});
    post("works", CARD);
    expect(read("works")).toEqual(CARD);
    world.store.setItem("town.postcard.raid.v1", "theirs");
    stop();
    post("works", { ...CARD, till: 99 });
    post("raid", CARD);
    expect(read("works")).toEqual(CARD);
    expect(world.store.getItem("town.postcard.raid.v1")).toBe("theirs");
  });
});

/**
 * What may write the browser's storage straight, without going through `keepText`: the guard itself,
 * where storage is handed out, and what is nobody's game (the names given), none of which a cloud
 * slot covers.
 */
const STRAIGHT: Readonly<Record<string, readonly string[]>> = {
  "packages/kit/src/keep.ts": [],
  "packages/kit/src/net.ts": [],
  "packages/kit/src/sound.ts": ["town.muted"],
  "packages/kit/src/live.ts": ["town.signin.v1"],
};
const WRITES = /\b(local|session)Storage\b|\.(setItem|removeItem|clear)\(\s*[^)]/;
const ROOT = new URL("../../../", import.meta.url).pathname;
/** Where the pages' own code is: the kit and the three games. */
const CODE = ["packages/kit/src", "apps/town/src", "apps/works/src", "apps/battler/src"];

const source = (path: string): Promise<string> => Bun.file(`${ROOT}${path}`).text();
/** Whether a file's text writes the browser's storage itself. */
const writes = (text: string): boolean => text.split("\n").some((line) => WRITES.test(line));

describe("every writer of the game goes through keepText", () => {
  test("nothing in the kit or the three games writes storage straight, but what is nobody's game", async () => {
    const paths = CODE.flatMap((dir) =>
      [...new Bun.Glob("**/*.ts").scanSync({ cwd: `${ROOT}${dir}` })]
        .filter((file) => !file.endsWith(".test.ts"))
        .map((file) => `${dir}/${file}`),
    );
    expect(paths).toContain("packages/kit/src/purse.ts");
    const texts = await Promise.all(paths.map(source));
    const straight = paths.filter((path, i) => !(path in STRAIGHT) && writes(texts[i] ?? ""));
    expect(straight).toEqual([]);

    const allowed = Object.entries(STRAIGHT);
    const allowedTexts = await Promise.all(allowed.map(([path]) => source(path)));
    allowed.forEach(([, names], i) => {
      for (const name of names) {
        expect(allowedTexts[i]).toContain(`"${name}"`);
        expect(SLOT_NAMES).not.toContain(name);
      }
    });
  });
});
