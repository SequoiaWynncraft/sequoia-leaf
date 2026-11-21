/**
 * The small things, each written out by hand as rows of letters (see `INK` for the colours):
 * pets, crabs, the post box, decorations, and the little marks that float over heads.
 */
import { flip, type Spr, sprite } from "./gfx.ts";

// ---------- glorps (the round ones) ----------

const GLORP = [
  "....EEEE....",
  "..EECCCCEE..",
  ".ECFFCCCCCE.",
  ".ECFCCCCCCE.",
  "ECCCCCCCCCCE",
  "ECCBCCCCBCCE",
  "ECCBCCCCBCCE",
  "ECMCCBBCCMCE",
  ".ECCCCCCCCE.",
  "..EEEEEEEE..",
];
const GLORP_SQUASH = [
  "...EEEEEEEE...",
  ".EECFFCCCCCEE.",
  "ECCFCCCCCCCCCE",
  "ECCBCCCCCCBCCE",
  "ECMBCCCCCCBMCE",
  "ECCCCCBBCCCCCE",
  ".ECCCCCCCCCCE.",
  "..EEEEEEEEEE..",
];
const GLORP_STRETCH = [
  "...EEEE...",
  "..ECCCCE..",
  ".ECFFCCCE.",
  ".ECFCCCCE.",
  ".ECCCCCCE.",
  "ECCBCCBCCE",
  "ECCBCCBCCE",
  "ECMCBBCMCE",
  "ECCCCCCCCE",
  ".ECCCCCCE.",
  ".ECCCCCCE.",
  "..EEEEEE..",
];
const GLORP_BLINK = [
  "....EEEE....",
  "..EECCCCEE..",
  ".ECFFCCCCCE.",
  ".ECFCCCCCCE.",
  "ECCCCCCCCCCE",
  "ECCCCCCCCCCE",
  "ECBBCCCCBBCE",
  "ECMCCBBCCMCE",
  ".ECCCCCCCCE.",
  "..EEEEEEEE..",
];

export type GlorpHue = "blue" | "pink" | "green" | "gold" | "plum";
const HUES: Record<GlorpHue, Record<string, string>> = {
  blue: {},
  pink: { C: "#e67fb0", E: "#b84d84", F: "#f7b6d2", M: "#e67967" },
  green: { C: "#62a658", E: "#3b7340", F: "#a8e89a", M: "#f5b95e" },
  gold: { C: "#f5b95e", E: "#d49045", F: "#fff3cf", M: "#e67967" },
  plum: { C: "#9a55b0", E: "#5a296e", F: "#d39be0", M: "#e67fb0" },
};
export interface GlorpSet {
  idle: Spr;
  blink: Spr;
  squash: Spr;
  stretch: Spr;
}
const glorps = new Map<GlorpHue, GlorpSet>();
export function glorp(hue: GlorpHue): GlorpSet {
  let set = glorps.get(hue);
  if (!set) {
    const swap = HUES[hue];
    set = {
      idle: sprite(GLORP, swap),
      blink: sprite(GLORP_BLINK, swap),
      squash: sprite(GLORP_SQUASH, swap),
      stretch: sprite(GLORP_STRETCH, swap),
    };
    glorps.set(hue, set);
  }
  return set;
}
/** The little shoot some glorps wear. */
export const SPROUT = sprite(["t...s", "tt.ss", ".tts.", "..q.."], {}, 2, 4);

// ---------- the ginger cat ----------

