/**
 * The menus' 16x16 icons, one character per pixel ("1" is the first colour, "." is clear), drawn
 * for Sequoia Grove in the mod's item style. Each renders once to a tiny PNG and is shown with
 * nearest filtering at a whole multiple of the menu's unit.
 */

interface Pattern {
  colours: readonly string[];
  rows: readonly string[];
}

const p = (colours: string, rows: string): Pattern => ({ colours: colours.split(" "), rows: rows.split("/") });

const PATTERNS: Record<string, Pattern> = {
  leaf: p(
    "263b2c 53743b 86aa50 c7dc7c",
    ".........11/......11231/....1223441/...12344321/..12343221/.12343221/.1233221/.122211/11211/11",
  ),
  cone: p(
    "442722 835039 bd7943 efb96c 639354",
    ".......55/......553/.....1211/....143221/...13214321/..143213221/..321432131/.1432132141/.3214321321/.132132121/.12132121/..122211/...1111",
  ),
  glade: p(
    "23392f 395c43 648048 a2ac5c 76432c bd7944",
    "......34/.....3433/....343322/...34333222/....23222/...34333322/..434323222/.33323323222/...33322222/..3333322222/.433232232222/33333322222222/.....655/.....655/....66555",
  ),
  forest: p(
    "2f4937 4e7250 899d61 af794c",
    "..3/..33......3/.3322....33/.3222...3322/333222..3222/..33...333222/.33222..33222/33322223322222/..44.....44",
  ),
  water: p(
    "273742 446977 70a2a6 b7d7c1 bb884b",
    "........111/.......13321/.......12.21/11...1111121/13..14443321/.33133333221/..133333221/...13333221/...12222221/....111111",
  ),
  shears: p(
    "33353c 73808a c9d7cf 9a533a df9960",
    "..3......3/..33....32/...33..32/...23332/....232/....222/...45454/..45.4.54/..44...44",
  ),
  mister: p(
    "364052 587a90 86bbc4 d8e8d0 c59558",
    ".....55555/......15..3/......51....3/.....111......3/....34431/....34321/...3343221/...3333221/...3222221/....11111",
  ),
  spirits: p(
    "382536 925841 bd8657 f5d79c 668352",
    "..111111.11111/..134443134441/..144443144441/..143443143341/..144443144441/..144443144341/..144443144441/..122223122221/..111111111111",
  ),
  shop: p(
    "4b2d30 9d503a d6925a f7d89c 6c906c",
    "...111111111/...344334433/..34433443344/.344334433443/..21......12/..21...55.12/..21..355.12/.133333333331/..2332333322/..21......12",
  ),
  campfire: p(
    "482b31 8c422d d76336 f4a343 ffe296 935e42",
    ".......3/......34/.....344..3/...3.344.33/...34344443/..334454443/..344455443/..344555543/...3345443/..661333166/...2266622/..62222666",
  ),
  lamp: p(
    "49323b 875736 d49c51 f7c86c fff0a7",
    ".....111/....12.21/....11111/...2333332/...2444442/...2455542/...2455542/...2455442/...2333332/....12221",
  ),
  rings: p(
    "452f30 835037 b77b4d dfaa6b",
    "....111111/...13333221/..1344443321/.13433234321/.13434434321/.13432334321/.13344443221/..133333221/...1222221/....11111",
  ),
  frame: p(
    "51354d 976d91 eab96d fce3a2",
    "..43333333334/..32.......23/..32.......23/..32.......23/..32.......23/..43333333334",
  ),
  star: p("8c5634 e9ae4d ffe8a4", ".....3/.....3/....232/...23332/.3333333332/...23332/....232/.....2"),
  bloom: p(
    "514052 a279aa edbad6 f8dd88 779663",
    "....33.33/...3233323/....34443/...3244423/....33.33/......5/....555/.....55",
  ),
  stone: p(
    "393647 656378 9a96a5 bdb6aa",
    "....33333/...4433322/..333322221/..222221111/.....33333/...443332221/..3333222211",
  ),
  flag: p(
    "54382f a3744b 97547c f0c05b",
    "...24/...233333333/...234443333/...23343333/...233333333/...2/...2/...2/...2",
  ),
  heart: p("632e3b da716c f2b198", ".221.221/23222222/22222222/.222222/..2222/...22"),
  goldleaf: p(
    "654727 ad7934 e8b654 ffe7a2",
    ".........11/......11231/....1223441/...12344321/..12343221/.12343221/.1233221/.122211/11211/11",
  ),
  fern: p(
    "1f3322 3c5a32 6f8f45 a8b866",
    ".........11/......11231/....1223441/...12344321/..12343221/.12343221/.1233221/.122211/11211/11",
  ),
  "frame-violet": p(
    "2d1d4a 5e3a9a a082dc d4c2f4",
    "..43333333334/..32.......23/..32.......23/..32.......23/..32.......23/..43333333334",
  ),
  face0: p(
    "442f36 724d41 d39972 f2c49a 536d68",
    "11112221/12222211/12232321/23344332/34533543/33343333/23322332/12333321",
  ),
  face1: p(
    "493b43 9c6547 a96850 d99869 536c82",
    "22222211/22221221/23332221/34443332/34533543/33343333/23322332/12333321",
  ),
  face2: p(
    "463a49 676078 bd8b7c e5ba9d 607956",
    "11121111/22222212/12322221/23344332/34533543/33343333/23322332/12333321",
  ),
  mushroom: p(
    "3a2020 c4503a f0c8a0 8a5040 efe3cc",
    "...1111.../..122221../.12232221./1222222321/1444444441/...1551.../...1551.../...1551.../....11....",
  ),
  lights: p(
    "3a2e28 f2c044 e77a8a 6fc0b0 a082dc",
    "11............11/..11........11../...2.11111111.4./..222..3..5..444/...2..333555..4./.......3..5.....",
  ),
  pennant: p(
    "5a4232 e2b54c e07a2a fff1c0",
    "1........./1222222.../12223222222/1223432222/12223222../1222222.../1........./1.........",
  ),
  leafle: p("1b1a24 5e9b5a c9a23c 4a4858", "1111.1111.1111/1221.1331.1441/1221.1331.1441/1111.1111.1111"),
  close: p("e0dbe8", "11...11/.11.11./..111../.11.11./11...11"),
};

