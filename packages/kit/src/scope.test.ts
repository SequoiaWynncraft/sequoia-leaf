import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";

import { scope } from "./scope.ts";
import { Listened } from "./standin.ts";

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("a scope", () => {
  test("hears an event until it closes, and its listener is taken off then", () => {
    const target = new Listened();
    const s = scope();
    const heard: string[] = [];
    s.on(target, "ping", (e) => heard.push(e.type));
    target.dispatchEvent(new Event("ping"));
    expect(target.listening).toBe(1);
    s.close();
    target.dispatchEvent(new Event("ping"));
    expect(heard).toEqual(["ping"]);
    expect(target.listening).toBe(0);
  });

  test("each listener is its own: one function on one target in two scopes is heard by each until its own closes", () => {
    const target = new EventTarget();
    const [a, b] = [scope(), scope()];
    let heard = 0;
    const hear = (): void => void heard++;
    a.on(target, "ping", hear);
    b.on(target, "ping", hear);
    target.dispatchEvent(new Event("ping"));
    expect(heard).toBe(2);
    a.close();
    target.dispatchEvent(new Event("ping"));
    expect(heard).toBe(3);
    b.close();
    target.dispatchEvent(new Event("ping"));
    expect(heard).toBe(3);
  });

  test("lets go of one thing at once with what registering it gave back, and of nothing else", () => {
    const target = new Listened();
    const s = scope();
    const heard: string[] = [];
    const off = s.on(target, "a", () => heard.push("a"));
    s.on(target, "b", () => heard.push("b"));
    off();
    off();
    target.dispatchEvent(new Event("a"));
    target.dispatchEvent(new Event("b"));
    expect(heard).toEqual(["b"]);
    expect(target.listening).toBe(1);
    s.close();
    expect(target.listening).toBe(0);
  });

  test("closes its children as it closes, and a child that closes first is gone from it", () => {
    const target = new Listened();
    const parent = scope();
    const child = parent.child();
    const grandchild = child.child();
    child.on(target, "ping", () => undefined);
    grandchild.on(target, "ping", () => undefined);
    const early = parent.child();
    early.on(target, "ping", () => undefined);
    early.close();
    expect(target.listening).toBe(2);
    parent.close();
    expect(target.listening).toBe(0);
    expect(child.closed && grandchild.closed && early.closed).toBe(true);
  });

  test("closed twice is closed once", () => {
    const target = new Listened();
    const s = scope();
    const child = s.child();
    child.on(target, "ping", () => undefined);
    s.close();
    s.close();
    child.close();
    expect(target.listening).toBe(0);
  });

  test("a timer it holds never runs once it has closed, and one that ran is let go of", () => {
    const s = scope();
    const ran: string[] = [];
    s.after(100, () => ran.push("soon"));
    s.after(500, () => ran.push("late"));
    const tick = s.every(200, () => ran.push("tick"));
    jest.advanceTimersByTime(450);
    expect(ran).toEqual(["soon", "tick", "tick"]);
    tick();
    jest.advanceTimersByTime(200);
    s.close();
    jest.advanceTimersByTime(1000);
    expect(ran).toEqual(["soon", "tick", "tick", "late"]);
  });

  test("a frame it asks for is not drawn once it has closed", () => {
    const frames = new Map<number, (t: number) => void>();
    let next = 0;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (fn: (t: number) => void) => {
        frames.set(++next, fn);
        return next;
      },
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      value: (id: number) => frames.delete(id),
    });
    try {
      const s = scope();
      const drawn: number[] = [];
      s.frame((t) => drawn.push(t));
      s.frame((t) => drawn.push(t * 10));
      const first = frames.get(1);
      first?.(16);
      s.close();
      expect(drawn).toEqual([16]);
      expect(frames.size).toBe(0);
    } finally {
      Reflect.deleteProperty(globalThis, "requestAnimationFrame");
      Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
    }
  });

  test("starts nothing once it has closed: no listener, no timer, a closed child", () => {
    const target = new Listened();
    const s = scope();
    s.close();
    const ran: string[] = [];
    const off = s.on(target, "ping", () => ran.push("heard"));
    s.after(10, () => ran.push("after"));
    s.every(10, () => ran.push("every"));
    target.dispatchEvent(new Event("ping"));
    jest.advanceTimersByTime(100);
    off();
    expect(ran).toEqual([]);
    expect(target.listening).toBe(0);
    expect(s.child().closed).toBe(true);
    expect(s.socket("ws://127.0.0.1:9/")).toBeNull();
  });

  test("in turns, keeps one child while the same thing is on show, and a new one for each thing after another", () => {
    const panel = scope();
    const tab = panel.turns();
    const quests = tab("quests");
    expect(tab("quests")).toBe(quests);
    const news = tab("news");
    expect([quests.closed, news.closed]).toEqual([true, false]);
    // Back to the first: not the scope it had, which closed as it left.
    const again = tab("quests");
    expect(again).not.toBe(quests);
    expect([news.closed, again.closed]).toEqual([true, false]);
    // A thing is itself, not whatever looks like it.
    const card = { stack: ["plot:meadow"] };
    const entry = tab(card);
    expect(tab(card)).toBe(entry);
    expect(tab({ stack: ["plot:meadow"] })).not.toBe(entry);
    panel.close();
    expect(tab("quests").closed).toBe(true);
  });
});