const CAT_WALK_A = [
  "..........O...O.",
  "..........OO.OO.",
  "Q.........OOOOO.",
  "Q.........OBOBO.",
  "QQ..OOOOOOOOMOO.",
  ".QOOOQOOQOOKKK..",
  "..OOOQOOQOOOK...",
  "..OOOOOOOOOOO...",
  "..OOKKKKKOOO....",
  "..O.O....O.O....",
  "..K.K....K.K....",
];
const CAT_WALK_B = [
  "..........O...O.",
  "Q.........OO.OO.",
  "Q.........OOOOO.",
  "QQ........OBOBO.",
  ".Q..OOOOOOOOMOO.",
  ".QOOOQOOQOOKKK..",
  "..OOOQOOQOOOK...",
  "..OOOOOOOOOOO...",
  "..OOKKKKKOOO....",
  "...OO.....OO....",
  "..K..K...K..K...",
];
const CAT_SIT = [
  ".O.......O.",
  "OOO.....OOO",
  "OMOOOOOOOMO",
  "OOOQOQOQOOO",
  "OOBOOOOOBOO",
  "OOOOKMKOOOO",
  ".OOKKKKKOO.",
  ".OOOKKKOOO.",
  ".OOOKKKOOOQ",
  ".OOOOKOOOQQ",
  ".OKKOOOKKQ.",
];
const CAT_SLEEP = [
  ".O..O........",
  "OOOOOOOOOOO..",
  "OOOOOOOQOQOO.",
  "QOQOOOOQOQOOO",
  "OOMOOOOOOOOOO",
  ".KKOOOOOOOQQQ",
  "..QQQQQQQQQQ.",
];
export const CAT = {
  walkA: sprite(CAT_WALK_A),
  walkB: sprite(CAT_WALK_B),
  sit: sprite(CAT_SIT),
  sleep: sprite(CAT_SLEEP),
};
export const CAT_L = { walkA: flip(CAT.walkA), walkB: flip(CAT.walkB) };

// ---------- the small white fox ----------

const FOX_SIT = [
  "....j..j........",
  "...jj.jj........",
  "...jMjMj........",
  "..jjjjjj........",
  ".jjBjjjj........",
  "Bjjjjjjj.....jj.",
  ".KKjjjjj....jjjj",
  "...jjjjjj..jjjjj",
  "...jjjjjjj.jjjjj",
  "...Kjjjjjjjjjjj.",
  "...KjKjjjjjjjK..",
  "...jjKjjjKKKK...",
  "...jj.jj........",
];
const FOX_WALK_A = [
  ".j..j............",
  ".jj.jj...........",
  ".jjjjj.........jj",
  "jjBjjj.......jjjj",
  "Bjjjjjjjjjjjjjjjj",
  ".KjjjjjjjjjjjKjj.",
  "...KjjjjjjjjK....",
  "...jjKKKKKjj.....",
  "...j.j....j.j....",
  "...K.K....K.K....",
];
const FOX_WALK_B = [
  ".j..j............",
  ".jj.jj.........jj",
  ".jjjjj.......jjjj",
  "jjBjjj......jjjj.",
  "Bjjjjjjjjjjjjjj..",
  ".Kjjjjjjjjjjj....",
  "...KjjjjjjjjK....",
  "...jjKKKKKjj.....",
  "....jj.....jj....",
  "...K..K...K..K...",
];
export const FOX = {
  sit: sprite(FOX_SIT),
  walkA: sprite(FOX_WALK_A),
  walkB: sprite(FOX_WALK_B),
};
export const FOX_R = { sit: flip(FOX.sit), walkA: flip(FOX.walkA), walkB: flip(FOX.walkB) };

// ---------- crabs ----------

const CRAB_A = ["f..B.B..f", "ff.f.f.ff", ".fffffff.", ".fffffff.", "..eeeee..", ".f.f.f.f."];
const CRAB_B = ["...B.B...", "ff.f.f.ff", "fffffffff", ".fffffff.", "..eeeee..", "f.f...f.f"];
const CRAB_UP = ["ff.B.B.ff", "ff.f.f.ff", ".fffffff.", ".fffffff.", "..eeeee..", ".f.f.f.f."];
const CRAB_PEEK = ["f..B.B..f", "ff.f.f.ff", ".fffffff."];
export const CRAB = {
  a: sprite(CRAB_A),
  b: sprite(CRAB_B),
  up: sprite(CRAB_UP),
  peek: sprite(CRAB_PEEK),
};

// ---------- the post box ----------

