/**
 * A press on the sheet's map belongs to the pointer that began it. Lifted where it went down, it is
 * a tap; moved, it drags, and is no tap. Another finger put down meanwhile is not the press's, and a
 * press that loses its hold, or is cancelled, is over without a tap.
 */
import { describe, expect, test } from "bun:test";

import { scope } from "@sequoia-leaf/kit/scope.ts";

import { mapPress } from "./mappress.ts";

/** The map's canvas: it hears presses, and holds on to a pointer when asked. */
class Canvas extends EventTarget {
  captured: number[] = [];
  setPointerCapture(id: number): void {
    this.captured.push(id);
  }
}

/** A map that writes down each tap and drag it is told of, by where it was. */
function map() {
  const told: string[] = [];
  const canvas = new Canvas();
  const life = scope();
  mapPress(life, canvas, {
    tap: (e) => told.push(`tap ${e.clientX},${e.clientY}`),
    drag: (e) => told.push(`drag ${e.clientX},${e.clientY}`),
  });
  const send = (type: string, pointerId: number, x: number, y = 0): void => {
    canvas.dispatchEvent(Object.assign(new Event(type), { pointerId, pointerType: "touch", clientX: x, clientY: y }));
  };
  return { told, canvas, send, life };
}

describe("a press on the map", () => {
  test("lifted where it went down is a tap; moved, it drags, and lifting it is no tap", () => {
    const { told, canvas, send } = map();
    send("pointerdown", 1, 10);
    send("pointerup", 1, 11);
    send("pointerdown", 1, 10);
    send("pointermove", 1, 30);
    send("pointermove", 1, 40);
    send("pointerup", 1, 40);
    expect(told).toEqual(["tap 11,0", "drag 30,0", "drag 40,0"]);
    expect(canvas.captured).toEqual([1, 1]);
  });

  test("dragged, with a second finger put down and the first lifted unmoved since, is no tap", () => {
    const { told, send } = map();
    send("pointerdown", 1, 10);
    send("pointermove", 1, 30);
    send("pointerdown", 2, 60);
    send("pointerup", 1, 30);
    send("pointerup", 2, 60);
    expect(told).toEqual(["drag 30,0"]);
  });

  test("is over when it loses its hold or is cancelled: lifted after, it is no tap", () => {
    for (const end of ["lostpointercapture", "pointercancel"]) {
      const { told, send } = map();
      send("pointerdown", 1, 10);
      send(end, 1, 10);
      send("pointerup", 1, 10);
      // The next press is a press of its own.
      send("pointerdown", 2, 20);
      send("pointerup", 2, 20);
      expect(told).toEqual(["tap 20,0"]);
    }
  });

  test("hears nothing once its scope has closed", () => {
    const { told, send, life } = map();
    life.close();
    send("pointerdown", 1, 10);
    send("pointerup", 1, 10);
    expect(told).toEqual([]);
  });
});
