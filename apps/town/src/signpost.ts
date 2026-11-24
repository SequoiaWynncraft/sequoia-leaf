/**
 * The ways between camps: the signpost, the same at every camp (home when away, town, then every
 * camp there is but the member's own and the one they stand in, found by name and in the order
 * chosen, each with how many are there now); the strip's like and "Next camp" at somebody else's
 * camp; and the cabin's link to the member's camp. Leaf's list of camps (`camps.ts`) is asked for as
 * the signpost opens and as the member comes into somebody's camp. How many are at each is counted
 * from who is about (`atCamps`), asked for afresh as the signpost opens, and as it changes after.
 */

import { el, icon as glyph, replay, say, shown } from "@sequoia-leaf/kit/dom.ts";
import { member } from "@sequoia-leaf/kit/live.ts";
import { outside } from "@sequoia-leaf/kit/net.ts";
import { askNow } from "@sequoia-leaf/kit/presence.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";
import { faceFor, facesCame } from "@sequoia-leaf/kit/skin.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";

import { campIcon } from "./campart.ts";
import {
  type Camp,
  camps,
  campsVersion,
  choose,
  fetchCamps,
  heldOrder,
  inOrder,
  like,
  named,
  nextAfter,
  type Order,
  order,
  ORDERS,
} from "./camps.ts";
import { hooks } from "./game.ts";
import { guild } from "./guild.ts";
import { button, closePanel, pic, slot, type StripWays, wayButton, when } from "./hud.ts";
import { visiting, whoseCamp } from "./leaf.ts";
import { atCamps } from "./where.ts";

/** The member's own id. */
const myId = (): string => member()?.id ?? "";

/** A row of the signpost: somewhere to go, and the button that goes there. */
function way(name: string, art: HTMLCanvasElement, go: () => void, line: Node | null = null): HTMLElement {
  return el(
    "div",
    "k-card",
    {},
    slot(art, 20),
    el("div", "k-grow", {}, name, line),
    button("sm", ["Go"], () => {
      closePanel();
      go();
    }),
  );
}

/** A camp's likes and the things set out in it, as its row's small line says them. */
const counts = (c: Camp): string => `${c.likes} · ${c.setOut} ${c.setOut === 1 ? "thing" : "things"} set out`;

/** How many are at each camp now, by its owner's id, the member too at the one they stand in. */
const hereNow = (): ReadonlyMap<string, number> => atCamps(guild.whereabouts(), whoseCamp());

/** How many are at a camp, for the end of its row's line: "2 here"; nothing for nobody. */
const hereWords = (n: number): Node[] => (n > 0 ? [el("span", "k-leafy", { text: `${n} here` })] : []);

/** Goes to somebody's camp, from wherever the member is. */
const goTo = (c: Camp): void => hooks.go({ to: "camp", of: c.id, name: c.name });

/**
 * The signpost's panel: home and town, a field to find a camp by name, the orders, and every other
 * camp, in a list that scrolls. A camp's row is made once and brought up to date in place, so a
 * button that has the keyboard keeps it while faces, likes and who is there come. The order is
 * worked out once Leaf has answered with the camps and who is about, and when an order is chosen,
 * and held while the panel stays open, so that rows do not move under the member as people come and go.
 */
