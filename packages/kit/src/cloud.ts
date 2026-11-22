/**
 * Keeping the member's game on their account, when the game is live. Everything the games keep is
 * text in the browser under a few names; each name belongs to one save slot on the server (`SLOTS`
 * says which), and a slot travels as `{ saved_at, keys: { <name>: <text> } }`.
 *
 * - `pull(slots, { onReplaced })`, before a page reads anything it keeps: the server's copy of each
 *   slot is written into the browser, unless the browser holds a change to it not yet sent. If this
 *   browser last held somebody else's game, that is cleared first.
 * - A slot holds a change not yet sent when its text here differs from what was last pulled or
 *   pushed (a sum of which the slot's record here keeps); never by how long ago anything happened.
 * - After that, any change to a slot's text is pushed, at most once every five seconds, with the
 *   version last read. On a conflict the later `saved_at` is kept. When that is the other copy, the
 *   page holds an older game than the browser now does: this page sends that slot no more, and
 *   `onReplaced` is told, so that the page can open again from that copy (`pickUp`). The purse is
 *   only read again.
 * - Each push says which member the page started as. When the browser turns out to hold another
 *   member's game (they signed in in another tab), or the server says the page is not who it thinks,
 *   the page stops (`stopped()`): it syncs nothing more, writes nothing more of the game into the
 *   browser (`keep.ts`), even as it goes away, and loads again, as whoever is signed in now.
 * - What changes by itself (`QUIET`: the time the member was last in town) is not a change: it goes
 *   with the next real one, or when the page is put away.
 * - `flush()`, at once: on the town's `closing`, and when the page is put away.
 *
 * With the made-up guild none of this does anything: the browser is the only copy.
 */

import { el } from "./dom.ts";
import { askFirst, forgetStop, keepText, keptText, stop, stopped } from "./keep.ts";
import { member } from "./live.ts";
import { ask, isRecord, outside, put } from "./net.ts";
import { KEY as PURSE_KEY, reread } from "./purse.ts";
import { fromTown } from "./shell.ts";

export { stopped };

/** The slots pages still keep their games in. The Little Raid's game is Leaf's own now (`play.ts`), and its old slot is closed. */
export type Slot = "purse" | "town" | "works";

/** Which kept names belong to which slot. What is not here (view settings, the sound) stays in the browser. */
export const SLOTS: Readonly<Record<Slot, readonly string[]>> = {
  purse: [PURSE_KEY],
  town: ["town.save.v1", "town.guild.v1", "town.postcard.works.v1", "town.postcard.raid.v1"],
  works: ["works.save.v2"],
};
const ALL_SLOTS = Object.keys(SLOTS).filter((s): s is Slot => s in SLOTS);

/**
 * The parts of a kept record that change by themselves while the member only stands there. A change
 * to these alone is not sent: they go with the next real change, and when the page is put away.
 */
export const QUIET: Readonly<Record<string, readonly string[]>> = {
  "town.save.v1": ["lastSeen"],
};

/** At most one push of a slot in this long, in milliseconds. */
export const PUSH_EVERY = 5000;
/** The most a slot may be sent as while the page is going away (what a browser lets through then). */
const KEEPALIVE_MOST = 60_000;

/** What this browser knows of each slot: the version last read, when its text was saved, and a sum of that text. */
interface Known {
  version: number;
  saved: number;
  /** The sum of the text last pulled or pushed: text here that differs from it has not been sent. */
  sum: string;
  /** The same sum without the quiet parts (`calmSumOf`). */
  calm?: string;
  /**
   * When the text here was first seen to differ from `sum`: the time a push says it was saved.
   * Only the sums say whether there is anything to send.
   */
  changed?: number;
}
interface Meta {
  player: string;
  slots: Partial<Record<Slot, Known>>;
}
const META = "town.cloud.v1";

type Keys = Record<string, string>;

