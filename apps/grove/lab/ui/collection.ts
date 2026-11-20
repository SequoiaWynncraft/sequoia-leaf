import { art, seasons, stories } from './scenery'
import { icon } from './icons'
import { money, state, colors, ranks, spirits, stock, tabs } from './model'
import { action, badge, bar, creature, title, tooltip, view } from './widgets'
export function book() {
  const count = state.bonds.filter(Boolean).length
  return (
    title('Spirit book', 'Your spirits') +
    '<div class="split"><section><div class="subhead">Collection <small>' +
    count +
    ' / 7 found</small></div><div class="inventory">' +
    ranks
      .map(
        (r, i) =>
          '<button class="rank-item ' +
          (i === view.rank ? 'picked' : '') +
          '" data-rank="' +
          i +
          '" aria-label="' +
          spirits[i] +
          ', ' +
          r +
          '"><span class="slot ' +
          (!state.bonds[i] ? 'unknown' : '') +
          '" style="--accent:' +
          colors[i] +
          '">' +
          creature(i, 3) +
          '</span>' +
          badge(i) +
          '</button>',
      )
      .join('') +
    '</div></section><section class="inspect" id="inspect">' +
    spiritDetail() +
    '</section></div>'
  )
}
export function spiritDetail() {
  const i = view.rank
  return (
    '<div class="display ' +
    (!state.bonds[i] ? 'unknown' : '') +
    '">' +
    creature(i, 6, state.verdants.includes(i)) +
    '</div>' +
    tooltip(i)
  )
}
export function ringScene() {
  return (
    '<div class="wood">' +
    art('rings') +
    '<div class="marks">' +
    [
      [1, 'star', 35, 47],
      [2, 'flag', 60, 38],
      [3, 'glade', 74, 62],
    ]
      .map(
        ([i, s, x, y]) =>
          '<button data-act="season-' +
          i +
          '" aria-label="' +
          seasons[Number(i)] +
          '" style="left:' +
          x +
          '%;top:' +
          y +
          '%">' +
          icon(String(s), 1) +
          '</button>',
      )
      .join('') +
    '</div></div>'
  )
}
export function rings() {
  const i = view.season
  return (
    title('Your sequoia', 'Tree rings') +
    '<div class="split"><section class="ring-display">' +
    ringScene() +
    '<div class="ring-key">' +
    [
      ['star', 'First raid'],
      ['flag', 'War win'],
      ['glade', 'Level up'],
    ]
      .map(([s, n]) => '<span>' + icon(s, 1) + ' ' + n + '</span>')
      .join('') +
    '</div></section><section><div class="tooltip"><small>Season ' +
    (28 + i) +
    '</small><h2>' +
    seasons[i] +
    '</h2><p>' +
    stories[i] +
    '</p></div><div class="season-picks">' +
    seasons
      .map((_, j) =>
        action('season-' + j, String(28 + j), j === i ? 'gold' : ''),
      )
      .join('') +
    '</div></section></div>'
  )
}
const heads = ['Fern', 'Wren', 'Alder']
const guildHistory = [
  'Sequoia defended the Swamp for about two years before moving to Fruma.',
  stories[4],
]
export function great() {
  const goals = [
    ['Water the roots', state.water, 25000, '#6dc590'],
    ['Guild raids', 36, 50, '#92b6d3'],
    ['Cones by the fire', 84, 100, '#d99f61'],
  ] as const
  return (
    title('Guild forest', 'The Great Sequoia') +
    '<div class="split"><section><div class="grove-scene">' +
    art('tree') +
    [...heads, ...(state.watered ? ['You'] : [])]
      .map(
        (name, i) =>
          '<span class="bough-light" title="' +
          name +
          '’s lantern" style="--offset:' +
          [-67, 32, 61, -22][i] +
          'px">' +
          icon('face' + (i % 3), 2) +
          '</span>',
      )
      .join('') +
    '</div><div class="guild-ring-controls">' +
    icon('rings', 2) +
    action('guildring-0', 'Swamp years', view.guildRing === 0 ? 'active' : '') +
    action('guildring-1', 'Season 32', 'gold') +
    '</div>' +
    (view.guildRing >= 0
      ? '<div class="tooltip guild-story"><p>' +
        guildHistory[view.guildRing] +
        '</p></div>'
      : '') +
    '</section><section><h2>Weekly goals</h2>' +
    goals
      .map(
        ([n, v, m, c]) =>
          '<div class="goal"><div>' +
          n +
          '<small>' +
          money(v) +
          ' / ' +
          money(m) +
          '</small></div>' +
          bar(v, m, c) +
          '</div>',
      )
      .join('') +
    action('water', 'Water the Great Sequoia', 'green', state.leaf < 100) +
    '<small class="cost">100 Leaf · ' +
    money(state.water) +
    ' poured this week</small></section></div><div class="lanterns"><div>' +
    icon('lamp', 2) +
    '<span>Contributor lanterns<small>' +
    state.lights +
    ' hung this week</small></span></div><div>' +
    [...heads, ...(state.watered ? ['You'] : [])]
      .map(
        (n, i) =>
          '<span class="lantern" title="' +
          n +
          '">' +
          icon('face' + (i % 3), 3) +
          '</span>',
      )
      .join('') +
    '</div></div>'
  )
}
export function shopTip() {
  const [name, , price] = stock[view.item]
  return (
    '<div class="tooltip compact"><strong>' +
    name +
    '</strong><span>' +
    icon('leaf', 1) +
    money(price) +
    ' Leaf</span>' +
    action(
      'buy',
      state.owned.includes(view.item) ? 'Owned' : 'Trade',
      'green',
      state.owned.includes(view.item) || state.leaf < price,
    ) +
    '</div>'
  )
}
function dailyTrades() {
  const utcDay = Math.floor(Date.now() / 86400000)
  return [0, 1, 2, 3].map((offset) => (utcDay * 5 + offset) % stock.length)
}
export function shop() {
  return (
    title('Crab bounty exchange', 'The crab stall') +
    '<div class="split stall"><section><div class="vendor">' +
    icon('crab', 5) +
    '<div><small>Shopkeeper</small><h2>Clawford</h2></div></div><h3>Today’s four trades</h3>' +
    dailyTrades()
      .map((i) => {
        const [n, s, p] = stock[i]
        return (
          '<button class="trade" data-item="' +
          i +
          '">' +
          icon(s, 2) +
          '<span>' +
          n +
          '</span><b>' +
          icon('leaf', 1) +
          money(p) +
          '</b></button>'
        )
      })
      .join('') +
    '</section><section><h2>Catalogue</h2><div class="tabs">' +
    tabs
      .map((t, i) => action('tab-' + i, t, i === view.tab ? 'active' : ''))
      .join('') +
    '</div><div class="catalog">' +
    stock
      .map(([n, s, , t], i) =>
        t === view.tab
          ? '<button class="slot" data-item="' +
            i +
            '" aria-label="' +
            n +
            '">' +
            icon(s, 2) +
            '</button>'
          : '',
      )
      .join('') +
    '</div><div id="item-tip">' +
    shopTip() +
    '</div></section></div>'
  )
}
