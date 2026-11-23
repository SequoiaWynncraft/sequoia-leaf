/**
 * The camp's own part of the interface: the cabin (the member's own things), the mailbox, the
 * signpost (to town, and to everybody else's camp), and the tray (a player reads "Storage"):
 * everything the member has that is not set out, by kind, which the hammer opens. At somebody
 * else's camp there is only the signpost, home or to town, and the strip that says whose camp it
 * is. The purse, the feed and the panel's frame are shared with the town (`hud.ts`).
 */

import { link } from "@sequoia-leaf/kit/card.ts";
import { el, icon as glyph, shown } from "@sequoia-leaf/kit/dom.ts";
import { folkName } from "@sequoia-leaf/kit/mark.ts";
import { ask as askLeaf } from "@sequoia-leaf/kit/net.ts";
import { readBoard, type Row } from "@sequoia-leaf/kit/person.ts";
import { faceFor, facesCame } from "@sequoia-leaf/kit/skin.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { makeCanvas, type Pt } from "@sequoia-leaf/kit/util.ts";
import { COSY, KIND, newThings, type PetId, PETS, petsOf, trayList } from "@sequoia-leaf/town/camp.ts";
import { folkNamed } from "@sequoia-leaf/town/folk.ts";
import { tidied } from "@sequoia-leaf/town/mail.ts";
import { KIND_NAMES, KINDS, thingOf, THINGS } from "@sequoia-leaf/town/things.ts";

import { type CampArt, type CampIcon, campIcon, pictureOf } from "./campart.ts";
import type { CampScene } from "./campscene.ts";
import { thingRef } from "./cards.ts";
import { folkArt } from "./folkart.ts";
import { G, hooks, toPage } from "./game.ts";
import { guild } from "./guild.ts";
import {
  $,
  button,
  centre,
  closePanel,
  fly,
  hammerAt,
  openPanel,
  pic,
  refreshPanel,
  setDock,
  setFace,
  setHammer,
  setHammerNew,
  setStrip,
  slot,
  when,
} from "./hud.ts";
import { doNow, mine, ok, refusal, town, visiting } from "./leaf.ts";
import { MY_PETS, PET_ABOUT, PET_CHOICE } from "./pets.ts";
import { openPanel as openTownPanel, thingSlot } from "./ui.ts";

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

/** Whoever wrote a letter, if it is one of the town's own: its own picture. */
function face(name: string): HTMLCanvasElement | null {
  const t = folkNamed(name);
  return t ? pic(folkArt(t).face, 1) : null;
}

/** A name on a letter: one of the town's own with its mark. */
const signed = (name: string): HTMLElement =>
  folkNamed(name) ? folkName(name, "k-pix k-grow") : el("b", "k-grow", { text: name });

/** The most camps the signpost lists. */
const CAMPS_LISTED = 12;

/** A row of the signpost: somewhere to go, and the button that goes there. */
function way(name: string, art: HTMLCanvasElement, go: () => void, line = ""): HTMLElement {
  return el(
    "div",
    "k-card",
    {},
    slot(art, 20),
    el("div", "k-grow", {}, name, line === "" ? null : el("div", "k-d", { text: line })),
    button("sm", ["Go"], () => {
      closePanel();
      go();
    }),
  );
}