function readMeta(): Meta | null {
  try {
    const raw: unknown = JSON.parse(keptText(META) ?? "null");
    if (!isRecord(raw) || typeof raw.player !== "string" || !isRecord(raw.slots)) return null;
    const slots: Meta["slots"] = {};
    for (const slot of ALL_SLOTS) {
      const k = raw.slots[slot];
      if (!isRecord(k) || typeof k.version !== "number" || typeof k.saved !== "number" || typeof k.sum !== "string")
        continue;
      const known: Known = { version: k.version, saved: k.saved, sum: k.sum };
      if (typeof k.calm === "string") known.calm = k.calm;
      if (typeof k.changed === "number") known.changed = k.changed;
      slots[slot] = known;
    }
    return { player: raw.player, slots };
  } catch {
    return null;
  }
}

/** Writes down what is known of the slots. Without storage nothing was kept to be pushed either. */
function writeMeta(m: Meta): void {
  keepText(META, JSON.stringify(m));
}

/** The texts a slot holds in this browser now. */
export function slotKeys(slot: Slot): Keys {
  const out: Keys = {};
  for (const name of SLOTS[slot]) {
    const text = keptText(name);
    if (text !== null) out[name] = text;
  }
  return out;
}

/** A short sum of a slot's texts, to see whether they have changed. */
export function sumOf(keys: Keys): string {
  let h = 2166136261;
  const text = JSON.stringify(Object.entries(keys).toSorted(([a], [b]) => (a < b ? -1 : 1)));
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `${(h >>> 0).toString(36)}.${text.length}`;
}

/** A record's text without its quiet parts; anything that is not a record stays as it is. */
function calm(name: string, text: string): string {
  const quiet = QUIET[name];
  if (!quiet) return text;
  try {
    const v: unknown = JSON.parse(text);
    if (!isRecord(v)) return text;
    return JSON.stringify(Object.fromEntries(Object.entries(v).filter(([k]) => !quiet.includes(k))));
  } catch {
    return text;
  }
}

/** The sum of a slot's texts, leaving out what changes by itself (`QUIET`). */
export function calmSumOf(keys: Keys): string {
  return sumOf(Object.fromEntries(Object.entries(keys).map(([name, text]) => [name, calm(name, text)])));
}

/** Whether a slot's texts here hold a change not yet sent: one beyond what changes by itself. */
function unsent(known: Known, keys: Keys): boolean {
  return known.calm === undefined ? sumOf(keys) !== known.sum : calmSumOf(keys) !== known.calm;
}

/** What is known of a slot whose texts are these, saved then, at that version. */
const knownAs = (version: number, saved: number, keys: Keys): Known => ({
  version,
  saved,
  sum: sumOf(keys),
  calm: calmSumOf(keys),
});

/**
 * Writes a slot's texts into the browser, and forgets any of its names the copy does not have.
 * What does not get written is pulled again next time.
 */
function writeKeys(slot: Slot, keys: Keys): void {
  for (const name of SLOTS[slot]) keepText(name, keys[name] ?? null);
  if (slot === "purse") reread();
}

/** A save as the server sends it, or null for anything that is not one. */
function readSave(v: unknown): { version: number; saved: number; keys: Keys } | null {
  if (!isRecord(v) || typeof v.version !== "number" || !isRecord(v.data)) return null;
  const { saved_at: saved, keys } = v.data;
  if (!isRecord(keys)) return null;
  const out: Keys = {};
  for (const name of Object.keys(keys)) {
    const text = keys[name];
    if (typeof text === "string") out[name] = text;
  }
  return { version: v.version, saved: typeof saved === "number" ? saved : 0, keys: out };
}

const path = (slot: Slot): string => `/v1/game/saves/${slot}`;

// ---------- the page's slots ----------

/** The slots this page keeps in step, once it has pulled them. */
const mine = new Set<Slot>();
const lastPush = new Map<Slot, number>();
const sending = new Set<Slot>();
/** Slots another device's later copy has replaced while this page was open: this page sends them no more. */
const replaced = new Set<Slot>();
/** Saves the page's own state into the browser; run before a flush. */
const savers: (() => void)[] = [];
/** Told when another device's copy of one of the page's slots (other than the purse) has won. */
let onReplaced: (slot: Slot) => void = () => undefined;
let listening = false;

