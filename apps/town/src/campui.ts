/**
 * The camp's own part of the interface: the cabin (the member's own things), the mailbox
 * (`mailbox.ts`), the signpost (`signpost.ts`: home, town and every camp), and the tray (a player
 * reads "Storage"): everything the member has that is not set out, by kind, which the hammer opens.
 * At somebody else's camp there is only the signpost, and the strip that says whose camp it is,
 * with its likes and the way on to the next camp. The purse, the feed and the panel's frame are
 * shared with the town (`hud.ts`).
 */

import { link } from "@sequoia-leaf/kit/card.ts";
import { el, icon as glyph, shown } from "@sequoia-leaf/kit/dom.ts";
import { fly } from "@sequoia-leaf/kit/pursebar.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { tip } from "@sequoia-leaf/kit/tip.ts";
import { makeCanvas, type Pt } from "@sequoia-leaf/kit/util.ts";
import { COSY, KIND, type PetId, PETS, petsOf, trayList } from "@sequoia-leaf/town/camp.ts";
import { KIND_NAMES, KINDS, thingOf, THINGS } from "@sequoia-leaf/town/things.ts";

import { type CampArt, type CampIcon, campIcon, pictureOf } from "./campart.ts";
import type { CampScene } from "./campscene.ts";
import { thingRef } from "./cards.ts";
import { G, hooks, toPage } from "./game.ts";
import { guild } from "./guild.ts";
import {
  $,
  button,
  centre,
  closePanel,
  levelBar,
  openPanel,
  pic,
  setDock,
  setFace,
  setHammer,
  setHammerNew,
  setStrip,
  sheet,
  slot,
  when,
} from "./hud.ts";
import { doNow, mine, town, visiting } from "./leaf.ts";
import { mailbox } from "./mailbox.ts";
import { MY_PETS, PET_ABOUT, PET_CHOICE } from "./pets.ts";
import { copyLink, signpost, stripWays } from "./signpost.ts";
import { openPanel as openTownPanel } from "./ui.ts";

export type CampPanel = "cabin" | "mailbox" | "signpost" | "choose";

export interface CampUi {
  /** Opens one of the camp's panels. */
  open(what: CampPanel): void;
  /** The member has just come into a camp: the dock and the corner are set for it. */
  arrived(): void;
  /** Decorating has been turned on or off. */
  decorating(on: boolean): void;
  /** The tray, what is new in it, or the thing in hand, has changed. */
  tray(): void;
  /** A thing's picture flies from a point in the camp to the tray. */
  toTray(pic: HTMLCanvasElement, from: Pt, id: string): void;
}

const TITLES: Readonly<Record<CampPanel, string>> = {
  cabin: "Your cabin",
  mailbox: "Mailbox",
  signpost: "Signpost",
  choose: "Somebody is waiting",
};
const ICONS: Readonly<Record<CampPanel, CampIcon>> = {
  cabin: "cabin",
  mailbox: "mailbox",
  signpost: "signpost",
  choose: "home",
};

/** How far along one of the counters a pet moves in for is. */
const upTo = (have: number, need: number): string => (have >= need ? "Done" : `${have} / ${need}`);

/** A button for the thing in hand: on a phone its picture alone, so its name and key are said by its tip too. */
function handButton(picture: "turn" | "tray", name: string, key: string, does: () => void): HTMLButtonElement {
  const b = button("wood sm", [glyph(picture), el("span", "t", { text: name })], does);
  b.setAttribute("aria-label", name);
  tip(b, name, `Key: ${key}`);
  return b;
}

