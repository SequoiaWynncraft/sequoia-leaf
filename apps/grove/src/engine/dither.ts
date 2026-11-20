/** Ordered 4x4 Bayer thresholds in [0, 1), for dithering only where a soft edge helps, as the welcome does. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

export const bayer = (x: number, y: number): number => BAYER[(y & 3) * 4 + (x & 3)] ?? 0.5;
