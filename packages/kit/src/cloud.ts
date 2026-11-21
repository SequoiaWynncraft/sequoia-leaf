/**
 * Keeping the member's game on their account, when the game is live. Everything the games keep is
 * text in the browser under a few names; each name belongs to one save slot on the server (`SLOTS`
 * says which), and a slot travels as `{ saved_at, keys: { <name>: <text> } }`.
 *
 * - `pull(slots)`, before a page reads anything it keeps: the server's copy of each slot is written
 *   into the browser. If this browser last held somebody else's game, that is cleared first.
 * - After that, any change to a slot's text is pushed, at most once every five seconds, with the
 *   version last read. On a conflict the later `saved_at` is kept.
 * - `flush()`, at once: on the town's `closing`, and when the page is put away.
 *
 * With the made-up guild none of this does anything: the browser is the only copy.
 */

import { member } from "./live.ts";
import { ask, isRecord, outside, put, type Store } from "./net.ts";
import { KEY as PURSE_KEY, reread } from "./purse.ts";
import { fromTown } from "./shell.ts";

export type Slot = "purse" | "town" | "works" | "raid";

/** Which kept names belong to which slot. What is not here (view settings, the sound) stays in the browser. */
export const SLOTS: Readonly<Record<Slot, readonly string[]>> = {
  purse: [PURSE_KEY],
  town: ["town.save.v1", "town.guild.v1", "town.postcard.works.v1", "town.postcard.raid.v1"],
  works: ["works.save.v2"],
  raid: ["raid.run.v1", "raid.almanac.v1"],
};
const ALL_SLOTS = Object.keys(SLOTS).filter((s): s is Slot => s in SLOTS);

/** At most one push of a slot in this long, in milliseconds. */
export const PUSH_EVERY = 5000;
/** The most a slot may be sent as while the page is going away (what a browser lets through then). */
const KEEPALIVE_MOST = 60_000;

/** What this browser knows of each slot: the version last read, when its text was saved, and a sum of that text. */
interface Known {
  version: number;
  saved: number;
  sum: string;
  /** When the text here was first seen to differ from `sum`. */
  changed?: number;
}
interface Meta {
  player: string;
  slots: Partial<Record<Slot, Known>>;
}
const META = "town.cloud.v1";

type Keys = Record<string, string>;

const store = (): Store | null => outside.store();

function readMeta(): Meta | null {
  try {
    const raw: unknown = JSON.parse(store()?.getItem(META) ?? "null");
    if (!isRecord(raw) || typeof raw.player !== "string" || !isRecord(raw.slots)) return null;
    const slots: Meta["slots"] = {};
    for (const slot of ALL_SLOTS) {
      const k = raw.slots[slot];
      if (!isRecord(k) || typeof k.version !== "number" || typeof k.saved !== "number" || typeof k.sum !== "string")
        continue;
      const known: Known = { version: k.version, saved: k.saved, sum: k.sum };
      if (typeof k.changed === "number") known.changed = k.changed;
      slots[slot] = known;
    }
    return { player: raw.player, slots };
  } catch {
    return null;
  }
}

function writeMeta(m: Meta): void {
  try {
    store()?.setItem(META, JSON.stringify(m));
  } catch {
    // Without storage nothing was kept to be pushed either.
  }
}

