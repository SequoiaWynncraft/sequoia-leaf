/**
 * A kind's picture for a card, as `art.icon` gives it from the art the page makes for the land. There
 * is no canvas here, so a stand-in keeps each canvas's size and draws nothing: enough to tell the
 * depot's picture for a slot (20 pixels square and its edge) from the yard's (54 by 66), which a card
 * would cut down to its roof.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { DEPOT, LAND } from "@sequoia-leaf/factory";

import { makeArt } from "./index.ts";

/** Pixels the size a drawing asks for, all clear. */
const clear = (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });

/** A canvas that is only its size; whatever is drawn on it is let go. */
class Canvas {
  width = 300;
  height = 150;
  getContext(): unknown {
    const answers: Record<string, unknown> = {
      canvas: this,
      getImageData: (_x: number, _y: number, w: number, h: number) => clear(w, h),
      createImageData: clear,
      measureText: () => ({ width: 0 }),
      createLinearGradient: () => ({ addColorStop: () => undefined }),
    };
    return new Proxy(answers, {
      get: (known, name) => (typeof name === "string" && name in known ? known[name] : () => undefined),
      set: () => true,
    });
  }
}

beforeAll(() => {
  Object.defineProperty(globalThis, "document", { value: { createElement: () => new Canvas() }, configurable: true });
});
afterAll(() => {
  Reflect.deleteProperty(globalThis, "document");
});

describe("a kind's picture for a card", () => {
  test("the depot's is the one drawn for a slot, whole in it with its edge, not the yard's", () => {
    const art = makeArt(LAND);
    const pic = art.icon(DEPOT);
    expect([pic.width, pic.height]).toEqual([22, 22]);
    expect([art.m.depot.c.width, art.m.depot.c.height]).toEqual([54, 66]);
  });
});
