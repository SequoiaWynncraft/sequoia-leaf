/**
 * Who is about, as Live tells it to the town's rooms: Leaf's lists (`Who`, the presence routes'
 * answer), and how one set of lists becomes the next (`AboutChange`), so that Leaf sends a room what
 * changed rather than all of it each time. A page builds each new set from the last it had
 * (`applyAbout`) and has exactly the lists Leaf made: the same people, the same fields, in the same
 * order.
 */

/** One line of a list: somebody, by their `id`, with fields that are each a plain value. */
export type Row = Readonly<Record<string, string | number | boolean | null>> & { readonly id: string };

/** Leaf's lists of who is about, and when it made them (`at`, a time as text). */
export interface Who {
  readonly at: string;
  readonly present: readonly Row[];
  readonly resting: readonly Row[];
  readonly gone: readonly Row[];
}

/** The lists, by name. */
const ABOUT_LISTS = ["present", "resting", "gone"] as const;
type ListName = (typeof ABOUT_LISTS)[number];

/**
 * How one list became the next: who left it (`drop`, by id); who joined it, each at their place in
 * the new list (`add`, by position, in order); and of those who stayed, each whose fields changed,
 * with only those fields (`put`). Those who stayed keep their order: somebody who moved in the list
 * is dropped and added again.
 */
interface ListChange {
  readonly drop?: readonly string[];
  readonly add?: readonly (readonly [number, Row])[];
  readonly put?: readonly Row[];
}

/** How one set of lists became the next: when the new one was made, and each list that changed. */
export interface AboutChange {
  readonly at: string;
  readonly lists: Partial<Readonly<Record<ListName, ListChange>>>;
}

/**
 * Which of `before`'s rows and `after`'s, by position, are the same people in the same order: as
 * many as can be, so that as few as can be are dropped and added again. Nobody is in a list twice
 * (`applyList` takes no list that has), so these are the longest run of `after`'s people whose
 * places in `before` only go up. It is found in one pass (patience sorting): each person ends the
 * shortest run they can lengthen, found by halving, unless they lengthen the longest, which is
 * looked at first; so a list in the same order as before takes one step a person.
 */
function kept(before: readonly Row[], after: readonly Row[]): Map<number, number> {
  const was = new Map<string, number>();
  for (const [i, row] of before.entries()) if (!was.has(row.id)) was.set(row.id, i);
  // `after`'s people who were in `before`, each with their position in both.
  const both: { readonly j: number; readonly i: number }[] = [];
  for (const [j, row] of after.entries()) {
    const i = was.get(row.id);
    if (i !== undefined) both.push({ j, i });
  }
  // `ends[k]`: of the runs of k + 1 so far, the one ending lowest in `before`, by its last (in `both`);
  // `back[n]`: the one before `both[n]` in the run it ends.
  const ends: number[] = [];
  const back: number[] = [];
  const placeOf = (n: number | undefined): number => (n === undefined ? -1 : (both[n]?.i ?? -1));
  for (const [n, { i }] of both.entries()) {
    let low = placeOf(ends.at(-1)) < i ? ends.length : 0;
    let high = ends.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (placeOf(ends[mid]) < i) low = mid + 1;
      else high = mid;
    }
    back[n] = ends[low - 1] ?? -1;
    ends[low] = n;
  }
  // The longest run, from its end back.
  const pairs = new Map<number, number>();
  for (let n = ends.at(-1) ?? -1; n >= 0; n = back[n] ?? -1) {
    const pair = both[n];
    if (pair) pairs.set(pair.j, pair.i);
  }
  return pairs;
}

/** Whether a field of `before`'s is missing from `after`, which a change of fields cannot say. */
const lostField = (before: Row, after: Row): boolean => Object.keys(before).some((key) => !Object.hasOwn(after, key));

/** The fields of `after` that are new or changed since `before`, with its id; null when none are. */
function changedFields(before: Row, after: Row): Row | null {
  const fields = Object.entries(after).filter(([key, value]) => before[key] !== value);
  return fields.length === 0 ? null : { ...Object.fromEntries(fields), id: after.id };
}

