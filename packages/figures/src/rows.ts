/**
 * Pictures typed as rows of letters, kept as text (`figures.txt` here, the raid table's `icons.txt`)
 * so that the code that draws them stays short. A block is a line naming the picture, then its rows,
 * then a blank line; a line starting with `#` says something to whoever reads the file.
 */

/** Every picture in a text of blocks, by the line that names it. */
export function readRows(text: string): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>();
  let rows: string[] | null = null;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "") rows = null;
    else if (t.startsWith("#")) continue;
    else if (rows) rows.push(t);
    else {
      rows = [];
      out.set(t, rows);
    }
  }
  return out;
}
