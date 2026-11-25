/**
 * How every number a player reads is said, in one place: on the pages (through the kit's `say.ts`,
 * which adds a rate drawn), in the rules' sentences, and in what Leaf writes to Discord. No other
 * file formats a number for a player (`leaf/said-number` in the kit's lint rules).
 *
 * - `whole`: a count, a price, Coins or Leaf: "22,506".
 * - `num`: a quantity that may be fractional: whole from 10 up and to a tenth below: "50", "1.2", "0.6".
 * - `exact`: a value that must not be rounded to a tenth, to the thousandth: what the depot pays
 *   for one thing ("0.12"), a rule's rate ("0.5"), a chance in percent ("5.952").
 * - `perMinute`: a rate, always "<num> /min": "50 /min", "20 deadfall /min", "6–12 /min".
 * - `coinsText`: "1 Coin", "250 Coins".
 * - `duration`: a time played: "42 min", "3 h 20 min".
 *
 * Each rounds half away from zero and never says "-0".
 */

const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const THOUSANDTHS = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/** `v` rounded to `places` decimals, half away from zero, with no negative zero. */
const rounded = (v: number, places: number): number => {
  const by = 10 ** places;
  return (Math.sign(v) * Math.round(Math.abs(v) * by)) / by + 0;
};

/** A count, a price, Coins or Leaf, whole and with its thousands: "22,506". */
export const whole = (v: number): string => WHOLE.format(rounded(v, 0));

/** A quantity that may be fractional: whole from 10 up, and to a tenth below unless that is whole: "50", "1.2", "0.6", "2". */
export function num(v: number): string {
  const tenth = rounded(v, 1);
  return Math.abs(tenth) >= 10 || Number.isInteger(tenth) ? whole(tenth) : tenth.toFixed(1);
}

/** A value that must not be rounded to a tenth, to the thousandth and with its thousands: "0.12", "0.5", "1,200". */
export const exact = (v: number): string => THOUSANDTHS.format(rounded(v, 3));

/** What a rate is counted in: so many a minute. A table writes it once, under its columns. */
export const PER_MINUTE = "/min";

/**
 * A rate: so many, of `of` where it names what, a minute: "50 /min", "20 deadfall /min". A range
 * from the least to the most says both, unless they come out the same: "6–12 /min".
 */
export function perMinute(v: number | readonly [number, number], of = ""): string {
  const [lo, hi] = typeof v === "number" ? [num(v), num(v)] : [num(v[0]), num(v[1])];
  return `${lo === hi ? lo : `${lo}–${hi}`}${of === "" ? "" : ` ${of}`} ${PER_MINUTE}`;
}

/** So many Coins: "1 Coin", "250 Coins". */
export const coinsText = (v: number): string => (rounded(v, 0) === 1 ? "1 Coin" : `${whole(v)} Coins`);

/** A time played: "under 1 min", "42 min", "3 h 20 min" ("3 h" on the hour), and from 100 hours "132 h". */
export function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (minutes < 1) return "under 1 min";
  if (hours < 1) return `${minutes} min`;
  if (hours >= 100 || minutes % 60 === 0) return `${whole(hours)} h`;
  return `${hours} h ${minutes % 60} min`;
}
