import { beforeEach, describe, expect, test } from "bun:test";

import { balance, earn, reset, spend } from "@sequoia-leaf/kit/purse.ts";

import { MOST_OWNED, MOST_PARCELS, owned, parseCamp } from "./camp.ts";
import { buyForCamp, camp, roomByTrail, sendToCamp } from "./record.ts";

describe("sending things to the camp", () => {
  beforeEach(() => {
    reset();
    camp.parcels = [];
    camp.tray = {};
  });

  test("the 201st purchase is refused and costs nothing, and the 200 waiting are all kept", () => {
    earn(1000, "a test");
    let asked = 0;
    const pay = (): boolean => {
      asked++;
      return spend("coins", 3, "a gnome");
    };
    for (let i = 0; i < MOST_PARCELS; i++) expect(buyForCamp("gnome", pay)).toBe("sent");
    expect(roomByTrail()).toBe(false);
    const coins = balance().coins;
    expect(buyForCamp("gnome", pay)).toBe("full");
    expect(asked).toBe(MOST_PARCELS);
    expect(balance().coins).toBe(coins);
    expect(camp.parcels).toHaveLength(MOST_PARCELS);
    expect(parseCamp(JSON.parse(JSON.stringify(camp)))?.parcels).toHaveLength(MOST_PARCELS);
  });

  test("nothing more is sent while the trail is full, and room comes back once a parcel is opened", () => {
    for (let i = 0; i < MOST_PARCELS; i++) expect(sendToCamp("gnome")).toBe(true);
    expect(sendToCamp("well")).toBe(false);
    expect(camp.parcels).toHaveLength(MOST_PARCELS);
    camp.parcels.shift();
    expect(sendToCamp("well")).toBe(true);
    expect(camp.parcels.at(-1)).toBe("well");
  });

  test("the purchase that would make a thousand of one thing is refused and costs nothing", () => {
    earn(100, "a test");
    // Counted wherever they are: standing by the fire, waiting by the trail, and in the tray.
    const standing = camp.placed.filter((p) => p.id === "log-seat").length;
    expect(standing).toBeGreaterThan(0);
    camp.parcels = ["log-seat"];
    camp.tray = { "log-seat": MOST_OWNED - standing - 2 };
    let asked = 0;
    const pay = (): boolean => {
      asked++;
      return spend("coins", 3, "a log seat");
    };
    expect(buyForCamp("log-seat", pay)).toBe("sent");
    expect(owned(camp, "log-seat")).toBe(MOST_OWNED);
    const coins = balance().coins;
    expect(buyForCamp("log-seat", pay)).toBe("plenty");
    expect(asked).toBe(1);
    expect(balance().coins).toBe(coins);
    // Nor is one more won or given.
    expect(sendToCamp("log-seat")).toBe(false);
    expect(owned(camp, "log-seat")).toBe(MOST_OWNED);
    // Every one of them is there after a reload, and other things can still be bought.
    const back = parseCamp(JSON.parse(JSON.stringify(camp)));
    expect(back ? owned(back, "log-seat") : 0).toBe(MOST_OWNED);
    expect(buyForCamp("gnome", pay)).toBe("sent");
  });

  test("a purchase the purse cannot pay for sends nothing", () => {
    expect(buyForCamp("gnome", () => false)).toBe("short");
    expect(camp.parcels).toEqual([]);
  });
});
