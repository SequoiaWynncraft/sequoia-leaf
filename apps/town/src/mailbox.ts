/**
 * The mailbox at the member's own camp: the letters and presents from townsfolk, newest first, and
 * under them its visitors, who likes the camp and who stayed in it this week (`camps.ts`), each
 * with their face, opening their card.
 */

import { el, icon as glyph } from "@sequoia-leaf/kit/dom.ts";
import { folkName } from "@sequoia-leaf/kit/mark.ts";
import { fly } from "@sequoia-leaf/kit/pursebar.ts";
import { faceFor, facesCame } from "@sequoia-leaf/kit/skin.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { folkNamed } from "@sequoia-leaf/town/folk.ts";
import { tidied } from "@sequoia-leaf/town/mail.ts";
import { thingOf } from "@sequoia-leaf/town/things.ts";

import { personRow } from "./aboutui.ts";
import { type CampArt, pictureOf } from "./campart.ts";
import { type Visitor, visitors } from "./camps.ts";
import { folkArt } from "./folkart.ts";
import { hooks } from "./game.ts";
import { button, centre, hammerAt, pic, refreshPanel, when } from "./hud.ts";
import { doNow, mine, ok, refusal } from "./leaf.ts";
import { thingSlot } from "./ui.ts";

/** Whoever wrote a letter, if it is one of the town's own: its own picture. */
function face(name: string): HTMLCanvasElement | null {
  const t = folkNamed(name);
  return t ? pic(folkArt(t).face, 1) : null;
}

/** A name on a letter: one of the town's own with its mark. */
const signed = (name: string): HTMLElement =>
  folkNamed(name) ? folkName(name, "k-pix k-grow") : el("b", "k-grow", { text: name });

/** The letters, newest first, each with its present to take; and the button that clears those dealt with. */
function letters(art: CampArt, list: HTMLElement): () => void {
  // What had not been read when the box was opened is marked new this once; opening it is reading it.
  const fresh = new Set(
    mine()
      .letters.filter((l) => !l.read)
      .map((l) => l.id),
  );
  if (fresh.size > 0) doNow({ do: "readMail" });
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
            if (sprite) fly(() => pic(sprite.c, 2), centre(b), hammerAt(), 1);
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

/** Somebody's row among the visitors: their face, their name, "Guest" for a guest; it opens their card. */
const visitorRow = (v: Visitor): HTMLElement =>
  personRow({ id: v.id, name: v.name, line: v.guest ? "Guest" : "", you: false }, faceFor(v.id, v.name, true));

/** The visitors, as Leaf gives them once the box is opened; their faces drawn again in place as they come. */
function visited(part: HTMLElement): () => void {
  let got: Awaited<ReturnType<typeof visitors>> | undefined;
  void (async () => {
    got = await visitors();
    refreshPanel();
  })();
  const shown: { readonly v: Visitor; readonly row: HTMLElement }[] = [];
  const group = (title: string, of: readonly Visitor[]): Node[] => {
    const rows = of.map((v) => ({ v, row: visitorRow(v) }));
    shown.push(...rows);
    return of.length === 0
      ? []
      : [el("div", "k-d", { text: title }), el("div", "about-part", {}, ...rows.map((r) => r.row))];
  };
  const drawList = when(
    () => (got === undefined ? "asking" : got === null ? "failed" : "read"),
    () => {
      shown.length = 0;
      const parts =
        got === null
          ? [el("div", "k-d", { text: "Visitors could not be read." })]
          : got === undefined
            ? []
            : [...group("Who likes your camp", got.likes), ...group("Who stayed this week", got.stays)];
      part.replaceChildren(
        el("div", "k-label", { text: "Visitors" }),
        ...(got && parts.length === 0 ? [el("div", "k-d", { text: "Nobody yet." })] : parts),
      );
    },
  );
  const drawFaces = when(
    () => String(facesCame()),
    () => {
      for (const { v, row } of shown)
        row.querySelector(".k-thing-pic")?.replaceChildren(pic(faceFor(v.id, v.name, true), 2));
    },
  );
  return () => {
    drawList();
    drawFaces();
  };
}

/** The mailbox's panel: the letters, and under them the visitors. */
export function mailbox(art: CampArt, body: HTMLElement): () => void {
  const list = el("div", "k-col");
  const part = el("div", "k-col");
  body.append(list, part);
  const drawLetters = letters(art, list);
  const drawVisited = visited(part);
  return () => {
    drawLetters();
    drawVisited();
  };
}
