/**
 * The moment a page was built: a Bun macro, so that the number is written into what imports it,
 * `import { builtAt } from "@sequoia-leaf/core/build/moment.ts" with { type: "macro" }`. Whatever
 * the device's clock says later, a page knows no moment of its own past this one.
 */
export const builtAt = (): number => Date.now();