export function signpost(body: HTMLElement, life: Scope): () => void {
  const host = visiting();
  const homeLine = el("div", "k-d camp-counts");
  if (host) body.append(way("Home", shown(campIcon("home"), 1), () => hooks.go({ to: "camp" }), homeLine));
  body.append(way("Town", shown(campIcon("town"), 1), () => hooks.go({ to: "town" })));
  const find = el("input", "k-field", { type: "search", placeholder: "Find a camp", "aria-label": "Find a camp" });
  const tabs = el("div", "k-tabs", { role: "tablist", "aria-label": "Order" });
  const list = el("div", "camp-list k-scroll k-wait");
  body.append(find, tabs, list);
  /** Whether Leaf has answered with the camps: not yet, yes, or it could not be read. */
  let read: "asking" | "read" | "failed" = "asking";
  const others = (): Camp[] => camps().filter((c) => c.id !== myId() && c.id !== host?.id);
  /** The camps' order while the panel is open, by id: worked out afresh only by `sort`. */
  let held: readonly string[] = [];
  const sort = (): void => {
    held = inOrder(others(), order(), hereNow()).map((c) => c.id);
  };
  const rows = new Map<string, { readonly row: HTMLElement; readonly line: HTMLElement }>();
  const rowOf = (c: Camp, here: number): HTMLElement => {
    const had = rows.get(c.id);
    const line = had?.line ?? el("div", "k-d camp-counts");
    const face = pic(faceFor(c.id, c.name, true), 2);
    const row = had?.row ?? way(c.name, face, () => goTo(c), line);
    if (had) row.firstElementChild?.replaceChildren(face);
    rows.set(c.id, { row, line });
    line.replaceChildren(glyph("heart"), here > 0 ? `${counts(c)} ·` : counts(c), ...hereWords(here));
    return row;
  };
  /** The list, as one line in place of camps. */
  const only = (text: string): void => {
    if (list.textContent !== text) list.replaceChildren(el("div", "k-d", { text }));
  };
  const draw = when(
    () =>
      `${read}|${facesCame()}|${order()}|${find.value}|${held.join()}|${[...hereNow()].join()}|${camps()
        .map((c) => `${c.id}/${counts(c)}`)
        .join()}`,
    () => {
      for (const tab of tabs.querySelectorAll<HTMLElement>("[data-order]"))
        tab.setAttribute("aria-selected", String(tab.dataset.order === order()));
      const here = hereNow();
      homeLine.replaceChildren(...hereWords(here.get(myId()) ?? 0));
      const listed = others();
      const found = named(heldOrder(held, listed), find.value);
      if (read === "failed") only("The camps could not be read.");
      else if (read === "read" && found.length === 0)
        only(listed.length === 0 ? "No other camps yet." : "No camp by that name.");
      else {
        const want = found.map((c) => rowOf(c, here.get(c.id) ?? 0));
        if (want.length !== list.children.length || want.some((r, i) => list.children[i] !== r))
          list.replaceChildren(...want);
      }
    },
  );
  const orderTab = (o: Order): HTMLButtonElement => {
    const tab = button("sm", [ORDERS[o]], () => {
      choose(o);
      sort();
      sfx.tap();
      draw();
    });
    tab.setAttribute("role", "tab");
    tab.dataset.order = o;
    return tab;
  };
  tabs.append(orderTab("liked"), orderTab("set"), orderTab("here"));
  life.on(find, "input", draw);
  sort();
  void (async () => {
    const [listed] = await Promise.all([fetchCamps(), askNow()]);
    read = listed === null ? "failed" : "read";
    sort();
    list.classList.remove("k-wait");
    draw();
  })();
  return draw;
}

/**
 * "Next camp": the one after `at` in the order last chosen at the signpost, never the member's own,
 * round to the first. In the order of most here, the member is not counted, so that their own going
 * from camp to camp does not turn the order round under them.
 */
async function goNext(at: string): Promise<void> {
  const list = camps().length > 0 ? camps() : ((await fetchCamps()) ?? []);
  const next = nextAfter(list, order(), at, myId(), atCamps(guild.whereabouts(), null));
  if (next) goTo(next);
  else hooks.feed("There is no other camp yet.", "coral");
}

/** The strip's buttons at somebody else's camp: its likes, which the member gives or takes back, and the next camp along; drawn as the camps held change. */
export function stripWays(host: { readonly id: string }): StripWays {
  const heart = glyph("heart");
  const count = el("span");
  let busy = false;
  const likes = button("wood sm camp-like", [heart, count], () => void toggle());
  const draw = (): void => {
    const c = camps().find((x) => x.id === host.id);
    const on = c?.liked ?? false;
    count.textContent = c ? String(c.likes) : "";
    likes.classList.toggle("wood", !on);
    likes.setAttribute("aria-pressed", String(on));
    likes.setAttribute("aria-label", on ? "Liked" : "Like");
  };
  async function toggle(): Promise<void> {
    if (busy) return;
    busy = true;
    const did = await like(host.id, !(camps().find((x) => x.id === host.id)?.liked ?? false));
    busy = false;
    if (did === null || typeof did === "string") {
      hooks.feed(did ?? "The like could not be sent. Try again in a moment.", "coral");
      return;
    }
    if (did.liked) {
      sfx.twinkle();
      replay(heart, "k-bump");
    } else sfx.tap();
    follow();
  }
  const follow = when(() => String(campsVersion()), draw);
  follow();
  void fetchCamps().then(follow);
  return { els: [likes, wayButton("back", "Next camp", () => void goNext(host.id))], follow };
}

/** "Copy link to my camp": the page's address that opens on the member's camp, for pasting in chat; "Link copied" for a moment after. */
export function copyLink(life: Scope): HTMLElement {
  const label = el("span", "", { text: "Copy link to my camp" });
  const done = el("span", "hid", { text: "Link copied" });
  const copied = (on: boolean): void => {
    label.classList.toggle("hid", on);
    done.classList.toggle("hid", !on);
  };
  async function copy(): Promise<void> {
    const url = new URL(outside.href());
    url.search = `?camp=${encodeURIComponent(myId())}`;
    url.hash = "";
    try {
      await navigator.clipboard.writeText(url.href);
    } catch {
      hooks.feed(`The link could not be copied here. It is ${url.href}`, "coral");
      return;
    }
    sfx.tap();
    copied(true);
    say("Link copied");
    life.after(2000, () => copied(false));
  }
  return el(
    "div",
    "k-row",
    {},
    button("wood sm", [el("span", "k-asks", {}, label, done)], () => void copy()),
  );
}