export function makeCampUi(art: CampArt): CampUi & { bind(scene: CampScene): void } {
  let scene: CampScene | null = null;
  const at = (): CampScene => {
    if (!scene) throw new Error("no camp yet");
    return scene;
  };

  // ---------- the cabin: the member's own things ----------

  function cabin(body: HTMLElement, life: Scope): () => void {
    const me = guild.me();
    const p = G.player;
    const portrait = makeCanvas(12, 24);
    const frame = p?.body?.frames[0]?.[0];
    if (frame) portrait.g.drawImage(frame, 0, 0);
    const living = el("div", "k-col");
    const shelf = el("div", "k-wrap");
    // Whether the member's character stays in town, dozing, for a day after they go.
    const stayBtn = button("sm", [], () => {
      const on = !town().stay;
      if (doNow({ do: "stay", on }) === null) return;
      guild.stay(on);
      sfx.tap();
    });
    stayBtn.setAttribute("role", "switch");
    const stayRow = el(
      "div",
      "k-card",
      {},
      el(
        "div",
        "k-grow",
        {},
        "Leave my character in town when I go",
        el("div", "k-d", { text: "For 24 hours after you leave, it sleeps where you stood, and others can see it." }),
      ),
      stayBtn,
    );
    body.append(
      el(
        "div",
        "k-row",
        {},
        slot(shown(portrait.c, 2), 52),
        el(
          "div",
          "k-grow k-col",
          {},
          el("div", "k-title big", { text: me.name }),
          el("div", "k-dim", { text: `${me.rank} of the guild` }),
          ...levelBar(me),
        ),
      ),
      me.week.length === 0 ? "" : sheet("This week", me.week),
      stayRow,
      copyLink(life),
      el("div", "k-label", { text: "Trophy shelf" }),
      shelf,
      el("div", "k-label", { text: "Who lives here" }),
      living,
    );
    const drawShelf = when(
      () => mine().earned.join(),
      () => {
        shelf.replaceChildren(
          ...THINGS.filter((t) => t.kind === "trophies").map((t) => {
            const won = mine().earned.includes(t.id);
            const small = art.small[t.id];
            const s = slot(won && small ? pic(small, 2) : el("span", "k-dim", { text: "?" }), 24);
            if (won) s.classList.add("lit");
            link(s, thingRef(t.id));
            return s;
          }),
        );
      },
    );
    const drawLiving = when(
      () => `${petsOf(mine()).join()}|${mine().placed.length}|${mine().greeted}`,
      () => {
        const camp = mine();
        const here = petsOf(camp);
        const rows: Node[] = here.map((kind) => {
          const sit = art.pets(kind, 0).sit[0];
          return el(
            "div",
            "k-card",
            {},
            slot(sit ? pic(sit.c, 2) : null, 24),
            el("div", "k-grow", {}, MY_PETS[kind], el("div", "k-d", { text: PET_ABOUT[kind] })),
          );
        });
        if (here.length === 0) rows.push(el("div", "k-dim", { text: "Nobody yet." }));
        else if (here.length < PETS.length) {
          rows.push(
            sheet("One more moves in for each", [
              ["Things set out", upTo(camp.placed.length, COSY)],
              ["Callers greeted", upTo(camp.greeted, KIND)],
            ]),
          );
          if (camp.greeted < KIND)
            rows.push(
              el("div", "k-d", { text: "When somebody from town drops by your camp, tap them to greet them." }),
            );
        }
        living.replaceChildren(...rows);
      },
    );
    const drawStay = when(
      () => String(town().stay),
      () => {
        const on = town().stay;
        stayBtn.replaceChildren(on ? "On" : "Off");
        stayBtn.classList.toggle("wood", !on);
        stayBtn.setAttribute("aria-checked", on ? "true" : "false");
      },
    );
    return () => {
      drawStay();
      drawShelf();
      drawLiving();
    };
  }

  function choose(body: HTMLElement): null {
    body.append(
      el("div", "k-read", { text: "Three small faces look round the cabin door. One of them would like to stay." }),
    );
    for (const kind of PETS) {
      const sit = art.pets(kind, 0).sit[0];
      body.append(
        el(
          "div",
          "k-card",
          {},
          slot(sit ? pic(sit.c, 2) : null, 28),
          el("div", "k-grow", {}, MY_PETS[kind], el("div", "k-d", { text: PET_CHOICE[kind] })),
          button("sm", ["Stay"], () => {
            pickPet(kind);
          }),
        ),
      );
    }
    body.append(
      el("div", "k-d", {
        text: `The other two move in later: one when ${COSY} things are placed in your camp, one when you have greeted ${KIND} townsfolk.`,
      }),
    );
    return null;
  }
  function pickPet(kind: PetId): void {
    closePanel();
    at().choose(kind);
  }

  const BUILD: Readonly<Record<CampPanel, (body: HTMLElement, life: Scope) => (() => void) | null>> = {
    cabin,
    mailbox: (body) => mailbox(art, body),
    signpost,
    choose,
  };

  // ---------- the tray, while decorating ----------

  const tray = $("tray");
  const hand = el("div", "k-grow k-row");
  const list = el("div", "list k-scroll");
  tray.replaceChildren(
    el(
      "div",
      "bar",
      {},
      hand,
      button("sm", ["Done"], () => {
        at().decorate(false);
      }),
    ),
    list,
  );
  const traySlots = new Map<string, HTMLElement>();
  /** What was new when the tray was opened, or came while it was open: marked until it is shut. */
  const marked = new Set<string>();

  function trayPic(id: string): HTMLCanvasElement | null {
    const sprite = pictureOf(art, id, 0, 0);
    if (!sprite) return null;
    const big = Math.max(sprite.c.width, sprite.c.height);
    return pic(sprite.c, big <= 14 ? 2 : big <= 28 ? 1 : 0.5);
  }

  /** One thing in the tray: its picture, its name, and how many when there is more than one. A tap takes one in hand. */
  function traySlot(id: string, n: number): HTMLElement {
    const thing = thingOf(id);
    const fresh = marked.has(id);
    const b = el(
      "button",
      fresh ? "k-slot lit" : "k-slot",
      { type: "button" },
      el("span", "pic", {}, trayPic(id)),
      el("span", "k-s", { text: thing?.name ?? id }),
      n > 1 ? el("span", "n", { text: n }) : null,
      fresh ? el("span", "new k-s k-gold", { text: "New" }) : null,
    );
    b.addEventListener("click", () => {
      at().takeOut(id);
    });
    // A tap sets it out; pointing (or a finger kept on it) shows its card.
    if (thing) link(b, thingRef(id), { acts: true });
    traySlots.set(id, b);
    return b;
  }

  function drawTray(): void {
    const s = at();
    setHammerNew(mine().fresh.length);
    if (!s.decorating()) return;
    // The tray is open, so what is new in it has been looked at: Leaf is told, and it stays marked here.
    const { fresh, looked } = mine();
    for (const id of fresh) marked.add(id);
    if (fresh.length > 0) doNow({ do: "looked", through: looked + fresh.length });
    const held = s.held();
    hand.replaceChildren(
      ...(held
        ? [
            el("span", "k-gold name", { text: held.name }),
            ...(held.turns ? [handButton("turn", "Rotate", "R", () => s.turn())] : []),
            ...(held.stays ? [] : [handButton("tray", "Put away", "Delete", () => s.stow())]),
          ]
        : [el("span", "k-title", { text: "Storage" })]),
    );
    traySlots.clear();
    const stored = trayList(mine());
    list.replaceChildren(
      ...(stored.length > 0
        ? KINDS.flatMap((kind) => {
            const of = stored.filter(({ id }) => thingOf(id)?.kind === kind);
            return of.length > 0
              ? [
                  el(
                    "div",
                    "kind",
                    {},
                    el("div", "k-label", { text: KIND_NAMES[kind] }),
                    el("div", "grid", {}, ...of.map(({ id, n }) => traySlot(id, n))),
                  ),
                ]
              : [];
          })
        : [el("span", "k-d", { text: "Storage is empty. The market in town sells things for a camp." })]),
    );
  }

  return {
    bind(s) {
      scene = s;
    },

    open(what) {
      openPanel({ id: what, title: TITLES[what], art: shown(campIcon(ICONS[what]), 1), build: BUILD[what] });
    },

    arrived() {
      const s = at();
      const host = visiting();
      const home = host === null;
      const place = (id: "cabin" | "mailbox" | "signpost", name: string, about: string, icon: CampIcon) => ({
        id,
        name,
        about,
        art: campIcon(icon),
        press: (): void => {
          if (G.panel === id) closePanel();
          else s.go(id);
        },
      });
      const trail = (name: string, icon: CampIcon) => ({
        id: "trail",
        name,
        art: campIcon(icon),
        press: (): void => {
          closePanel();
          s.go("trail");
        },
      });
      setDock(
        home
          ? [
              place("cabin", "Cabin", "What you have won, and who lives here.", "cabin"),
              place("mailbox", "Mailbox", "Letters and presents from townsfolk.", "mailbox"),
              place("signpost", "Signpost", "The way to town, and to every camp.", "signpost"),
              trail("Town", "town"),
            ]
          : [place("signpost", "Signpost", "Home, town, and every camp.", "signpost"), trail("Home", "home")],
      );
      setFace(() => {
        if (!home) {
          if (G.panel === "profile") closePanel();
          else openTownPanel("profile");
        } else if (G.panel === "cabin") closePanel();
        else s.go("cabin");
      });
      setHammer(
        home
          ? (): void => {
              s.decorate(!s.decorating());
            }
          : null,
      );
      setStrip(
        host,
        () => {
          hooks.go({ to: "camp" });
        },
        host ? stripWays(host) : [],
      );
      tray.hidden = true;
      document.body.classList.remove("decorating");
      setHammerNew(home ? mine().fresh.length : 0);
    },

    decorating(on) {
      tray.hidden = !on;
      document.body.classList.toggle("decorating", on);
      setHammer((): void => {
        at().decorate(!at().decorating());
      }, on);
      marked.clear();
      if (!on) return;
      drawTray();
      // What is new is brought into sight.
      list.querySelector(".lit")?.scrollIntoView({ block: "nearest" });
    },

    tray: drawTray,

    toTray(picture, from, id) {
      const to = traySlots.get(id) ?? list;
      to.scrollIntoView({ block: "nearest" });
      fly(() => pic(picture, 2), toPage(from.x, from.y), centre(to), 1, drawTray);
    },
  };
}
