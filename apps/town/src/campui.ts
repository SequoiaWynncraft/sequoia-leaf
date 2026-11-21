/**
 * The camp's own part of the interface: the cabin (the member's own things), the mailbox, the
 * signpost, the tray that things are put away into, and the few panels somebody else's camp would
 * have (`note`, `present`; nothing opens them until members' camps can be visited). The purse, the
 * feed and the panel's frame are shared with the town (`hud.ts`).
 */

import { link } from "@sequoia-leaf/kit/card.ts";
import { el, icon as glyph, shown } from "@sequoia-leaf/kit/dom.ts";
import { folkName } from "@sequoia-leaf/kit/mark.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { tip } from "@sequoia-leaf/kit/tip.ts";
import { makeCanvas, type Pt } from "@sequoia-leaf/kit/util.ts";

import { hop } from "./actors.ts";
import { COSY, KIND, type PetId, PETS, petsOf, trayList, welcoming } from "./camp.ts";
import { type CampArt, type CampIcon, campIcon, pictureOf } from "./campart.ts";
import type { CampScene } from "./campscene.ts";
import { named, thingRef } from "./cards.ts";
import { folkNamed } from "./folk.ts";
import { folkArt } from "./folkart.ts";
import { changed, G, hooks, toPage } from "./game.ts";
import { guild } from "./guild.ts";
import {
  $,
  button,
  centre,
  closePanel,
  fly,
  openPanel,
  pic,
  refreshPanel,
  setDock,
  setFace,
  setHammer,
  slot,
  when,
} from "./hud.ts";
import { tidied } from "./mail.ts";
import { MY_PETS, PET_ABOUT, PET_CHOICE } from "./pets.ts";
import { camp, kept } from "./record.ts";
import type { Sprites } from "./sprites.ts";
import { thingOf, THINGS } from "./things.ts";
import { openPanel as openTownPanel, thingSlot } from "./ui.ts";

/** An element that stands for a thing: pointing at it shows the thing's card. */
function linked(target: HTMLElement, ref: string): HTMLElement {
  link(target, ref);
  return target;
}

export type CampPanel = "cabin" | "mailbox" | "signpost" | "note" | "present" | "choose";

export interface CampUi {
  /** Opens one of the camp's panels. */
  open(what: CampPanel): void;
  /** The member has just come into a camp: the dock and the corner are set for it. */
  arrived(): void;
  /** Decorating has been turned on or off. */
  decorating(on: boolean): void;
  /** The tray, or the thing in hand, has changed. */
  tray(): void;
  /** A thing's picture flies from a point in the camp to the tray. */
  toTray(pic: HTMLCanvasElement, from: Pt, id: string): void;
}

const TITLES: Readonly<Record<CampPanel, string>> = {
  cabin: "Your cabin",
  mailbox: "Mailbox",
  signpost: "Signpost",
  note: "A note",
  present: "A present",
  choose: "Somebody is waiting",
};
const ICONS: Readonly<Record<CampPanel, CampIcon>> = {
  cabin: "cabin",
  mailbox: "mailbox",
  signpost: "signpost",
  note: "cabin",
  present: "mailbox",
  choose: "home",
};

/** Whoever wrote a letter or keeps a camp: one of the town's own as its own picture, a member by their face. */
function face(name: string): HTMLCanvasElement | null {
  const t = folkNamed(name);
  if (t) return pic(folkArt(t).face, 1);
  const a = G.visitors.find((m) => m.who.name === name);
  return a?.body ? pic(a.body.face, 2) : null;
}

/** A name on a letter or a note: one of the town's own with its mark. */
const signed = (name: string): HTMLElement =>
  folkNamed(name) ? folkName(name, "k-pix k-grow") : el("b", "k-grow", { text: name });

/** A row of the signpost: somewhere to go, and the button that goes there. */
function way(name: string, about: string, art: HTMLCanvasElement, go: () => void): HTMLElement {
  return el(
    "div",
    "k-card",
    {},
    slot(shown(art, 1), 20),
    el("div", "k-grow", {}, name, el("div", "k-d", { text: about })),
    button("sm", ["Go"], () => {
      closePanel();
      go();
    }),
  );
}

