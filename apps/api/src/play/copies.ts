/**
 * The copies of states held past their lanes, by key, the one used least lately first, the stored
 * text they come to in all held at or under `most` bytes. A copy is in here or in its lane, never
 * both: one job at a time has it.
 */
export class Copies<C extends { readonly text: string }> {
  readonly #copies = new Map<string, C>();
  #bytes = 0;
  readonly #most: number;
  constructor(most: number) {
    this.#most = most;
  }
  /** Holds a copy, letting go of those used least lately past `most`. */
  put(key: string, copy: C): void {
    this.take(key);
    this.#copies.set(key, copy);
    this.#bytes += copy.text.length;
    for (const [oldest, old] of this.#copies) {
      if (this.#bytes <= this.#most) break;
      this.#copies.delete(oldest);
      this.#bytes -= old.text.length;
    }
  }
  /** The copy held of a state, taken out, or none. */
  take(key: string): C | undefined {
    const copy = this.#copies.get(key);
    if (copy !== undefined) {
      this.#copies.delete(key);
      this.#bytes -= copy.text.length;
    }
    return copy;
  }
  /** How much stored text the copies held come to. */
  get bytes(): number {
    return this.#bytes;
  }
}
