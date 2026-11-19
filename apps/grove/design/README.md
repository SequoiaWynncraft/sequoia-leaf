# Sequoia Grove

A cozy game about growing a Sequoia. Your tree grows as you raid and war with
the guild. You tend it whenever you like, fill its little grove with things
from the shop, crack sequoia cones by the fire to find forest Sprites, and bring
it into Discord calls to show your friends. Together the guild grows the Great
Sequoia.

This is the plan as of 19 November 2026: what the game is, how it plays, what it
costs, where it lives and the order to build it in. The pictures are real
screens from the prototype in `apps/grove` (run `bun apps/grove/index.html` and
open a screen by its hash: `#grove`, `#welcome`, `#care`, `#shop`, `#cone`,
`#reveal`, `#book`, `#activity`, `#leafle`, `#great`).

![Your grove at golden hour](grove.webp)

## What it should feel like

1. **Cozy, never punishing.** No streaks. Nothing wilts or dies. Care banks up
   while you're away, so coming back after a week is a treat, not a debt.
2. **Earned in Wynncraft, spent in the Grove.** Leaf from guild play is the only
   currency. Nothing is sold for money, and nothing costs the guild real items:
   everything Leaf buys here is made of pixels.
3. **Unmistakably Sequoia.** The guild's ranks are the rarities. Raids hatch
   critters. The guild's own art, places and jokes are everywhere.
4. **Made to be seen.** Visit friends' groves, put your favourite Sprite by your
   nametag and on your Discord profile, and grow the guild's tree together.
5. **Every reward is a moment.** Cones open by the fire with light and sound.
   Rare finds get the whole call watching.

## Storyboard

### 1. A seed arrives

![Conelet welcomes you and your seed](welcome.webp)

The first visit plants your seed in its pot. Conelet, a cone that never quite
opened, explains the one thing to know: everything you play with the guild
helps it grow.

### 2. Tend it whenever

![Watering the tree](care.webp)

Each UTC day gives two care charges, and unused ones bank up to six. Watering,
pruning or misting spends a charge and adds a point of Bloom. Seven Bloom drops
a free cone. Friends can water your tree too, and so can solving the daily
puzzle. A day you miss costs you nothing; your charges are waiting.

### 3. It grows as you play

![Sprout, sapling, young and old sequoia](growth.webp)

The tree's size follows your SEQ level, which comes from the XP you earn
raiding, warring and finishing quests. It can't be bought, so your tree is a
picture of your time with the guild. The stages:

| Stage       | SEQ level | Who's there today          |
| ----------- | --------- | -------------------------- |
| Sprout      | 1         | about half the guild       |
| Sapling     | 2–3       |                            |
| Young       | 4–5       | the 90th percentile is 5   |
| Old sequoia | 6–8       |                            |
| Ancient     | 9–12      | the top player is level 10 |
| Giant       | 13+       | nobody yet                 |

Old, Ancient and Giant still need their own drawings; the prototype's biggest
tree stands in for them.

### 4. Make the grove yours

