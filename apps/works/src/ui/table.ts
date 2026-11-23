/**
 * A table of numbers: the one part that lays out rows with numbers beside them. What a row is about
 * (a thing's picture and name, or words) is at the left and takes the room there is; each number has
 * a column of one fixed width, right-aligned, in figures of one width, under the column's name. So
 * rows line up with each other and with the head, and nothing moves when a number changes.
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

/**
 * A table: `caption` names what the rows are, over their left side; `columns` name each number.
 * `wide` is a column's width in interface units; with `cards`, each row is a card to be pressed.
 */
export function table(
  caption: string,
  columns: readonly string[],
  opts: { readonly wide?: number; readonly cards?: boolean } = {},
): Table {
  const head = el(
    "div",
    "tbl-head",
    {},
    el("span", "", { text: caption }),
    ...columns.map((name) => el("span", "", { text: name })),
  );
  const host = el("div", opts.cards ? "tbl cards" : "tbl", {}, head);
  host.style.setProperty("--cols", String(columns.length));
  if (opts.wide !== undefined) host.style.setProperty("--col", `calc(var(--u) * ${opts.wide})`);
  const rows = new Map<string, Row>();

  const make = (line: Line): Row => {
    const note = el("span", "tbl-note");
    const cells = columns.map(() => el("span", "num"));
    const what = el("span", "tbl-what", {}, line.head(), note);
    const row: Row = {
      el: line.on
        ? el("button", opts.cards ? "tbl-row k-card" : "tbl-row", { type: "button" }, what, ...cells)
        : el("div", "tbl-row", {}, what, ...cells),
      note,
      cells,
      on: line.on,
    };
    row.el.addEventListener("click", () => row.on?.());
    return row;
  };

  return {
    el: host,
    set(lines) {
      const live = new Set<string>();
      let before: Element = head;
      for (const line of lines) {
        live.add(line.key);
        let row = rows.get(line.key);
        if (!row) rows.set(line.key, (row = make(line)));
        row.on = line.on;
        const note = line.note ?? "";
        if (row.note.textContent !== note) row.note.textContent = note;
        row.cells.forEach((cell, n) => {
          const said = line.cells[n] ?? "";
          const text = typeof said === "string" ? said : said[0];
          const tone = typeof said === "string" ? "num" : `num ${said[1]}`;
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
    },
  };
}