const MAILBOX = [
  "...DDDDDDDD...",
  "..DRRRRRRRRD..",
  ".DRRRRRRRRRRD.",
  ".DRRRRRRRRRRD.",
  ".DRRjjjjjjRRD.",
  ".DRRjLjjLjRRD.",
  ".DRRjjLLjjRRD.",
  ".DRRjjjjjjRRD.",
  ".DRRRRRRRRRRD.",
  ".DDDDDDDDDDDD.",
  "..kkkkkkkkkk..",
  "......mn......",
  "......mn......",
  "......mn......",
  "......mn......",
  "......mn......",
  "......mn......",
  "......mn......",
  "......mn......",
  "......mn......",
  "......mn......",
  "......mn......",
  ".....kmnk.....",
];
const MAILBOX_OPEN = [
  "...DDDDDDDD...",
  "..DRRRRRRRRD..",
  ".DRRRRRRRRRRD.",
  ".DRBBBBBBBBRD.",
  ".DRBBjjjjBBRD.",
  ".DRBjjLLjjBRD.",
  ".DRBjjjjjjBRD.",
  ".DRBBBBBBBBRD.",
  ".DDDDDDDDDDDD.",
  "..DRRRRRRRRD..",
  "..kDDDDDDDDk..",
  "......mn......",
  "......mn......",
  "......mn......",
  "......mn......",
  "......mn......",
  "......mn......",
  "......mn......",
  "......mn......",
  "......mn......",
  "......mn......",
  "......mn......",
  ".....kmnk.....",
];
export const MAIL = {
  shut: sprite(MAILBOX),
  open: sprite(MAILBOX_OPEN),
  flagUp: sprite(["ggg.", "gig.", "ggg.", "..h.", "..h.", "..h."], {}, 0, 6),
  flagDown: sprite(["hhhgg", "...gg"], {}, 0, 2),
};

// ---------- things to place ----------

export const GNOME = sprite([
  "...R....",
  "...RR...",
  "..RRRD..",
  "..RRRD..",
  ".RRRRRD.",
  ".RRRRRD.",
  ".KBKKBK.",
  ".jjMMjj.",
  ".jjjjjj.",
  "EjjjjjjE",
  "ECjjjjCE",
  ".CCEECC.",
  ".kk..kk.",
]);
export const POT = sprite([
  "..N.....",
  ".NgN..N.",
  "..N..NgN",
  "..s...N.",
  ".ssr.rs.",
  "..srrs..",
  "oooooooo",
  "nnnnnnnm",
  ".onnnnm.",
  ".onnnnm.",
  "..nnnm..",
]);
export const FERN = sprite([
  "....s....",
  ".s..s..s.",
  ".ss.r.ss.",
  "s.srrrs.s",
  "ss.rrr.ss",
  ".ssrqrss.",
  "..srqrs..",
  ".ooooooo.",
  ".nnnnnnm.",
  "..onnnm..",
  "..onnnm..",
  "...nnm...",
]);
export const LAMP = sprite(
  [
    ".mmmmmm.",
    ".mn...k.",
    ".mn..kkk",
    ".mn..gig",
    ".mn..iji",
    ".mn..gig",
    ".mn..kkk",
    ".mn.....",
    ".mn.....",
    ".mn.....",
    ".mn.....",
    ".mn.....",
    ".mn.....",
    ".mn.....",
    ".mn.....",
    ".mn.....",
    ".mn.....",
    ".mn.....",
    ".mn.....",
    ".mn.....",
    ".mn.....",
    ".mn.....",
    ".mn.....",
    "kmnk....",
  ],
  {},
  2,
  24,
);
export const STUMP = sprite([
  "..wwwwwww..",
  ".wwvvvvvww.",
  "wwvwwwwwvww",
  "owwvvvvvwwo",
  "moowwwwwoom",
  "mnmooooommk",
  "mnmmnmmnmmk",
  "mnmmnmmnmmk",
  ".kmmkmmkmk.",
]);
export const SHROOM = sprite([
  "..RRR.....",
  ".RRjRR....",
  "RjRRRRR...",
  "RRRRRjR.RR",
  ".DKKKD.RjRR",
  "...K...DKKD",
  "..KK....K..",
]);
export const CRAB_STATUE = sprite([
  "z..x.x..z",
  "zz.z.z.zz",
  ".zAAAzzz.",
  ".zzzzzzy.",
  "..yyyyy..",
  ".AAAAAAA.",
  ".zzzzzzy.",
  ".zzzzzzy.",
  "AAAAAAAAA",
  "yzzzzzzzy",
]);
export const FLAG = sprite(
  [
    "m........",
    "meeeeee..",
    "meegeeee.",
    "megggeee.",
    "meegeee..",
    "meeeee...",
    "mee......",
    "m........",
    "m........",
    "m........",
    "m........",
    "m........",
    "m........",
    "m........",
    "m........",
    "k........",
  ],
  {},
  0,
  16,
);
export const GIFT = sprite([
  "..g..g..",
  "...gg...",
  "dddggddd",
  "cccggccc",
  "cccggccc",
  "gggggggg",
  "cccggccc",
  "cccggccc",
]);
export const CRATE = sprite([
  ".wwwwwwwwww.",
  "wovvvvvvvvow",
  "wvovvvvvvovw",
  "wvvovvttovvw",
  "wvvvotttvvvw",
  "wvvvtttovvvw",
  "wvvottvvovvw",
  "wvovvvvvvovw",
  "wovvvvvvvvow",
  "uwwwwwwwwwwu",
  ".uuuuuuuuuu.",
]);
export const CHUTE = sprite([
  "...jjjjj...",
  ".jjKjjjKjj.",
  "jjKjjjjjKjj",
  "jKjjjjjjjKj",
  "j.j..j..j.j",
  ".L..L.L..L.",
  "..L.L.L.L..",
  "...LLLLL...",
]);
export const SKY_LANTERN = sprite([
  ".hgggh.",
  "hgiiigh",
  "giijiig",
  "giijiig",
  "giiiiig",
  "hgiiigh",
  ".hgggh.",
  "..k.k..",
  "..hhh..",
]);