const SIZE = 16;
const cache = new Map<string, string>();

const widthOf = (rows: readonly string[]): number => Math.max(...rows.map((r) => r.length));

/** A data URL of the named icon, centred on a 16x16 square, or cropped to its own size if `tight`. */
export function iconUrl(name: string, tight = false): string {
  const key = `${name}:${tight ? "t" : "s"}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pattern = PATTERNS[name] ?? PATTERNS["star"];
  if (!pattern) return "";
  const { colours, rows } = pattern;
  const canvas = document.createElement("canvas");
  canvas.width = tight ? widthOf(rows) : SIZE;
  canvas.height = tight ? rows.length : SIZE;
  const g = canvas.getContext("2d");
  if (!g) return "";
  const top = tight ? 0 : Math.floor((SIZE - rows.length) / 2);
  const left = tight ? 0 : Math.max(0, Math.floor((SIZE - widthOf(rows)) / 2));
  rows.forEach((row, y) => {
    row.split("").forEach((ch, x) => {
      const colour = colours[Number(ch) - 1];
      if (ch === "." || !colour) return;
      g.fillStyle = `#${colour}`;
      g.fillRect(left + x, top + y, 1, 1);
    });
  });
  const url = canvas.toDataURL();
  cache.set(key, url);
  return url;
}

/** The icon in a 16x16 square, `scale` whole units per icon pixel. */
export const icon = (name: string, scale = 1): string =>
  `<img class="px" alt="" src="${iconUrl(name)}" style="width:calc(var(--mu) * ${SIZE * scale});height:calc(var(--mu) * ${SIZE * scale})">`;

/** The icon at its own size, one unit per pixel, to sit in a line of text. */
export function glyph(name: string): string {
  const rows = PATTERNS[name]?.rows ?? [];
  return `<img class="px glyph" alt="" src="${iconUrl(name, true)}" style="width:calc(var(--mu) * ${widthOf(rows)});height:calc(var(--mu) * ${rows.length})">`;
}