/**
 * This page leaves the browser's game alone from now on, and loads again, as whoever is signed in
 * now. It stops before anything else: loading again puts the page away, and what the page writes
 * down as it goes is the member it started as.
 */
function letGo(): void {
  if (stopped()) return;
  stop();
  outside.reload();
}

/**
 * Whether the browser still holds the game of the member this page started as (`member()`, found
 * once per page). If another member's page has taken it over since, this page lets go.
 */
function stillMine(): boolean {
  if (stopped()) return false;
  const me = member();
  const meta = readMeta();
  // With no record of whose it is, nothing here is known well enough to be sent anyway.
  if (!me || !meta || meta.player === me.id) return true;
  letGo();
  return false;
}

/** Something to run before the page's slots are flushed: the page writing down what it holds. */
export function before(save: () => void): void {
  savers.push(save);
}

/** What a page tells `pull` besides its slots. */
export interface Pulling {
  /**
   * Another device saved one of the page's slots later than this page did, and that copy is now in
   * the browser: what the page holds is older, and the page should open again (`pickUp`).
   */
  onReplaced: (slot: Slot) => void;
}

/**
 * Fetches the page's slots and writes them into the browser before the page reads anything.
 * Says whether that worked; a page that could not get its saves should not play over them.
 */
export async function pull(slots: readonly Slot[], opts: Pulling): Promise<boolean> {
  const me = member();
  if (!me) return true;
  onReplaced = opts.onReplaced;
  let meta = readMeta();
  if (meta?.player !== me.id) {
    // Somebody else's game, or nobody's: nothing of it goes onto this member's account. Whose it
    // is now is written first, so that a page of theirs still open stops before anything is cleared.
    meta = { player: me.id, slots: {} };
    writeMeta(meta);
    for (const slot of ALL_SLOTS) writeKeys(slot, {});
  }
  // The browser's game is this member's now. From here on, every write first makes sure it still
  // is, so that nothing this page holds is written over another member's who has taken it since.
  askFirst(stillMine);
  const answers = await Promise.all(slots.map(async (slot) => ({ slot, a: await ask(path(slot)) })));
  // Taken over by another member's page meanwhile: none of this is theirs to keep.
  if (!stillMine()) return false;
  meta = readMeta() ?? meta;
  for (const { slot, a } of answers) {
    const known = meta.slots[slot];
    if (a.status === 404) {
      // Never saved: whatever is here goes up with the first push.
      if (known?.version !== 0) meta.slots[slot] = knownAs(0, 0, {});
      continue;
    }
    const save = a.status === 200 ? readSave(a.body) : null;
    if (!save) return false;
    // The server holds the copy last pulled or pushed here: what is here is that, or newer.
    if (known?.version === save.version) continue;
    const now = outside.now();
    if (known !== undefined && unsent(known, slotKeys(slot)) && save.saved <= now) {
      // Changed here and not sent, and saved since somewhere else: as on any conflict the later
      // copy is kept, and the change here counts as made now. It goes over the server's version.
      meta.slots[slot] = { ...known, version: save.version, changed: now };
    } else {
      writeKeys(slot, save.keys);
      meta.slots[slot] = knownAs(save.version, save.saved, save.keys);
    }
  }
  writeMeta(meta);
  for (const slot of slots) mine.add(slot);
  if (!listening && typeof window !== "undefined") {
    listening = true;
    window.setInterval(tick, 1000);
    // Another page writing the browser's game: one signed in as somebody else means this one stops.
    window.addEventListener("storage", () => {
      stillMine();
    });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    fromTown((msg) => {
      if (msg.town === "closing") flush();
    });
  }
  return true;
}

/** Looks for changes in the page's slots, and pushes any that are due. */
export function tick(): void {
  if (!member() || !stillMine()) return;
  const now = outside.now();
  for (const slot of mine) {
    const meta = readMeta();
    const known = meta?.slots[slot];
    if (!meta || !known || sending.has(slot) || replaced.has(slot)) continue;
    const keys = slotKeys(slot);
    if (sumOf(keys) === known.sum) continue;
    if (known.changed === undefined) {
      // Only what changes by itself has changed: that waits for a real change, or the page going away.
      if (!unsent(known, keys)) continue;
      known.changed = now;
      writeMeta(meta);
    }
    if (now - (lastPush.get(slot) ?? 0) >= PUSH_EVERY) void push(slot);
  }
}

