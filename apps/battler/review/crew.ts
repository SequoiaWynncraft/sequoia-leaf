/**
 * Skins for the review's Commodore and the grooters he calls (`standin.ts`), drawn by code as the
 * mage's is (`mage.ts`): pictures stay out of the repository, and nobody real is drawn. One plain
 * person, a sheet laid out as a real skin is, in each one's colours: hair, skin, a coat or shirt
 * with its trim, trousers, boots.
 */
import { bitmap } from "@sequoia-leaf/kit/pix.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

/** One person's colours: hair (and its shade), skin, eyes, coat (and its shade), trim, trousers, boots. */
export interface Crew {
  readonly H: string;
  readonly h: string;
  readonly S: string;
  readonly E: string;
  readonly C: string;
  readonly c: string;
  readonly T: string;
  readonly P: string;
  readonly B: string;
}

const FACE = ["HHHHHHHH", "HHHHHHHH", "HSSSSSSH", "SEWSSWES", "SSSSSSSS", "SSShhSSS", "SSSSSSSS", "SSSSSSSS"];
const SIDE_HEAD = ["HHHHHHHH", "HHHHHHHH", "HHHHHHSS", "HHHHHSSS", "HHHHSSSS", "HHHSSSSS", "HHHSSSSS", "HHSSSSSS"];
const BACK_HEAD = ["HHHHHHHH", "HHHHHHHH", "HHHHHHHH", "HHHHHHHH", "HHHHHHHH", "HHHHHHHH", "hHHHHHHh", "hhhhhhhh"];
const BODY = [
  "CCCTTCCC",
  "CCCTTCCC",
  "CCcTTcCC",
  "CCCTTCCC",
  "CCcTTcCC",
  "CCCTTCCC",
  "CCcTTcCC",
  "CCCTTCCC",
  "TTTTTTTT",
  "CCCCCCCC",
  "cCCCCCCc",
  "cCCCCCCc",
];
const FLANK = ["CCCC", "CCCC", "CCCC", "CCCC", "CCCC", "CCCC", "CCCC", "CCCC", "TTTT", "CCCC", "cCCc", "cCCc"];
const ARM = ["CCCC", "CCCC", "CCCC", "CCCC", "CCCC", "CCCC", "CCCC", "cCCc", "TTTT", "SSSS", "SSSS", "SSSS"];
const LEG = ["PPPP", "PPPP", "PPPP", "PPPP", "PPPP", "PPPP", "PPPP", "PPPP", "BBBB", "BBBB", "BBBB", "BBBB"];

/** A whole skin sheet in a person's colours, laid out as a real one is: the head's faces, the body's, an arm and a leg. */
export function crewSheet(inks: Crew): HTMLCanvasElement {
  const pal = { ...inks, W: "#ffffff" };
  const { c, g } = makeCanvas(64, 64);
  const put = (rows: readonly string[], x: number, y: number, mirrored = false): void => {
    g.drawImage(bitmap(mirrored ? rows.map((r) => r.split("").toReversed().join("")) : rows, pal), x, y);
  };
  put(BACK_HEAD, 8, 0);
  put(SIDE_HEAD, 0, 8);
  put(FACE, 8, 8);
  put(SIDE_HEAD, 16, 8, true);
  put(BACK_HEAD, 24, 8);
  put(FLANK, 16, 20);
  put(BODY, 20, 20);
  put(FLANK, 28, 20);
  put(BODY, 32, 20);
  for (let x = 40; x < 56; x += 4) put(ARM, x, 20);
  for (let x = 0; x < 16; x += 4) put(LEG, x, 20);
  return c;
}

/** The review's Commodore: a navy coat with gold trim, white hair. Made up. */
export const COMMODORE: Crew = {
  H: "#e8e4dc",
  h: "#b9b3a8",
  S: "#d9a27a",
  E: "#2a3a66",
  C: "#1f2f5c",
  c: "#16213f",
  T: "#e0b443",
  P: "#ece6d6",
  B: "#2b1a12",
};
/** The four grooters, each a made-up adventurer of their own colours, with a made-up name. */
export const GROOTERS: readonly (readonly [name: string, inks: Crew])[] = [
  [
    "Fernwhistle",
    {
      H: "#6b3d1f",
      h: "#4a2a14",
      S: "#f0c39a",
      E: "#2e5a2a",
      C: "#4f7a3a",
      c: "#3a5c2a",
      T: "#c9a46a",
      P: "#5a4632",
      B: "#3a2616",
    },
  ],
  [
    "Nettlebark",
    {
      H: "#1e1a1a",
      h: "#0f0d0d",
      S: "#a86b45",
      E: "#2a1a10",
      C: "#8a3b2e",
      c: "#6a2b20",
      T: "#d8c39a",
      P: "#3a3a46",
      B: "#1a1a1a",
    },
  ],
  [
    "Mossrunner",
    {
      H: "#d9b15a",
      h: "#b08a3a",
      S: "#f2cfa8",
      E: "#3a5a8a",
      C: "#3a6a7a",
      c: "#2a4e5a",
      T: "#e8e0c8",
      P: "#6a5a3a",
      B: "#4a3020",
    },
  ],
  [
    "Shellwise",
    {
      H: "#a33b2b",
      h: "#7a2a1e",
      S: "#e8b48c",
      E: "#3a2a5a",
      C: "#5a4a7a",
      c: "#433660",
      T: "#c9c3d6",
      P: "#2e2a3a",
      B: "#2a1e18",
    },
  ],
];