export function makeCampUi(art: CampArt, sprites: Sprites): CampUi & { bind(scene: CampScene): void } {
  let scene: CampScene | null = null;
  const at = (): CampScene => {
    if (!scene) throw new Error("no camp yet");
    return scene;
  };

  // ---------- the cabin: the member's own things ----------

  function cabin(body: HTMLElement): () => void {
    const me = guild.me();
    const p = G.player;
    const portrait = makeCanvas(12, 24);
    const frame = p?.body?.frames[0]?.[0];
    if (frame) portrait.g.drawImage(frame, 0, 0);
    if (G.wearing.has("crown")) portrait.g.drawImage(sprites.crown, 2, 0);
    const xp = el("i");
    xp.style.setProperty("--v", `${Math.min(100, (me.xp / me.next) * 100)}%`);
    const worn = el("div", "k-col");
    const living = el("div", "k-col");
    const shelf = el("div", "k-wrap");
    // Whether the member's character stays in town, dozing, for a day after they go.
    const stayBtn = button("sm", [], () => {
      kept.stay = !kept.stay;
      guild.stay(kept.stay);
      sfx.tap();
      changed();
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
        el("div", "k-d", { text: "For a day it dozes where you were, so others see you were about." }),
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
          el("div", "k-d", { text: `${me.rank} of the guild, level ${me.level}` }),
          el("div", "k-bar", {}, xp),
          me.week.length === 0 ? null : el("div", "k-d", { text: `This week: ${me.week.join(", ")}` }),
        ),
      ),
      stayRow,
      el("div", "k-label", { text: "Wearing" }),
      worn,
      el("div", "k-label", { text: "Trophy shelf" }),
      shelf,
      el("div", "k-label", { text: "Who lives here" }),
      living,
    );
    const drawWorn = when(
      () => `${[...G.owned].join()}|${[...G.wearing].join()}`,
      () => {
        const mine = guild.wares().filter((w) => w.worn && G.owned.has(w.id));
        if (mine.length === 0) {
          worn.replaceChildren(el("div", "k-d", { text: "Nothing yet. Cinfy sells things to wear, in town." }));
          return;
        }
        worn.replaceChildren(
          ...mine.map((w) => {
            const on = G.wearing.has(w.id);
            const side = button(on ? "sm" : "wood sm", [on ? "On" : "Off"], () => {
              if (on) G.wearing.delete(w.id);
              else G.wearing.add(w.id);
              sfx.tap();
              if (G.player) hop(G.player);
              changed();
            });
            tip(side, w.name, on ? "Showing. Tap to put it away." : "Put away. Tap to show it.");
            return el("div", "k-card", {}, el("div", "k-grow", {}, w.name, el("div", "k-d", { text: w.about })), side);
          }),
        );
      },
    );
    const drawShelf = when(
      () => camp.earned.join(),
      () => {
        shelf.replaceChildren(
          ...THINGS.filter((t) => t.kind === "trophies").map((t) => {
            const won = camp.earned.includes(t.id);
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
      () => `${petsOf(camp).join()}|${camp.placed.length}|${camp.greeted}|${camp.gave.length}`,
      () => {
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
        if (here.length === 0) rows.push(el("div", "k-d", { text: "Nobody yet." }));
        else if (here.length < PETS.length) {
          const cosy = camp.placed.length >= COSY;
          const kind = welcoming(camp);
          rows.push(
            el("div", "k-d", {
              text: "Somebody else moves in when the camp is cosier, and when you have made the town's callers welcome.",
            }),
          );
          if (!cosy) rows.push(el("div", "k-d", { text: `Things set out: ${camp.placed.length} of ${COSY}.` }));
          if (!kind)
            rows.push(
              el("div", "k-d", {
                text: `Callers greeted (touch one while it is here): ${Math.min(camp.greeted, KIND)} of ${KIND}.`,
              }),
            );
        }
        living.replaceChildren(...rows);
      },
    );
    const drawStay = when(
      () => String(kept.stay),
      () => {
        stayBtn.replaceChildren(kept.stay ? "On" : "Off");
        stayBtn.classList.toggle("wood", !kept.stay);
        stayBtn.setAttribute("aria-checked", kept.stay ? "true" : "false");
      },
    );
    return () => {
      drawStay();
      drawWorn();
      drawShelf();
      drawLiving();
    };
  }

  // ---------- the mailbox ----------

  function mailbox(body: HTMLElement): () => void {
    // What had not been read when the box was opened is marked new this once; opening it is reading it.
    const fresh = new Set(camp.letters.filter((l) => !l.read).map((l) => l.id));
    for (const l of camp.letters) l.read = true;
    changed();
    const list = el("div", "k-col");
    body.append(list);
    return when(
      () => camp.letters.map((l) => `${l.id}${l.taken ? "t" : ""}`).join(),
      () => {
        if (camp.letters.length === 0) {
          list.replaceChildren(el("div", "k-d", { text: "Nothing today. The flag goes up when there is." }));
          return;
        }
        const rows: Node[] = camp.letters.toReversed().map((l) => {
          const gift = thingOf(l.gift);
          const paper = el(
            "div",
            "k-paper note",
            {},
            el(
              "div",
              "k-row",
              {},
              face(l.from),
              signed(l.from),
              fresh.has(l.id) ? el("span", "k-chip lit", { text: "New" }) : null,
            ),
            el("div", "", { text: l.text }),
          );
          if (gift && !l.taken) {
            const take = button("sm", [glyph("gift"), "Take it"], () => {
              l.taken = true;
              changed();
              at().unwrap(gift.id);
              refreshPanel();
            });
            paper.append(
              el("hr"),
              el("div", "k-row", {}, thingSlot(art, gift.id, 26), el("span", "k-grow", { text: gift.name }), take),
            );
          } else if (gift) paper.append(el("div", "k-dim", { text: `With it: ${gift.name.toLowerCase()}. Taken.` }));
          return paper;
        });
        if (tidied(camp.letters).length < camp.letters.length)
          rows.push(
            button("wood sm", ["Clear old letters"], () => {
              camp.letters.splice(0, camp.letters.length, ...tidied(camp.letters));
              sfx.paper();
              changed();
              refreshPanel();
            }),
          );
        list.replaceChildren(...rows);
      },
    );
  }

  // ---------- the signpost ----------

  function signpost(body: HTMLElement): null {
    const here = at().owner();
    if (here !== null)
      body.append(
        way("Home", "Your own camp.", campIcon("home"), () => {
          at().leave("home");
        }),
      );
    body.append(
      way("Town", "Back up the hill.", campIcon("town"), () => {
        at().leave("town");
      }),
      el("div", "k-label", { text: "Down the trail" }),
      el("div", "k-paper note", {}, el("div", "", { text: "Members' camps, one day. The trail is not cut yet." })),
    );
    return null;
  }

  // ---------- at somebody else's camp (nothing opens these yet) ----------

  function note(body: HTMLElement): null {
    const host = at().host();
    body.append(
      el(
        "div",
        "k-paper note",
        {},
        el("div", "", { text: host?.note ?? "Back soon." }),
        el("hr"),
        el("div", "k-row", {}, face(host?.owner ?? ""), signed(host?.owner ?? "")),
      ),
      el("div", "k-d", { text: "Look round. Everything here answers a touch." }),
    );
    return null;
  }

  function present(body: HTMLElement): () => void {
    const host = at().host();
    const who = host?.owner ?? "them";
    const inside = el("div", "k-col");
    body.append(inside);
    return when(
      () => String(camp.gave.some((g) => g.to === who)),
      () => {
        const gave = camp.gave.find((g) => g.to === who);
        const left = gave ? thingOf(gave.what) : null;
        if (left) {
          inside.replaceChildren(
            el(
              "div",
              "k-row",
              {},
              linked(thingSlot(art, left.id, 26), thingRef(left.id)),
              el("div", "k-grow", { text: `You left ${who} ${left.name.toLowerCase()}.` }),
            ),
            el("div", "k-d", { text: "One present a camp. It stays where you put it." }),
          );
          return;
        }
        inside.replaceChildren(
          el("div", "", { text: `Leave ${who} something small?` }),
          ...guild.presents().flatMap((id) => {
            const thing = thingOf(id);
            if (!thing) return [];
            return [
              el(
                "div",
                "k-card",
                {},
                linked(thingSlot(art, id, 26), thingRef(id)),
                el("div", "k-grow", {}, named(thing.name, thingRef(id)), el("div", "k-d", { text: thing.about })),
                button("sm", ["Leave it"], () => {
                  at().give(id);
                  refreshPanel();
                }),
              ),
            ];
          }),
        );
      },
    );
  }

  function choose(body: HTMLElement): null {
    body.append(
      el("div", "", { text: "Three small faces look round the cabin door. One of them would like to stay." }),
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
        text: "The other two come along later, when the camp is cosier and you have been a kind neighbour.",
      }),
    );
    return null;
  }
  function pickPet(kind: PetId): void {
    closePanel();
    at().choose(kind);
  }

  const BUILD: Readonly<Record<CampPanel, (body: HTMLElement) => (() => void) | null>> = {
    cabin,
    mailbox,
    signpost,
    note,
    present,
    choose,
  };

  // ---------- the tray, while decorating ----------

  const tray = $("tray");
  const hand = el("div", "k-grow k-row");
  const row = el("div", "row");
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
    row,
  );
  const traySlots = new Map<string, HTMLElement>();

  function trayPic(id: string): HTMLCanvasElement | null {
    const sprite = pictureOf(art, id, 0, 0);
    if (!sprite) return null;
    const big = Math.max(sprite.c.width, sprite.c.height);
    return pic(sprite.c, big <= 14 ? 2 : big <= 28 ? 1 : 0.5);
  }

  function drawTray(): void {
    const s = at();
    if (!s.decorating()) return;
    const held = s.held();
    hand.replaceChildren(
      ...(held
        ? [
            el("span", "k-gold name", { text: held.name }),
            ...(held.turns
              ? [
                  button("wood sm", [glyph("turn"), el("span", "t", { text: "Turn" })], () => {
                    s.turn();
                  }),
                ]
              : []),
            ...(held.stays
              ? []
              : [
                  button("wood sm", [glyph("tray"), el("span", "t", { text: "Put away" })], () => {
                    s.stow();
                  }),
                ]),
          ]
        : [el("span", "k-d", { text: "Drag a thing to move it. Tap one below to set it out." })]),
    );
    traySlots.clear();
    const list = trayList(camp);
    row.replaceChildren(
      ...(list.length > 0
        ? list.map(({ id, n }) => {
            const thing = thingOf(id);
            const b = el(
              "button",
              "k-slot",
              { type: "button", "aria-label": thing?.name ?? id },
              trayPic(id),
              n > 1 ? el("span", "n", { text: n }) : null,
            );
            b.addEventListener("click", () => {
              s.takeOut(id);
            });
            // A tap sets it out; pointing (or a finger kept on it) shows its card.
            if (thing) link(b, thingRef(id), { acts: true });
            traySlots.set(id, b);
            return b;
          })
        : [el("span", "k-d empty", { text: "Nothing is put away. The market in town sells things for a camp." })]),
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
      const home = s.owner() === null;
      const place = (id: "cabin" | "mailbox" | "signpost", name: string, about: string, icon: CampIcon) => ({
        id,
        name,
        about,
        art: campIcon(icon),
        press: (): void => {
          if (G.panel === id || (id === "mailbox" && G.panel === "present")) closePanel();
          else s.go(id);
        },
      });
      const trail = (id: string, name: string, about: string, icon: CampIcon) => ({
        id,
        name,
        about,
        art: campIcon(icon),
        press: (): void => {
          closePanel();
          s.go("trail");
        },
      });
      setDock(
        home
          ? [
              place("cabin", "Cabin", "What you wear, what you have won, who lives here.", "cabin"),
              place("mailbox", "Mailbox", "Notes and presents from the town's own.", "mailbox"),
              place("signpost", "Signpost", "The way to town.", "signpost"),
              trail("town", "Town", "Back up the hill.", "town"),
            ]
          : [
              place("mailbox", "Leave a present", `Something small, for ${s.owner() ?? "them"}.`, "mailbox"),
              place("signpost", "Signpost", "Home, town, or another camp.", "signpost"),
              trail("home", "Home", "Back to your own camp.", "home"),
            ],
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
      hooks.toCamp = (): void => {
        if (!home) s.leave("home");
        else closePanel();
      };
      tray.hidden = true;
      document.body.classList.remove("decorating");
    },

    decorating(on) {
      tray.hidden = !on;
      document.body.classList.toggle("decorating", on);
      setHammer((): void => {
        at().decorate(!at().decorating());
      }, on);
      if (on) drawTray();
    },

    tray: drawTray,

    toTray(picture, from, id) {
      const p = toPage(from.x, from.y);
      const to = traySlots.get(id) ?? row;
      fly(picture, p, centre(to), 1, drawTray);
    },
  };
}
