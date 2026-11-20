import { icon } from './icons'
import { colors, ranks, spirits, sprites, lore, jobs, state } from './model'
export const nav = [
  ['hud', 'glade', 'Glade'],
  ['great', 'forest', 'Forest'],
  ['banner', 'cone', 'Cones'],
  ['spirits', 'spirits', 'Spirits'],
  ['shop', 'shop', 'Shop'],
  ['campfire', 'campfire', 'Campfire'],
]
export const view = {
  rank: 4,
  season: 4,
  tab: 0,
  item: 0,
  tool: 0,
  pull: 0,
  guildRing: -1,
  joke: -1,
  menu: false,
}
export const bar = (v: number, max: number, color = '#73b77c') =>
  '<div class="bar" role="meter" aria-valuenow="' +
  v +
  '" aria-valuemin="0" aria-valuemax="' +
  max +
  '" aria-label="Progress" style="--fill:' +
  color +
  '"><i style="width:' +
  Math.min(100, (v * 100) / max) +
  '%"></i></div>'
export const action = (
  id: string,
  label: string,
  tone = '',
  disabled = false,
) =>
  '<button data-act="' +
  id +
  '" class="action ' +
  tone +
  '" ' +
  (disabled ? 'disabled' : '') +
  '>' +
  label +
  '</button>'
export const badge = (rank: number) =>
  '<span style="color:' + colors[rank] + '">' + ranks[rank] + '</span>'
export const title = (category: string, name: string) =>
  '<div class="section-title"><small>' +
  category +
  '</small><h1>' +
  name +
  '</h1></div>'
export const hearts = (n: number) =>
  '<span class="hearts" aria-label="Bond ' +
  Math.min(n, 5) +
  ' of 5">' +
  Array.from(
    { length: 5 },
    (_, i) =>
      '<span class="' +
      (i >= n ? 'empty' : '') +
      '">' +
      icon('heart', 1) +
      '</span>',
  ).join('') +
  '</span>'
export function creature(i: number, s: number, verdant = false) {
  return (
    '<span class="creature ' +
    (verdant ? 'verdant' : '') +
    '">' +
    icon(sprites[i], s) +
    '</span>'
  )
}
export function tooltip(i: number) {
  const owned = state.bonds[i] > 0
  return (
    '<div class="tooltip"><small>' +
    badge(i) +
    ' spirit</small><h2 style="color:' +
    colors[i] +
    '">' +
    spirits[i] +
    '</h2><p>' +
    jobs[i] +
    '</p><em>' +
    lore[i] +
    '</em><div class="bond">' +
    (owned ? 'Bond ' + hearts(state.bonds[i]) : 'Undiscovered') +
    (state.verdants.includes(i) ? icon('goldleaf', 1) + ' Verdant' : '') +
    '</div></div>'
  )
}
export const tools = [
  'Watering can',
  'Pruning shears',
  'Leaf mister',
  'Banked cones',
]
export const toolIcons = ['water', 'shears', 'mister', 'cone']
export function hud() {
  return (
    '<div class="glade-tree"><a class="tree-name" href="#rings"><small>Lv. 24</small> Your sequoia <span>›</span></a>' +
    art('tree') +
    '</div><div class="care"><div class="bloom-label"><span>' +
    icon('bloom', 1) +
    ' Bloom</span><span>' +
    state.bloom +
    ' / 100</span></div>' +
    bar(state.bloom, 100) +
    '<div class="hotbar">' +
    tools
      .map(
        (t, i) =>
          '<button class="slot ' +
          (i === view.tool ? 'chosen' : '') +
          '" aria-label="' +
          t +
          '" data-act="tool-' +
          i +
          '"><sup>' +
          (i + 1) +
          '</sup>' +
          icon(toolIcons[i], 3) +
          '<sub>' +
          (i === 3 ? state.cones : state.care) +
          '</sub></button>',
      )
      .join('') +
    '</div>' +
    action(
      'care',
      tools[view.tool] +
        ' <span>·</span> ' +
        ['Water', 'Prune', 'Mist', 'Warm'][view.tool],
      'use',
    ) +
    '</div>'
  )
}
import { art } from './scenery'
