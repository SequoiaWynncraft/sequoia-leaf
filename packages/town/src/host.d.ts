// The rules are type-checked without the page's library or Bun's, so that nothing of either can
// creep in. They lean on one function of the hosts they run in, which Bun and every browser have:
// copying plain data whole.

/** A deep copy of plain data. */
declare function structuredClone<T>(value: T): T;
