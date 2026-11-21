import { beforeEach, describe, expect, test } from "bun:test";

import { balance, earn, reset, spend } from "@sequoia-leaf/kit/purse.ts";

import { MOST_PARCELS, parseCamp } from "./camp.ts";
import { buyForCamp, camp, roomByTrail, sendToCamp } from "./record.ts";

describe("sending things to the camp", () => {
  beforeEach(() => {
    reset();
    camp.parcels = [];
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

  test("a purchase the purse cannot pay for sends nothing", () => {
    expect(buyForCamp("gnome", () => false)).toBe("short");
    expect(camp.parcels).toEqual([]);
  });
});
