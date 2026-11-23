/** The tiers, by their number: what each is called. A tier past the last named here has no name yet. */

export interface TierInfo {
  readonly name: string;
}

export const TIERS: readonly TierInfo[] = [
  { name: "The lesson" },
  { name: "The home yard" },
  { name: "The stream" },
  { name: "The Study" },
  { name: "The gate" },
];