export function makeCampUi(art: CampArt): CampUi & { bind(scene: CampScene): void } {
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
    const xp = el("i");
    xp.style.setProperty("--v", `${Math.min(100, (me.xp / me.next) * 100)}%`);
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
          el("div", "k-dim", { text: `${me.rank} of the guild, level ${me.level}` }),
          el("div", "k-bar", {}, xp),
          me.week.length === 0 ? null : el("div", "k-dim", { text: `This week: ${me.week.join(", ")}` }),
        ),
      ),
      stayRow,
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
          const cosy = camp.placed.length >= COSY;
          const kind = camp.greeted >= KIND;
          rows.push(
            el("div", "k-d", {
              text: `One more moves in when ${COSY} things are placed in your camp, and one more when you have greeted ${KIND} townsfolk.`,
            }),
          );
          if (!cosy) rows.push(el("div", "k-dim", { text: `Things placed: ${camp.placed.length} of ${COSY}.` }));
          if (!kind)
            rows.push(
              el("div", "k-d", {
                text: `Townsfolk greeted: ${Math.min(camp.greeted, KIND)} of ${KIND}. When somebody from town drops by your camp, tap them.`,
              }),
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

  // ---------- the mailbox ----------

  function mailbox(body: HTMLElement): () => void {
    // What had not been read when the box was opened is marked new this once; opening it is reading it.
    const fresh = new Set(
      mine()
        .letters.filter((l) => !l.read)
        .map((l) => l.id),
    );
    if (fresh.size > 0) doNow({ do: "readMail" });
    const list = el("div", "k-col");
    body.append(list);
    return when(
      () =>
        mine()
          .letters.map((l) => `${l.id}${l.taken ? "t" : ""}`)
          .join(),
      () => {
        const camp = mine();
        if (camp.letters.length === 0) {
          list.replaceChildren(el("div", "k-d", { text: "No letters. The flag goes up when one arrives." }));
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
            el("div", "k-read", { text: l.text }),
          );
          if (gift && !l.taken) {
            // Out of the letter and into the tray: it is seen going to the hammer, which opens it.
            const take = button("sm", [glyph("gift"), "Take it"], (b) => {
              const did = doNow({ do: "takePresent", letter: l.id });
              if (!ok(did)) {
                if (did) hooks.feed(refusal(did.refused), "coral");
                return;
              }
              sfx.pop();
              const sprite = pictureOf(art, gift.id, 0, 0);
              if (sprite) fly(sprite.c, centre(b), hammerAt(), 1);
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
              if (doNow({ do: "clearLetters" }) === null) return;
              sfx.paper();
              refreshPanel();
            }),
          );
        list.replaceChildren(...rows);
      },
    );
  }

  // ---------- the signpost ----------

  /** Home (at somebody else's camp) and town; and at the member's own, the camps on the town's board. */
  function signpost(body: HTMLElement): (() => void) | null {
    const host = visiting();
    if (host)
      body.append(
        way("Home", shown(campIcon("home"), 1), () => {
          at().leave("home");
        }),
      );
    body.append(
      way("Town", shown(campIcon("town"), 1), () => {
        at().leave("town");
      }),
    );
    if (host) return null;
    const list = el("div", "k-col");
    body.append(list);
    let camps: readonly Row[] = [];
    void (async () => {
      const a = await askLeaf("/v1/game/play/town/standings");
      const board = a.status === 200 ? readBoard(a.body) : null;
      camps = board ? board.top.filter((r) => !r.you).slice(0, CAMPS_LISTED) : [];
      refreshPanel();
    })();
    return when(
      () => `${facesCame()}|${camps.map((r) => `${r.id}/${r.score}`).join()}`,
      () => {
        list.replaceChildren(
          ...camps.map((r) =>
            way(
              r.name,
              pic(faceFor(r.id, r.name, true), 2),
              () => {
                hooks.visitCamp(r.id, r.name);
              },
              `${r.score} things set out`,
            ),
          ),
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
        text: `The other two move in later: one when ${COSY} things are placed in your camp, one when you have greeted ${KIND} townsfolk.`,
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
    setHammerNew(newThings(mine()));
    if (!s.decorating()) return;
    // The tray is open, so what is new in it has been looked at: Leaf is told, and it stays marked here.
    const fresh = Object.keys(mine().fresh);
    for (const id of fresh) marked.add(id);
    if (fresh.length > 0) doNow({ do: "looked", things: fresh });
    const held = s.held();
    hand.replaceChildren(
      ...(held
        ? [
            el("span", "k-gold name", { text: held.name }),
            ...(held.turns
              ? [
                  button("wood sm", [glyph("turn"), el("span", "t", { text: "Rotate" })], () => {
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
              place("signpost", "Signpost", "The way to town.", "signpost"),
              trail("Town", "town"),
            ]
          : [place("signpost", "Signpost", "Home, or town.", "signpost"), trail("Home", "home")],
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
      hooks.toCamp = (): boolean => {
        if (!home) s.leave("home");
        else closePanel();
        return true;
      };
      setStrip(host, () => {
        s.leave("home");
      });
      tray.hidden = true;
      document.body.classList.remove("decorating");
      setHammerNew(home ? newThings(mine()) : 0);
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
      fly(picture, toPage(from.x, from.y), centre(to), 1, drawTray);
    },
  };
}
