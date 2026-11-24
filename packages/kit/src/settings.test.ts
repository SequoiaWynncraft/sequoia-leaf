import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { LOUDEST, readQuiet, readVolume, SETTING_KEYS, settings } from "./settings.ts";
import { gainOf, heard, sample } from "./sound.ts";
import { type Standin, standin } from "./standin.ts";

let world: Standin | null = null;
beforeEach(() => {
  world = standin({});
  settings.reread();
});
afterEach(() => {
  settings.setVolume(LOUDEST);
  settings.setMuted(false);
  settings.setHeardAll([...settings.now.quiet], true);
  world?.done();
  world = null;
});

describe("the settings, as kept", () => {
  test("a volume is a whole number from 0 to 100; anything else, or none, is the loudest", () => {
    expect([null, "", "abc", "12.5", "-1", "101"].map(readVolume)).toEqual([100, 100, 100, 100, 100, 100]);
    expect(["0", "50", "100"].map(readVolume)).toEqual([0, 50, 100]);
  });

  test("the kinds switched off are a list of ids; anything else in it is let go", () => {
    expect([...readQuiet(null)]).toEqual([]);
    expect([...readQuiet("not json")]).toEqual([]);
    expect([...readQuiet('{"works.machines":true}')]).toEqual([]);
    expect([...readQuiet(`["works.machines", 3, "", "${"x".repeat(65)}"]`)]).toEqual(["works.machines"]);
  });

  test("a player muted before there was a volume is still muted, at the loudest", () => {
    world?.store.setItem("town.muted", "1");
    settings.reread();
    expect([settings.now.muted, settings.now.volume]).toEqual([true, 100]);
  });
});

describe("the settings of a page", () => {
  test("each is kept under its own key, so moving the volume never touches the mute", () => {
    settings.setMuted(true);
    settings.setVolume(37.6);
    expect(settings.now.volume).toBe(38);
    expect(world?.store.getItem(SETTING_KEYS.volume)).toBe("38");
    // Another page unmutes meanwhile; this page's volume does not put the mute back.
    world?.store.setItem(SETTING_KEYS.muted, "0");
    settings.setVolume(20);
    expect(world?.store.getItem(SETTING_KEYS.muted)).toBe("0");
    settings.setVolume(-5);
    expect(settings.now.volume).toBe(0);
  });

  test("another page's change is heard as it is kept, and told to the listeners once", () => {
    const heardNow: number[] = [];
    const stop = settings.listen((now) => heardNow.push(now.volume));
    world?.store.setItem(SETTING_KEYS.volume, "45");
    settings.reread();
    settings.reread();
    stop();
    settings.setVolume(60);
    expect(heardNow).toEqual([45]);
  });

  test("kinds of sound are switched off and on, kept in order, and forgotten once all are on", () => {
    settings.setHeardAll(["works.machines", "kit.coins"], false);
    expect(world?.store.getItem(SETTING_KEYS.quiet)).toBe('["kit.coins","works.machines"]');
    settings.setHeard("kit.coins", true);
    expect([...settings.now.quiet]).toEqual(["works.machines"]);
    settings.setHeard("works.machines", true);
    expect(world?.store.getItem(SETTING_KEYS.quiet)).toBeNull();
  });
});

describe("the sound the settings make", () => {
  test("100% is as loud as ever, 50% about 12 dB quieter, 0% and muted silent", () => {
    expect(gainOf({ volume: 100, muted: false })).toBe(0.5);
    expect(gainOf({ volume: 50, muted: false })).toBe(0.125);
    expect(20 * Math.log10(0.125 / 0.5)).toBeCloseTo(-12.04, 1);
    expect([gainOf({ volume: 0, muted: false }), gainOf({ volume: 80, muted: true })]).toEqual([0, 0]);
  });

  test("a kind switched off is not heard, but its sample in the menu is", () => {
    settings.setHeard("works.machines", false);
    let inSample = false;
    sample(() => {
      inSample = heard("works.machines");
    });
    expect([heard("works.machines"), heard("kit.coins"), inSample]).toEqual([false, true, true]);
  });
});