/** Pushes every one of the page's slots that has changed, at once, so that it survives the page going away. */
export function flush(): void {
  if (!member() || !stillMine()) return;
  for (const save of savers) save();
  for (const slot of mine) if (!replaced.has(slot)) void push(slot, true);
}

/**
 * Sends a slot as it is here now, as the member the page started as, with the version last read.
 * Says whether the server took it.
 */
export async function push(slot: Slot, leaving = false, tries = 2): Promise<boolean> {
  const me = member();
  if (!me || !stillMine()) return false;
  const meta = readMeta();
  const known = meta?.slots[slot];
  if (!meta || !known || replaced.has(slot)) return false;
  const keys = slotKeys(slot);
  const sum = sumOf(keys);
  if (sum === known.sum) return true;
  // Sent with only its quiet parts changed, the slot was last really changed when it was last saved.
  const quiet = known.changed === undefined && !unsent(known, keys);
  const saved = known.changed ?? (quiet ? known.saved : outside.now());
  const body = { player: me.id, version: known.version, data: { saved_at: saved, keys } };
  sending.add(slot);
  lastPush.set(slot, outside.now());
  const a = await put(path(slot), body, leaving && JSON.stringify(body).length < KEEPALIVE_MOST);
  sending.delete(slot);
  if (a.status === 409 && isRecord(a.body) && a.body.code === "not_you") {
    // Signed in as somebody else since this page opened: what it holds is not theirs.
    letGo();
    return false;
  }
  // Taken over by another member's page while this was on its way: their record is not written over.
  if (!stillMine()) return false;
  const after = readMeta() ?? meta;
  if (a.status === 200 && isRecord(a.body) && typeof a.body.version === "number") {
    after.slots[slot] = knownAs(a.body.version, saved, keys);
    writeMeta(after);
    return true;
  }
  if (a.status === 409 && tries > 0) {
    const theirs = await ask(path(slot));
    const save = theirs.status === 200 ? readSave(theirs.body) : null;
    if (!save) return false;
    if (save.saved > saved) {
      // Saved somewhere else later than here: that copy is kept. Whatever the page still holds of
      // this slot is older, so it is not sent again, and the page opens again from that copy.
      writeKeys(slot, save.keys);
      after.slots[slot] = knownAs(save.version, save.saved, save.keys);
      writeMeta(after);
      if (slot !== "purse" && !replaced.has(slot)) {
        replaced.add(slot);
        // The page is about to load again. Until it does, its savers must not write what it still
        // holds over the copy just taken, or the next load would send the older game back up.
        stop();
        onReplaced(slot);
      }
      return false;
    }
    after.slots[slot] = { ...known, version: save.version };
    writeMeta(after);
    return push(slot, leaving, tries - 1);
  }
  if (a.status === 413 || a.status === 400) {
    // The server will not take this text; it is not sent again until it changes.
    after.slots[slot] = knownAs(known.version, known.saved, keys);
    writeMeta(after);
  }
  return false;
}

/** The line a page shows before it opens again from another device's copy. */
export const PICKED_UP = "Picked up where you left off on another device.";
/** How long that line shows before the page opens again, in milliseconds. */
const PICK_UP_FOR = 1800;
let pickingUp = false;

/**
 * What every page does when another device's copy of one of its slots wins: says so for a moment,
 * then loads again from that copy. A game inside the town's frame loads only itself again.
 */
export function pickUp(): void {
  if (pickingUp) return;
  pickingUp = true;
  document.body.append(el("div", "k-toast alone", { role: "status", text: PICKED_UP }));
  window.setTimeout(() => location.reload(), PICK_UP_FOR);
}

/** Forgets the page's slots (for tests). */
export function forget(): void {
  mine.clear();
  lastPush.clear();
  sending.clear();
  replaced.clear();
  savers.length = 0;
  onReplaced = () => undefined;
  listening = false;
  forgetStop();
}
