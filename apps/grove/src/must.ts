/** The value, or an error naming what's missing: for things the page itself guarantees, such as its root element. */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${what}`);
  }
  return value;
}
