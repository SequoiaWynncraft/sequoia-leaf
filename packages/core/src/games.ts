/** The games Leaf plays, by the names Leaf's routes and stores know them by. */
export const GAME_IDS = ["raid", "works", "town", "pulls"] as const;
export type GameId = (typeof GAME_IDS)[number];

/** The game a name stands for, or undefined when it is not one. */
export function gameId(name: string): GameId | undefined {
  return GAME_IDS.find((id) => id === name);
}