/** How `before` became `after`, or undefined when it is the same list. */
export function listChange(before: readonly Row[], after: readonly Row[]): ListChange | undefined {
  const pairs = kept(before, after);
  const stays = new Set(pairs.values());
  const drop = before.filter((_, i) => !stays.has(i)).map((row) => row.id);
  const add: (readonly [number, Row])[] = [];
  const put: Row[] = [];
  for (const [j, row] of after.entries()) {
    const i = pairs.get(j);
    const was = i === undefined ? undefined : before[i];
    if (was === undefined || lostField(was, row)) {
      // New to the list, or changed past what a change of fields can say: dropped, if there, and added.
      if (was !== undefined) drop.push(row.id);
      add.push([j, row]);
      continue;
    }
    const fields = changedFields(was, row);
    if (fields !== null) put.push(fields);
  }
  if (drop.length === 0 && add.length === 0 && put.length === 0) return undefined;
  return {
    ...(drop.length > 0 ? { drop } : {}),
    ...(add.length > 0 ? { add } : {}),
    ...(put.length > 0 ? { put } : {}),
  };
}

/** How `before`'s lists became `after`'s. */
export function aboutChange(before: Who, after: Who): AboutChange {
  const lists: Partial<Record<ListName, ListChange>> = {};
  for (const name of ABOUT_LISTS) {
    const change = listChange(before[name], after[name]);
    if (change) lists[name] = change;
  }
  return { at: after.at, lists };
}

/**
 * A list with a change made to it, or null when the change does not fit it: it drops or changes
 * somebody not there, or adds somebody already there or at a place there is not. Such a change
 * was made from other lists than these, and the page asks for all of them again.
 */
export function applyList(before: readonly Row[], change: ListChange | undefined): Row[] | null {
  if (change === undefined) return [...before];
  const ids = new Set(before.map((row) => row.id));
  const drop = new Set(change.drop ?? []);
  const put = new Map((change.put ?? []).map((row) => [row.id, row]));
  if ([...drop].some((id) => !ids.has(id))) return null;
  if ([...put.keys()].some((id) => !ids.has(id) || drop.has(id))) return null;
  const list: Row[] = [];
  for (const row of before) {
    if (drop.has(row.id)) continue;
    const fields = put.get(row.id);
    list.push(fields === undefined ? row : { ...row, ...fields });
  }
  for (const [at, row] of change.add ?? []) {
    if (!Number.isInteger(at) || at < 0 || at > list.length || list.some((r) => r.id === row.id)) return null;
    list.splice(at, 0, row);
  }
  return list;
}

/** The lists after a change, or null when it does not fit them (`applyList`). */
export function applyAbout(before: Who, change: AboutChange): Who | null {
  const present = applyList(before.present, change.lists.present);
  const resting = applyList(before.resting, change.lists.resting);
  const gone = applyList(before.gone, change.lists.gone);
  return present && resting && gone ? { at: change.at, present, resting, gone } : null;
}

// ---------- reading them ----------

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const plain = (v: unknown): v is string | number | boolean | null =>
  v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));

function readRow(v: unknown): Row | null {
  if (!record(v) || typeof v.id !== "string") return null;
  const fields: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(v)) {
    if (!plain(value)) return null;
    fields[key] = value;
  }
  return { ...fields, id: v.id };
}

function readRows(v: unknown): Row[] | null {
  if (!Array.isArray(v)) return null;
  const rows = v.map(readRow);
  return rows.every((row) => row !== null) ? rows.filter((row) => row !== null) : null;
}

/** Leaf's lists, or null for anything that is not them. */
export function readWho(v: unknown): Who | null {
  if (!record(v) || typeof v.at !== "string") return null;
  const present = readRows(v.present);
  const resting = readRows(v.resting);
  const gone = readRows(v.gone);
  return present && resting && gone ? { at: v.at, present, resting, gone } : null;
}

function readListChange(v: unknown): ListChange | null {
  if (!record(v)) return null;
  const drop = v.drop === undefined ? [] : v.drop;
  const put = v.put === undefined ? [] : readRows(v.put);
  const add = v.add === undefined ? [] : v.add;
  if (!Array.isArray(drop) || !drop.every((id) => typeof id === "string") || put === null) return null;
  if (!Array.isArray(add)) return null;
  const added: [number, Row][] = [];
  for (const each of add) {
    const row = Array.isArray(each) && each.length === 2 ? readRow(each[1]) : null;
    if (row === null || typeof each[0] !== "number") return null;
    added.push([each[0], row]);
  }
  return { drop: drop.filter((id) => typeof id === "string"), add: added, put };
}

/** A change to the lists, or null for anything that is not one. */
export function readAboutChange(v: unknown): AboutChange | null {
  if (!record(v) || typeof v.at !== "string" || !record(v.lists)) return null;
  const lists: Partial<Record<ListName, ListChange>> = {};
  for (const name of ABOUT_LISTS) {
    const each = v.lists[name];
    if (each === undefined) continue;
    const change = readListChange(each);
    if (change === null) return null;
    lists[name] = change;
  }
  return { at: v.at, lists };
}
