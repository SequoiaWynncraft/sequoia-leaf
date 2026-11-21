/**
 * What the town remembers between visits, as one versioned record. Nothing here touches the
 * browser: `parse` takes whatever text was kept and gives back a record it can vouch for, or
 * nothing at all, and `keep.ts` does the reading and writing.
 */

import { type Camp, newCamp, parseCamp } from "./camp.ts";

export const VERSION = 1;

export interface Kept {
  /** What the member has bought and still has, and which of those they have on. */
  owned: string[];
  wearing: string[];
  /** Quests already claimed, by id. */
  claimed: string[];
  /** How often the missing crab has been spotted. */
  sightings: number;
  /** The day (as `dayOf` writes it) of the last welcome, and of the chest's last gift. */
  welcomed: string;
  chest: string;
  /** When the member was last in town, in milliseconds since 1970; 0 for never. */
  lastSeen: number;
  /**
   * On the guild's server: the id of the last of the member's own news the town has told them, so
   * that the next letter starts after it; null before the first visit there.
   */
  cursor: number | null;
  /** Whether the member's character stays in town, dozing, for a day after they go (on the guild's server). */
  stay: boolean;
  /** The member's own camp: what stands where, what is put away, who lives there, the mailbox. */
  camp: Camp;
}

export function blank(): Kept {
  return {
    owned: [],
    wearing: [],
    claimed: [],
    sightings: 0,
    welcomed: "",
    chest: "",
    lastSeen: 0,
    cursor: null,
    stay: true,
    camp: newCamp(),
  };
}

const two = (n: number): string => String(n).padStart(2, "0");

/** The local day a moment falls on, as `2026-11-21`. */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A sensible name for a thing: short, and made of plain letters. */
const isId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9-]{1,32}$/.test(v);

function ids(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter(isId))].slice(0, 64);
}

function count(v: unknown, most: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(most, Math.floor(v)) : 0;
}

const day = (v: unknown): string => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

/**
 * Reads a kept record back. Text that is not a record of this version gives `null` (start over);
 * inside a record, each part that makes no sense is put back to how a new member has it, and the
 * rest is kept.
 */
export function parse(text: string | null | undefined): Kept | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== VERSION) return null;
  const owned = ids(raw.owned);
  return {
    owned,
    wearing: ids(raw.wearing).filter((id) => owned.includes(id)),
    claimed: ids(raw.claimed),
    sightings: count(raw.sightings, 1e6),
    welcomed: day(raw.welcomed),
    chest: day(raw.chest),
    lastSeen: count(raw.lastSeen, 8.64e15),
    cursor:
      typeof raw.cursor === "number" && Number.isFinite(raw.cursor) && raw.cursor >= 0 ? Math.floor(raw.cursor) : null,
    stay: raw.stay !== false,
    camp: parseCamp(raw.camp) ?? newCamp(),
  };
}

export function write(k: Kept): string {
  return JSON.stringify({ v: VERSION, ...k });
}

/** Minutes between the last visit and now, never negative: a clock set backwards counts as no time. */
export function minutesAway(k: Kept, now: number): number {
  return k.lastSeen > 0 ? Math.max(0, (now - k.lastSeen) / 60000) : 0;
}
