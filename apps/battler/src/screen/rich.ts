/**
 * The words on a card, sorted for colouring: a number (gold, bold), a heal or shield amount (leaf
 * green), the words physical, magic and true (each its own colour), and the plain words between.
 * Nothing here touches the page; `ui/cards.ts` turns the pieces into elements.
 */

export type Tone = "plain" | "number" | "mend" | "physical" | "magic" | "true";
export interface Piece {
  readonly tone: Tone;
  readonly text: string;
}

/** A number as a card writes it: `210`, `1.5s`, `40%`, `2%/s`, `+25`, `5-hex`, `3rd`. */
const NUMBER = /[+-]?\d+(?:\.\d+)?(?:%\/s|%|s\b|rd\b|-hex\b)?/y;
const WORD = /[A-Za-z']+/y;
/** Words after which the next number is an amount of health given back or shielded. */
const MENDS = new Set(["heal", "heals", "shield", "shields"]);
const KINDS: Readonly<Record<string, Tone>> = { physical: "physical", magic: "magic", true: "true" };

/** Sorts a short form into pieces to colour. */
export function pieces(text: string): Piece[] {
  const out: Piece[] = [];
  let plain = "";
  let mendNext = false;
  const flush = (): void => {
    if (plain) out.push({ tone: "plain", text: plain });
    plain = "";
  };
  let at = 0;
  while (at < text.length) {
    NUMBER.lastIndex = at;
    const n = NUMBER.exec(text);
    // A sign or a digit starts a number only where a word does not go on into it.
    const startsWord = at > 0 && /[A-Za-z]/.test(text[at - 1] ?? "");
    if (n && !startsWord && /\d/.test(n[0])) {
      flush();
      out.push({ tone: mendNext ? "mend" : "number", text: n[0] });
      mendNext = false;
      at += n[0].length;
      continue;
    }
    WORD.lastIndex = at;
    const w = WORD.exec(text);
    if (w) {
      const word = w[0];
      const kind = KINDS[word.toLowerCase()];
      if (kind) {
        flush();
        out.push({ tone: kind, text: word });
      } else {
        plain += word;
        if (MENDS.has(word.toLowerCase())) mendNext = true;
      }
      at += word.length;
      continue;
    }
    // A full stop ends what a heal or a shield could still be talking about.
    if (text[at] === ".") mendNext = false;
    plain += text[at] ?? "";
    at++;
  }
  flush();
  return out;
}
