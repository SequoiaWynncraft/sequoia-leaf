/**
 * A table of numbers: the one part that lays out rows with numbers beside them. What a row is about
 * (a thing's picture and name, or words) is at the left and takes the room that is left, its words
 * wrapping, and never narrower than its longest word; each number has a column, right-aligned, in
 * figures of one width, under the column's name. A column is exactly as wide as its widest number,
 * and never narrower than `--col`; a column's name wraps in that width and never widens it. So rows
 * line up with each other and with the head, numbers never run into each other or into a name, and
 * a column moves only when its widest number gains a figure. A table too wide for its place scrolls
 * sideways in it (the page's styles, `.tbl`).
 *
 * A table that may `stack` gives each name a line of its own over its numbers where it is narrow:
 * the page's styles say how narrow, and the table says when its numbers are `long` (a number of
 * `LONG` characters or more), which makes that sooner.
 *
 * A table keeps its rows by key between draws: `set` writes a number again only where it differs,
 * moves a row only when the order has changed, and builds what is at a row's left once. So a number
 * that changes every second costs one text, and a press on a row is never lost to a redraw.
 */

import { el } from "@sequoia-leaf/kit/dom.ts";

/** A number as it is printed, and how it is picked out if it is: `faint` for none, `coral` for what is short. */
export type Cell = string | readonly [text: string, tone: "faint" | "coral" | "gold"];

export interface Line {
  /** What tells this row from the others: a row with the same key is the same row, drawn again. */
  readonly key: string;
  /** What the row is about, built once for the row: a thing's picture and name, or words. */
  readonly head: () => Node | string;
  /** Words under it, in coral: why the row is picked out. */
  readonly note?: string;
  /** Its numbers, one for each column. */
  readonly cells: readonly Cell[];
  /** What a press on the row does: with it, the row is a button. */
  readonly on?: () => void;
}

export interface Table {
  readonly el: HTMLElement;
  /** Shows these rows, in this order. */
  set(lines: readonly Line[]): void;
}

interface Row {
  readonly el: HTMLElement;
  readonly note: HTMLElement;
  readonly cells: readonly HTMLElement[];
  on: (() => void) | undefined;
}

/** How many characters make a number `long`: 5, which is 1,000 and up. */
export const LONG = 5;

/** A row for a line, with a place for each of `count` numbers; with `card`, a card to be pressed where the line is pressed. */
function rowOf(line: Line, count: number, card: boolean): Row {
  const note = el("span", "tbl-note");
  const cells = Array.from({ length: count }, () => el("span", "num"));
  const what = el("span", "tbl-what", {}, line.head(), note);
  const row: Row = {
    el: line.on
      ? el("button", card ? "tbl-row k-card" : "tbl-row", { type: "button" }, what, ...cells)
      : el("div", "tbl-row", {}, what, ...cells),
    note,
    cells,
    on: line.on,
  };
  row.el.addEventListener("click", () => row.on?.());
  return row;
}

/**
 * A table: `caption` names what the rows are, over their left side; `columns` name each number.
 * `wide` is a column's least width in interface units; `unit` is written small under every column's
 * name ("/min"); with `cards`, each row is a card to be pressed; with `stack`, names go over their
 * numbers where the table is narrow.
 */
export function table(
  caption: string,
  columns: readonly string[],
  opts: { readonly wide?: number; readonly unit?: string; readonly cards?: boolean; readonly stack?: boolean } = {},
): Table {
  const head = el(
    "div",
    "tbl-head",
    {},
    el("span", "", { text: caption }),
    ...columns.map((name) =>
      el("span", "", {}, name, opts.unit === undefined ? null : el("span", "tbl-unit", { text: opts.unit })),
    ),
  );
  const host = el("div", `tbl${opts.cards ? " cards" : ""}${opts.stack ? " stack" : ""}`, {}, head);
  host.style.setProperty("--cols", String(columns.length));
  if (opts.wide !== undefined) host.style.setProperty("--col", `calc(var(--u) * ${opts.wide})`);
  const rows = new Map<string, Row>();

  return {
    el: host,
    set(lines) {
      const live = new Set<string>();
      let before: Element = head;
      let longest = 0;
      for (const line of lines) {
        live.add(line.key);
        let row = rows.get(line.key);
        if (!row) rows.set(line.key, (row = rowOf(line, columns.length, opts.cards === true)));
        row.on = line.on;
        const note = line.note ?? "";
        if (row.note.textContent !== note) row.note.textContent = note;
        row.cells.forEach((cell, n) => {
          const said = line.cells[n] ?? "";
          const text = typeof said === "string" ? said : said[0];
          const tone = typeof said === "string" ? "num" : `num ${said[1]}`;
          longest = Math.max(longest, text.length);
          if (cell.textContent !== text) cell.textContent = text;
          if (cell.className !== tone) cell.className = tone;
        });
        if (before.nextElementSibling !== row.el) before.after(row.el);
        before = row.el;
      }
      for (const [key, row] of rows) {
        if (live.has(key)) continue;
        row.el.remove();
        rows.delete(key);
      }
      if (opts.stack) host.classList.toggle("long", longest >= LONG);
    },
  };
}