/** The texts a slot holds in this browser now. */
export function slotKeys(slot: Slot): Keys {
  const out: Keys = {};
  for (const name of SLOTS[slot]) {
    try {
      const text = store()?.getItem(name);
      if (typeof text === "string") out[name] = text;
    } catch {
      // Nothing kept under that name.
    }
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

/** Writes a slot's texts into the browser, and forgets any of its names the copy does not have. */
function writeKeys(slot: Slot, keys: Keys): void {
  const s = store();
  if (!s) return;
  for (const name of SLOTS[slot]) {
    try {
      const text = keys[name];
      if (typeof text === "string") s.setItem(name, text);
      else s.removeItem(name);
    } catch {
      // It will be pulled again next time.
    }
  }
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
/** Saves the page's own state into the browser; run before a flush. */
const savers: (() => void)[] = [];
let listening = false;

/** Something to run before the page's slots are flushed: the page writing down what it holds. */
export function before(save: () => void): void {
  savers.push(save);
}

/**
 * Fetches the page's slots and writes them into the browser before the page reads anything.
 * Says whether that worked; a page that could not get its saves should not play over them.
 */
export async function pull(slots: readonly Slot[]): Promise<boolean> {
  const me = member();
  if (!me) return true;
  let meta = readMeta();
  if (meta?.player !== me.id) {
    // Somebody else's game, or nobody's: nothing of it goes onto this member's account.
    for (const slot of ALL_SLOTS) writeKeys(slot, {});
    meta = { player: me.id, slots: {} };
    writeMeta(meta);
  }
  const answers = await Promise.all(slots.map(async (slot) => ({ slot, a: await ask(path(slot)) })));
  meta = readMeta() ?? meta;
  for (const { slot, a } of answers) {
    if (a.status === 404) {
      meta.slots[slot] = { version: 0, saved: 0, sum: sumOf({}) };
      continue;
    }
    const save = a.status === 200 ? readSave(a.body) : null;
    if (!save) return false;
    const known = meta.slots[slot];
    const here = slotKeys(slot);
    const changedHere = known !== undefined && known.sum !== sumOf(here);
    if (changedHere && (known.changed ?? known.saved) > save.saved) {
      // Changed here since it was last sent, and later than the server's copy: this one stays.
      meta.slots[slot] = { ...known, version: save.version };
    } else {
      writeKeys(slot, save.keys);
      meta.slots[slot] = { version: save.version, saved: save.saved, sum: sumOf(save.keys) };
    }
  }
  writeMeta(meta);
  for (const slot of slots) mine.add(slot);
  if (!listening && typeof window !== "undefined") {
    listening = true;
    window.setInterval(tick, 1000);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    fromTown(flush);
  }
  return true;
}

/** Looks for changes in the page's slots, and pushes any that are due. */
export function tick(): void {
  if (!member()) return;
  const now = outside.now();
  for (const slot of mine) {
    const meta = readMeta();
    const known = meta?.slots[slot];
    if (!meta || !known || sending.has(slot)) continue;
    if (sumOf(slotKeys(slot)) === known.sum) continue;
    if (known.changed === undefined) {
      known.changed = now;
      writeMeta(meta);
    }
    if (now - (lastPush.get(slot) ?? 0) >= PUSH_EVERY) void push(slot);
  }
}

/** Pushes every one of the page's slots that has changed, at once, so that it survives the page going away. */
export function flush(): void {
  if (!member()) return;
  for (const save of savers) save();
  for (const slot of mine) void push(slot, true);
}

/** Sends a slot as it is here now, with the version last read. Says whether the server took it. */
export async function push(slot: Slot, leaving = false, tries = 2): Promise<boolean> {
  const meta = readMeta();
  const known = meta?.slots[slot];
  if (!meta || !known) return false;
  const keys = slotKeys(slot);
  const sum = sumOf(keys);
  if (sum === known.sum) return true;
  const saved = known.changed ?? outside.now();
  const body = { version: known.version, data: { saved_at: saved, keys } };
  sending.add(slot);
  lastPush.set(slot, outside.now());
  const a = await put(path(slot), body, leaving && JSON.stringify(body).length < KEEPALIVE_MOST);
  sending.delete(slot);
  const after = readMeta() ?? meta;
  if (a.status === 200 && isRecord(a.body) && typeof a.body.version === "number") {
    after.slots[slot] = { version: a.body.version, saved, sum };
    writeMeta(after);
    return true;
  }
  if (a.status === 409 && tries > 0) {
    const theirs = await ask(path(slot));
    const save = theirs.status === 200 ? readSave(theirs.body) : null;
    if (!save) return false;
    if (save.saved > saved) {
      // Saved somewhere else later than here: that copy is kept.
      writeKeys(slot, save.keys);
      after.slots[slot] = { version: save.version, saved: save.saved, sum: sumOf(save.keys) };
      writeMeta(after);
      return false;
    }
    after.slots[slot] = { ...known, version: save.version };
    writeMeta(after);
    return push(slot, leaving, tries - 1);
  }
  if (a.status === 413 || a.status === 400) {
    // The server will not take this text; it is not sent again until it changes.
    after.slots[slot] = { version: known.version, saved: known.saved, sum };
    writeMeta(after);
  }
  return false;
}

/** Forgets the page's slots (for tests). */
export function forget(): void {
  mine.clear();
  lastPush.clear();
  sending.clear();
  savers.length = 0;
}
