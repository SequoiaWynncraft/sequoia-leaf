/**
 * A table of numbers: the one part that lays out rows with numbers beside them. What a row is about
 * (a thing's picture and name, or words) is at the left and takes the room that is left, its words
 * wrapping; each number has a column, right-aligned, in figures of one width, under the column's
 * name. A column is never narrower than `--col` and always as wide as its widest number, so numbers
 * never run into each other; a column's name wraps in that width and never widens it. So rows line
 * up with each other and with the head, and a column moves only when its widest number gains a figure.
 *
 * Where the numbers leave some row's name too little room for one of its words (wide numbers, or a
 * narrow phone), every name has a line of its own over its numbers instead: the table is `stacked`.
 * Only the page can say whether a word fits, so the table asks it whenever what it shows or its
 * width changes, and lets go of the page once it is taken off it.
 *
 * A table keeps its rows by key between draws: `set` writes a number again only where it differs,
 * moves a row only when the order has changed, and builds what is at a row's left once. So a number
 * that changes every second costs one text, and a press on a row is never lost to a redraw.
 */

import { el } from "@sequoia-leaf/kit/dom.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";

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
  readonly what: HTMLElement;
  readonly note: HTMLElement;
  readonly cells: readonly HTMLElement[];
  on: (() => void) | undefined;
}

/** A row for a line, with a place for each of `count` numbers; with `card`, a card to be pressed where the line is pressed. */
function rowOf(line: Line, count: number, card: boolean): Row {
  const note = el("span", "tbl-note");
  const cells = Array.from({ length: count }, () => el("span", "num"));
  const what = el("span", "tbl-what", {}, line.head(), note);
  const row: Row = {
    el: line.on
      ? el("button", card ? "tbl-row k-card" : "tbl-row", { type: "button" }, what, ...cells)
      : el("div", "tbl-row", {}, what, ...cells),
    what,
    note,
    cells,
    on: line.on,
  };
  row.el.addEventListener("click", () => row.on?.());
  return row;
}

/**
 * Keeps a table stacked exactly while a word of some row's name would run past its room beside the
 * numbers, and gives the check, for when what the table shows has changed. A change of the table's
 * width asks it too, a frame later: stacking changes the table's height, and a size changed while the
 * browser reports sizes is reported again at once, as an error. Once the table is taken off the page
 * the browser reports it once more, and the table lets go then.
 */
function fitting(host: HTMLElement, rows: ReadonlyMap<string, Row>): () => void {
  const fit = (): void => {
    host.classList.remove("stacked");
    const tight = [...rows.values()].some((row) => row.what.scrollWidth > row.what.clientWidth);
    host.classList.toggle("stacked", tight);
  };
  const held = scope();
  let width = 0;
  held.observe(host, "size", () => {
    if (!host.isConnected) {
      held.close();
      return;
    }
    if (host.clientWidth === width) return;
    width = host.clientWidth;
    held.frame(fit);
  });
  return fit;
}

/**
 * A table: `caption` names what the rows are, over their left side; `columns` name each number.
 * `wide` is a column's least width in interface units; `unit` is written small under every column's
 * name ("/min"); with `cards`, each row is a card to be pressed.
 */
export function table(
  caption: string,
  columns: readonly string[],
  opts: { readonly wide?: number; readonly unit?: string; readonly cards?: boolean } = {},
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
  const host = el("div", opts.cards ? "tbl cards" : "tbl", {}, head);
  host.style.setProperty("--cols", String(columns.length));
  if (opts.wide !== undefined) host.style.setProperty("--col", `calc(var(--u) * ${opts.wide})`);
  const rows = new Map<string, Row>();
  const fit = fitting(host, rows);

  return {
    el: host,
    set(lines) {
      const live = new Set<string>();
      let before: Element = head;
      let changed = false;
      for (const line of lines) {
        live.add(line.key);
        let row = rows.get(line.key);
        if (!row) {
          rows.set(line.key, (row = rowOf(line, columns.length, opts.cards === true)));
          changed = true;
        }
        row.on = line.on;
        const note = line.note ?? "";
        if (row.note.textContent !== note) {
          row.note.textContent = note;
          changed = true;
        }
        row.cells.forEach((cell, n) => {
          const said = line.cells[n] ?? "";
          const text = typeof said === "string" ? said : said[0];
          const tone = typeof said === "string" ? "num" : `num ${said[1]}`;
          if (cell.textContent !== text) {
            cell.textContent = text;
            changed = true;
          }
          if (cell.className !== tone) cell.className = tone;
        });
        if (before.nextElementSibling !== row.el) before.after(row.el);
        before = row.el;
      }
      for (const [key, row] of rows) {
        if (live.has(key)) continue;
        row.el.remove();
        rows.delete(key);
        changed = true;
      }
      // Only a table that is shown can be measured; one that is not yet is fitted when it is.
      if (changed && host.clientWidth > 0) fit();
    },
  };
}
