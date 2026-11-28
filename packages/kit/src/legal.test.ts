import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { LEGAL_LINKS, legalLinks } from "./legal.ts";

/** An element as `el` makes one: its tag, attributes, words, children and listeners. */
class Part extends EventTarget {
  readonly attrs = new Map<string, string>();
  readonly kids: Part[] = [];
  readonly tag: string;
  className = "";
  textContent = "";
  constructor(tag: string) {
    super();
    this.tag = tag;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  appendChild<T>(kid: T): T {
    if (kid instanceof Part) this.kids.push(kid);
    return kid;
  }
}

const real = globalThis.document;
beforeEach(() => {
  Object.assign(globalThis, { document: { createElement: (tag: string) => new Part(tag) } });
});
afterEach(() => {
  Object.assign(globalThis, { document: real });
});

/** The links in what `legalLinks` made: the parts it holds. */
const linksOf = (nav: unknown): Part[] => (nav instanceof Part ? nav.kids : []);

describe("the Privacy and Terms links", () => {
  test("go to the two pages on notes.supply", () => {
    expect(LEGAL_LINKS).toEqual([
      { word: "Privacy", url: "https://legal.notes.supply/games/leaf/privacy" },
      { word: "Terms", url: "https://legal.notes.supply/games/leaf/terms" },
    ]);
  });

  test("are two plain links, each to a new tab", () => {
    const nav = legalLinks();

    expect(nav instanceof Part ? nav.tag : null).toBe("nav");
    expect(
      linksOf(nav).map((a) => [a.tag, a.textContent, a.attrs.get("href"), a.attrs.get("target"), a.attrs.get("rel")]),
    ).toEqual([
      ["a", "Privacy", "https://legal.notes.supply/games/leaf/privacy", "_blank", "noopener"],
      ["a", "Terms", "https://legal.notes.supply/games/leaf/terms", "_blank", "noopener"],
    ]);
  });

  test("where the page opens addresses itself (a Discord call), a press goes there and the link does nothing", () => {
    const opened: string[] = [];
    const [privacy, terms] = linksOf(legalLinks((url) => opened.push(url)));
    const presses = [privacy, terms].map((a) => {
      const press = new Event("click", { cancelable: true });
      a?.dispatchEvent(press);
      return press.defaultPrevented;
    });

    expect(opened).toEqual(LEGAL_LINKS.map((l) => l.url));
    expect(presses).toEqual([true, true]);
  });

  test("without a way to open addresses, a press is left to the link", () => {
    const [privacy] = linksOf(legalLinks());
    const press = new Event("click", { cancelable: true });
    privacy?.dispatchEvent(press);

    expect(press.defaultPrevented).toBe(false);
  });
});