// ---------- marks over heads, and what flies about ----------

export const HEART = sprite([".MM.MM.", "MNMMMMM", "MMMMMMM", ".MMMMM.", "..MMM..", "...M..."]);
export const NOTE = sprite(["..jj.", "..j.j", "..j..", "..j..", "jjj..", "jjj.."]);
export const ZED = sprite(["jjjj", "..j.", ".j..", "jjjj"]);
export const BANG = sprite([
  ".ggggg.",
  "ggBBBgg",
  "ggBBBgg",
  "gggBggg",
  "ggggggg",
  "gggBggg",
  ".ggggg.",
  "..ggg..",
  "...g...",
]);
export const STAR = sprite(["..j..", "..j..", "jjijj", "..j..", "..j.."], {}, 2, 2);
export const STAR_S = sprite([".j.", "jij", ".j."], {}, 1, 1);
export const LEAF = sprite([
  "......qqq",
  "....qqtGq",
  "..qqttGtq",
  ".qtttGttq",
  ".qttGtttq",
  "qttGtttq.",
  "qtGttqq..",
  "qGqqq....",
  "q........",
]);
export const LEAF_S = sprite(["..qq", ".tGq", "tGt.", "qt.."], {}, 2, 2);
export const COIN = sprite([
  "..hhhh..",
  ".hiiggh.",
  "hiigghgh",
  "higghggh",
  "hgghgggh",
  "hghggghh",
  ".hggghh.",
  "..hhhh..",
]);
export const COIN_S = sprite([".gg.", "giih", "gihh", ".hh."], {}, 2, 2);
export const MARSH = sprite(["jjj", "jKj", "jjj", ".n.", ".n.", ".n."], {}, 1, 6);

// ---------- pictures for buttons ----------

