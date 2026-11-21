# The kit

The look and the plumbing every part of the guild's game shares, so the town and the games in it
read as one thing: the Minecraft font, the dusk palette, wooden frames and buttons drawn as pixel
art, the tools for drawing sprites in code, the member's character from their skin, the sounds, and
the one purse.

```html
<link rel="stylesheet" href="../../packages/kit/src/kit.css" />
```

```ts
import { amount, el, icon } from "@sequoia-leaf/kit/dom.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
```

An app that uses it lists `"@sequoia-leaf/kit": "workspace:*"` in its dependencies.
`demo/index.html` shows every piece on one page (`bun build demo/index.html --outdir demo/dist`).

## The look, in short

- **Units.** Everything is sized in `--u`, one art pixel of the interface: two CSS pixels, three on
  a very large window. Write sizes as `calc(var(--u) * n)` and frames and letters stay on whole
  pixels.
- **Letters.** The font is drawn ten pixels to the em, so it is sharp at ten units and soft at
  anything in between. Use `--t-m` (the usual size) for nearly everything, `--t-l` and `--t-xl`
  for titles, `--t-s` for small capital labels, and `--t-d` (class `k-d`) for the second line
  under a name. Avoid other sizes. On a canvas, `text.ts` writes in the same font; wait for
  `fontsReady()` first.
- **Colours.** `palette.ts` holds the ramps, and the stylesheet has the same colours as `--k-…`
  variables. Art is drawn from these and nothing else; light comes from the upper left, and every
  sprite has a one-pixel dark edge.
- **Leaf is green.** Spending Leaf is always the green button (`k-btn leaf`) and Leaf amounts are
  always the pale green, so the precious currency is never spent by surprise.

## The pieces (`src/kit.css`)

| Class                                                                 | What it is                                                           |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `k-panel`, with `k-head` and `k-body`                                 | The big wooden frame; its title sits on a band of roof shingles      |
| `k-plaque`                                                            | A thin wooden edge for small things over the world (purse, dock)     |
| `k-card` (`lit`, `done`)                                              | A row or tile standing up from a panel; also works as a button       |
| `k-slot` (`lit`)                                                      | A hollow that holds one thing; as a button, one of a row to choose   |
| `k-paper`                                                             | A page: letters, notes, anything read like a sheet                   |
| `k-say` (`left`)                                                      | Somebody speaking                                                    |
| `k-tip` (`k-float`)                                                   | What a thing is, shown while pointing at it (`tip.ts` places it)     |
| `k-btn` (`wood`, `plum`, `leaf`, `coral`, `sm`, `icon`, `wide`)       | A button on its lip; gold is the main action                         |
| `k-tabs`                                                              | A row of buttons where one is chosen (`aria-selected="true"`)        |
| `k-i k-i-<name>`                                                      | A pixel icon; `--s` makes it larger by whole steps                   |
| `k-cur` (`leaf`)                                                      | An amount of Leaf or Coins                                           |
| `k-bar` (`leaf`, `coral`)                                             | How far along something is: `<div class="k-bar"><i style="--v:40%">` |
| `k-chip` (`lit`)                                                      | A small tag                                                          |
| `k-toast` (`leaf`, `coral`, `rose`)                                   | A line of news                                                       |
| `k-title`, `k-label`, `k-d`, `k-dim`, `k-over`                        | Words: titles, small labels, second lines, words over the world      |
| `k-scrim`, `k-rise`, `k-row`, `k-col`, `k-wrap`, `k-grow`, `k-scroll` | Laying things out                                                    |

The frames and icons are drawn in `tools/frames.ts` as rows of letters and written into
`src/frames.css` as small pictures (`bun run frames`); add a frame or an icon there.

## The modules (`src/`)

| File         | What it holds                                                                      |
| ------------ | ---------------------------------------------------------------------------------- |
| `palette.ts` | The colour ramps                                                                   |
| `pix.ts`     | Pixel-art tools: rectangles, pictures typed as rows of letters, outlines, ellipses |
| `util.ts`    | Canvases, numbers, repeatable noise                                                |
| `text.ts`    | Words on a canvas in the font                                                      |
| `signs.ts`   | A speech bubble and a key prompt drawn on a canvas, and breaking words into lines  |
| `tip.ts`     | Tips: `tip(el, title, text)` shows one on hover, focus and long press              |
| `skin.ts`    | A walking figure and a face from a block-game skin sheet, or from a made-up look   |
| `sound.ts`   | Small sounds made from tones and hiss; `sfx` is the shared set, one mute for all   |
| `dom.ts`     | `el`, `icon`, `amount` and a few more for building the interface                   |
| `purse.ts`   | Leaf and Coins, shared by every page of the game and kept in step between them     |
| `shell.ts`   | How a game that is a place in the town and the town speak to each other            |

`tools/drive.ts` drives a built page in headless Chromium and takes screenshots; its header says how.
