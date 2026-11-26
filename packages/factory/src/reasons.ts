/** Why the Coins of each change a command makes move, as the ledger says (`commands.ts`, `history.ts`). */
export const REASON = {
  till: "Earned in the Works",
  build: "Built in the Works",
  lay: "Belts laid in the Works",
  remove: "Taken away in the Works",
  lower: "Lowered in the Works",
  upgrade: "Upgraded in the Works",
  buyPlot: "A plot for the Works",
  fell: "Felled in the Works",
  undo: "Undone in the Works",
} as const;