![Fennel's Wandering Stall](shop.webp)

Fennel, a travelling fox merchant, brings a stall of four things every
morning: the same stall for everyone, so it's something to talk about. Fennel
holds an item for you for three days. Behind the stall is the full catalogue:
pots, stands, tree styles, lights, ground cover and homes for your Sprites.
Seasonal styles, like the autumn canopy, come and go with the seasons.

![The same tree in autumn](seasons.webp)

### 5. Crack a cone by the fire

![The cone warming](cone.webp)
![A Glimmerwing steps out](reveal.webp)

Real sequoia cones stay shut for decades and only open in the heat of a fire.
That's how they open here: you set a cone by the campfire, it warms and shakes,
the scales part, and a Sprite steps out. Each Sprite's rarity is a guild rank
from Leafkin up to Yggdrasil, and the rank's colour lights up the opening.

### 6. Fill the Sprite Book

![The Sprite Book](book.webp)

Sprites you haven't found are dark shapes in the book. Finding one again
deepens your bond with it:

| Bond  | What it gives                                           |
| ----- | ------------------------------------------------------- |
| ♥     | It lives in your grove                                  |
| ♥♥    | A shiny coat you can switch on                          |
| ♥♥♥   | It can sit by your nametag in game (Sequoia mod)        |
| ♥♥♥♥♥ | Its Discord role icon, for Treant and Yggdrasil Sprites |

Past five hearts, a duplicate turns into two Bloom.

![The first Sprites](cast.webp)

### 7. Bring your tree to the call

![A gathering in a voice channel](activity.webp)

Launched from a Discord voice channel, Sequoia Grove opens as an Activity:
everyone in the call brings their tree to one clearing. When someone warms a
cone, everybody watches it open together. That's the cone party, and it's the
reason to play inside Discord at all.

### 8. A puzzle a day, together

![Leafle](leafle.webp)

Leafle is a five-letter Wynncraft word a day: provinces, towns, raids,
bosses, guild words. Play it alone on the site or together in a call, where
everyone's result shows once they've solved it. Solving it gives a point of
Bloom. There's no streak counter.

### 9. Grow the Great Sequoia

![The Great Sequoia on the website](great.webp)

The guild's own tree lives on the website. Every week it has goals drawn from
real guild play (raids, wars won, trees watered), and members who help hang a
light in it. When it blooms, everyone in the guild gets that season's gift for
their grove.

## The design decisions

These are the calls I've made as lead designer, with the reason for each.

- **The website is home; Discord is for being together.** An Activity runs
  well, but it's a panel inside a chat: small, sometimes picture-in-picture,
  often on a phone. So the full game lives on the web, and the Activity does
  the things that are better in a call: gatherings, cone parties and Leafle.
  Both run the same client.
- **Growth can't be bought.** The tree's size comes from SEQ level. Leaf buys
  how it looks, never how big it is.
- **Cones hold Sprites; the shop sells everything else.** Anything you want for
  your grove, you can buy outright. Chance is only for the creatures.
- **No streaks, anywhere.** Care banks, Leafle has no streak, and nothing
  expires because you were away. This follows the guild call of 15 November.
- **Rarity is rank.** The seven ranks, in their colours on the website, are the
  rarities everywhere, with the name shown beside the colour so it never
  depends on colour alone.
- **No trading and no real money.** Sprites and items stay with you, which rules
  out selling accounts or items for money. Odds are published in the game.
- **Pixel art in side-on dioramas.** One scene, 240 by 150 pixels, scaled up by
  whole pixels so it stays sharp on any screen.

## Prices that fit how people earn

Since the raid-share correction on 19 November, members net this much Leaf a
day (66 accounts, 16 to 19 November):

| Member          | Leaf a day | A cone at 400 Leaf every… |
| --------------- | ---------- | ------------------------- |
| Median          | 168        | 2.4 days                  |
| 75th percentile | 871        | 11 hours                  |
| 90th percentile | 2,169      | 4.4 hours                 |
| Top earner      | 5,656      | 1.7 hours                 |

One raid credit pays about 170 Leaf, so a cone is a little over two raids. On
top of what they buy, caring for their tree gives everyone up to two free cones
a week. Friends watering it and Leafle add more, up to five Bloom a day, which
is five cones a week at most.

**A cone costs 400 Leaf.** There's no discount for buying many: no bulk
pricing.

**What's in a cone** (published in game):

| Rarity    | Chance | Sprites at launch |
| --------- | ------ | ----------------- |
| Leafkin   | 40%    | 10                |
| Sapling   | 27%    | 9                 |
| Sprite    | 16%    | 8                 |
| Dryad     | 9%     | 6                 |
| Druid     | 5%     | 4                 |
| Treant    | 2.5%   | 3                 |
| Yggdrasil | 0.5%   | 2                 |

A Treant or better is guaranteed within 40 cones of the last one. On a banner,
the featured Sprite takes half the Treant-and-up chance and is guaranteed
within 80 cones on that banner. Every opening is decided on the server, with
its seed and pity count kept in an audit log.

**Shop bands:** everyday things cost 300 to 1,500 Leaf. Special pieces cost
2,000 to 6,000. Prestige pieces, like a koi pond or the giant tree style, cost
10,000 to 50,000, for the members who earn thousands a day.

There's about 188,000 Leaf in circulation today, enough for roughly 470 cones on
day one. That's fine for a launch party, and every price above lives in the
rules as data, so it can be tuned without new code. As agreed, Leaf never
converts into LE.

## Where it lives

- **Website.** The full game at `seqwawa.com/grove`, and every member's grove at
  a page of its own that friends can visit and water. The Great Sequoia sits on
  the front page.
- **Discord Activity.** The same client, launched from the app launcher in a
  voice channel. Discord loads it in a frame and routes all its traffic through
  its own proxy, so the game maps two paths: the client and the Leaf API.
  Players sign in with Discord. The backend already holds verified
  Discord-to-Minecraft links, so it can issue a Sequoia session from a Discord
  sign-in. The layout adapts to Discord's focused, picture-in-picture and grid
  modes, and to phones.
- **Sequoia mod.** Your companion Sprite next to your nametag, a toast when a
  cone is ready, and a button to open your grove.
- **Sierra.** Rare finds posted to Discord (only if you opt in) as an animated
  clip of the opening, plus a daily Leafle thread. The Sprites are pixel grids,
  so the server can draw those clips without a browser.

## Look and feel

![Things for the grove](items.webp)

- **Like a cartridge game on an old handheld.** Warm and a little faded. Bark is
  red-brown and fibrous, needles are blue-green and muted, and there are never
  bright greens. Outlines are a deep plum, never black.
- **Everything is drawn by hand and placed by hand.** Sprites are written as
  rows of palette letters in `src/art`, so they're easy to edit, review and
  diff. Nothing is scattered at random, and nothing repeats evenly round a
  shape.
- **Menus look like the ones we grew up with.** Cream panels with a double
  border, a pixel font, and text boxes with a blinking ▼.
- **The sky follows your clock.** Morning, day, golden hour, dusk and night,
  with fireflies and lantern light after dark.
- **Reward moments always move.** Opening a cone is never a static picture.

## Building it

Each milestone ships when it's fun on its own.

1. **Seedling.** Your tree on the website: growth from SEQ level, care and
   Bloom, Fennel's stall with about 30 things to buy, and a grove you can
   arrange. In Leaf: grove and inventory tables, the catalogue as data, and
   every purchase as a spend in the ledger.
2. **Cones.** Cones, the first 42 Sprites, the fireside opening, the Sprite
   Book and the first banner. Odds and pity live in `packages/core` with tests,
   and every opening is logged.
3. **Gathering.** The Discord Activity (gatherings, cone parties, Leafle),
   Discord sign-in, and the companion by your nametag in the mod.
4. **The Great Sequoia.** The guild tree and its weekly goals, seasonal events
   (Halloween pumpkins, winter lights, the July anniversary), and expeditions,
   where Sprites set off to Wynncraft's provinces and come home with postcards.

The client in `apps/grove` is plain TypeScript and canvas, with no framework.
It's small and fast, and it suits Discord's single-page frame. Its API types
come from Leaf's `/openapi.json`. Leaf serves the built client itself.

## What I still need

- **The community's voice.** Joyeuse is ready to read Sequoia main and Branch
  Masters, read-only, for the guild's in-jokes, how people feel about Leaf so
  far, and what they want from a game. It needs Notes to confirm in its thread.
  Names and Sprites will change once that's in: every name here is a
  placeholder.
- **Members as Sprites.** The guild's chibi art is lovely, and members as
  collectibles was a popular idea in the gacha channel. It needs each member's
  yes, so Member Sprites would be opt-in.
- **Artists.** EpicPuppy613 drew a storyboard for a pull animation and offered
  to build on the site; Pat_crafter07 might help with pixel art. Forty-two Sprites, the
  remaining tree stages and around 60 grove items are more art than one person
  should draw, so I'd like to bring both in.
- **A Discord app for the Activity.** Activities belong to an app. That's
  either Sierra's or a new Sequoia Grove app, which is Notes' call.
