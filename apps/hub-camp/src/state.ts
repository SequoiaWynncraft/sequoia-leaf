/**
 * What the camp remembers between visits, kept in the browser: the purse, what has been bought and
 * claimed, and where everything was put.
 */
import { type DecoKind, type FixedId, MY_EXTRAS, type UV } from "./content.ts";

const KEY = "hubcamp.save.v1";

export interface Extra {
  id: number;
  kind: DecoKind;
  wide: UV;
  tall: UV;
}

export interface Save {
  leaf: number;
  coins: number;
  handle: string;
  muted: boolean;
  /** When the page was last open, in milliseconds; 0 for a first visit. */
  seen: number;
  owned: string[];
  claimed: string[];
  offered: number[];
  tray: Record<DecoKind, number>;
  spots: { wide: Partial<Record<FixedId, UV>>; tall: Partial<Record<FixedId, UV>> };
  extras: Extra[];
  nextId: number;
  crabsFound: number;
  missing: number;
  banner: number;
  seats: number;
  lands: number;
  roseOn: boolean;
}

function fresh(): Save {
  return {
    leaf: 128,
    coins: 412,
    handle: "Ferncloak",
    muted: false,
    seen: 0,
    owned: [],
    claimed: [],
    offered: [],
    tray: { lamp: 1, pot: 2, fern: 1, gnome: 1, stump: 1, shroom: 1, rug: 1, statue: 1, flag: 1 },
    spots: { wide: {}, tall: {} },
    extras: MY_EXTRAS.map(([kind, u, v], n) => ({ id: n + 1, kind, wide: [u, v], tall: [u, v] })),
    nextId: MY_EXTRAS.length + 1,
    crabsFound: 0,
    missing: 7,
    banner: -1,
    seats: 1,
    lands: 1,
    roseOn: false,
  };
}

function read(): Save {
  const base = fresh();
  try {
    // `?fresh` forgets everything, for seeing a first evening again
    if (new URLSearchParams(location.search).has("fresh")) localStorage.removeItem(KEY);
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const got: unknown = JSON.parse(raw);
    if (typeof got !== "object" || got === null) return base;
    return { ...base, ...(got as Partial<Save>) };
  } catch {
    return base;
  }
}

export const save: Save = read();
/** How long the member was gone, in minutes; a first visit counts as an evening away. */
export const awayMinutes: number = save.seen ? Math.min(600, Math.max(0, (Date.now() - save.seen) / 60000)) : 134;

export function keep(): void {
  save.seen = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // A private window may refuse; the camp still works, it only forgets.
  }
}

/** Puts the camp back as it was first found: the purse and purchases stay. */
export function tidy(): void {
  const base = fresh();
  save.spots = base.spots;
  save.extras = base.extras;
  save.nextId = base.nextId;
  save.tray = base.tray;
  keep();
}