export const ICON = {
  hammer: sprite([
    "..yyyyyy.",
    ".yAAAAAAy",
    ".yzzzzzzy",
    "..yyonyy.",
    "....on...",
    "....on...",
    "....on...",
    "....on...",
    "....mm...",
  ]),
  sound: sprite([
    "....jj....",
    "...jjj..j.",
    "jjjjjj...j",
    "jjjjjj.j.j",
    "jjjjjj.j.j",
    "jjjjjj...j",
    "...jjj..j.",
    "....jj....",
  ]),
  mute: sprite([
    "....jj....",
    "...jjj....",
    "jjjjjj.f.f",
    "jjjjjj..f.",
    "jjjjjj.f.f",
    "jjjjjj....",
    "...jjj....",
    "....jj....",
  ]),
  mail: sprite(["jjjjjjjjj", "jLjjjjjLj", "jjLjjjLjj", "jjjLLLjjj", "jjjjjjjjj", "jjjjjjjjj"]),
  quest: sprite(["jjjjjjj", "jLLLLLj", "jjjjjjj", "jLLLLjj", "jjjjjjj", "jLLLjjj", "jjjjjjj", "jjjjjj.", "jjjjj.."]),
  fire: sprite([
    "...f....",
    "..ff.f..",
    "..fgff..",
    ".ffggf..",
    ".fgigff.",
    "ffgiigf.",
    "fgijigf.",
    ".fgiigf.",
    "..fggf..",
  ]),
  cup: sprite(["hgggggh", "hgiiggh", ".giigg.", ".ggggg.", "..ggg..", "...g...", "...g...", "..ggg..", ".hhhhh."]),
  crab: CRAB.up,
  gear: sprite([
    "..h.h.h..",
    ".hhhhhhh.",
    "hhgggggh.",
    ".hgg.ggh.",
    "hhg...ghh",
    ".hgg.ggh.",
    "hhgggggh.",
    ".hhhhhhh.",
    "..h.h.h..",
  ]),
  tent: sprite([
    "....j....",
    "...jKj...",
    "...jKj...",
    "..jjKjj..",
    "..jKBKj..",
    ".jjKBKjj.",
    ".jKBBBKj.",
    "jjKBBBKjj",
  ]),
  scale: sprite([
    "....g....",
    ".ggggggg.",
    ".g..g..g.",
    "ggg.g.ggg",
    "hhh.g.hhh",
    "....g....",
    "....g....",
    "..ggggg..",
  ]),
  home: sprite([
    "....e....",
    "...eee...",
    "..eeeee..",
    ".eeeeeee.",
    ".nnnnnnn.",
    ".nniinmn.",
    ".nniinmn.",
    ".nnnnnmn.",
  ]),
};

/** Every hand-written sprite with a name, for the review sheet. */
export const SHEET: [string, Spr][] = [
  ["glorp", glorp("blue").idle],
  ["blink", glorp("blue").blink],
  ["squash", glorp("pink").squash],
  ["stretch", glorp("green").stretch],
  ["gold", glorp("gold").idle],
  ["plum", glorp("plum").idle],
  ["sprout", SPROUT],
  ["catA", CAT.walkA],
  ["catB", CAT.walkB],
  ["catSit", CAT.sit],
  ["catZ", CAT.sleep],
  ["foxSit", FOX.sit],
  ["foxA", FOX.walkA],
  ["foxB", FOX.walkB],
  ["crabA", CRAB.a],
  ["crabB", CRAB.b],
  ["crabUp", CRAB.up],
  ["peek", CRAB.peek],
  ["mail", MAIL.shut],
  ["open", MAIL.open],
  ["flagUp", MAIL.flagUp],
  ["gnome", GNOME],
  ["pot", POT],
  ["fern", FERN],
  ["lamp", LAMP],
  ["stump", STUMP],
  ["shroom", SHROOM],
  ["statue", CRAB_STATUE],
  ["flag", FLAG],
  ["gift", GIFT],
  ["crate", CRATE],
  ["chute", CHUTE],
  ["lantern", SKY_LANTERN],
  ["heart", HEART],
  ["note", NOTE],
  ["zed", ZED],
  ["bang", BANG],
  ["star", STAR],
  ["leaf", LEAF],
  ["leafS", LEAF_S],
  ["coin", COIN],
  ["coinS", COIN_S],
  ["marsh", MARSH],
  ["hammer", ICON.hammer],
  ["sound", ICON.sound],
  ["mute", ICON.mute],
  ["mailI", ICON.mail],
  ["quest", ICON.quest],
  ["fire", ICON.fire],
  ["cup", ICON.cup],
  ["gear", ICON.gear],
  ["tent", ICON.tent],
  ["scale", ICON.scale],
  ["home", ICON.home],
];
