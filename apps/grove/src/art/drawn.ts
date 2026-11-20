/**
 * Tiles drawn by hand, pixel by pixel: sixteen rows of sixteen letters, each letter a colour from
 * the tile's own key, a dot for a clear pixel. A tile here replaces the texture pack's tile of the
 * same name. A name ending in a number (`grass_top1`) is another drawing of the same thing; the
 * game gives each block one of them by where it stands.
 *
 * `bun review/drawn.ts` checks every tile and writes them to a sheet.
 */
export interface Drawn {
  readonly key: Readonly<Record<string, string>>;
  readonly rows: readonly string[];
}

export const DRAWN: Record<string, Drawn> = {};
