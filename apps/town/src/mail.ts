/**
 * The mailbox: notes and small presents from guild-mates who came by while the member was out.
 * Who wrote and what they left is the guild's to say; this is only the box they are kept in.
 */

import { isThing } from "./things.ts";

export interface Letter {
  /** Its own name, so that the same letter is never delivered twice. */
  id: string;
  from: string;
  text: string;
  /** A present that came with it (a camp thing), or empty. */
  gift: string;
  read: boolean;
  /** The present has been taken out. */
  taken: boolean;
}

/**
 * The most letters the box holds; the oldest that have been dealt with make room first, then the
 * oldest with no present inside. A present is never thrown away to make room.
 */
export const BOX = 12;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function isLetter(v: unknown): v is Letter {
  return (
    isRecord(v) &&
    typeof v.id === "string" &&
    /^[a-z0-9-]{1,40}$/.test(v.id) &&
    typeof v.from === "string" &&
    /^[A-Za-z][A-Za-z '-]{0,23}$/.test(v.from) &&
    typeof v.text === "string" &&
    v.text.length <= 240 &&
    (v.gift === "" || isThing(v.gift)) &&
    typeof v.read === "boolean" &&
    typeof v.taken === "boolean"
  );
}

/** Whether a letter still wants something of the member: reading, or its present taking out. */
export const open = (l: Letter): boolean => !l.read || (l.gift !== "" && !l.taken);

/** How many letters are waiting. The mailbox glows while this is not nothing. */
export const waiting = (letters: readonly Letter[]): number => letters.filter(open).length;

/** Whether a letter has nothing left inside it: no present came with it, or it has been taken out. */
const emptied = (l: Letter): boolean => l.gift === "" || l.taken;

/** Whether another letter could go in the box: there is room, or a letter that can make room. */
export const roomInBox = (letters: readonly Letter[]): boolean => letters.length < BOX || letters.some(emptied);

/** What the feed says when a letter is not left because the box is full of presents. */
export const BOX_FULL = "Your mailbox is full. Take the presents out first.";

/**
 * Puts a letter in the box. Says whether it went in: one that is there already does not go in
 * twice, and none goes in while the box is full of presents not yet taken out.
 */
export function post(letters: Letter[], incoming: Letter): boolean {
  if (letters.some((l) => l.id === incoming.id) || !roomInBox(letters)) return false;
  // Full: the oldest letter that has been dealt with goes; failing that, the oldest with nothing inside.
  while (letters.length >= BOX) {
    const done = letters.findIndex((l) => !open(l));
    const room = done === -1 ? letters.findIndex(emptied) : done;
    if (room === -1) break;
    letters.splice(room, 1);
  }
  letters.push(incoming);
  return true;
}

/** The box with everything read and emptied thrown out. */
export const tidied = (letters: readonly Letter[]): Letter[] => letters.filter(open);

/** A letter as it is written: not yet read, its present (if any) still inside. */
export function letter(id: string, from: string, text: string, gift = ""): Letter {
  return { id, from, text, gift, read: false, taken: false };
}
