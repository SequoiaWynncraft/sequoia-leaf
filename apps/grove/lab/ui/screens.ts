import { icon } from './icons'
import { art } from './scenery'
import { state, spirits, lore, colors, odds, ranks, demo, finds } from './model'
import { badge, action, bar, creature, hearts, title, view } from './widgets'
export function banner() {
  return (
    title('Raid banner', 'The Canyon Colossus') +
    '<div class="feature">' +
    art('canyon') +
    '<div class="feature-caption"><small>Featured spirit</small><h2>Elder Stag</h2>' +
    badge(6) +
    '</div><div class="feature-stag">' +
    art('stag') +
    '</div></div><div class="banner-details"><section><h3>Cone odds</h3><div class="odds">' +
    ranks
      .map((_, i) => '<div>' + badge(i) + '<b>' + odds[i] + '%</b></div>')
      .join('') +
    '</div></section><section class="warming"><div class="subhead">Ember pity <small>' +
    state.pity +
    ' / 40</small></div>' +
    bar(state.pity, 40, '#e4ac55') +
    '<p>Treant or better within 40</p><div class="price">' +
    icon('leaf', 2) +
    ' 400 Leaf each</div><div class="buttons">' +
    action('warm-1', 'Warm 1 cone', 'gold', state.leaf < 400) +
    action('warm-10', 'Warm 10', '', state.leaf < 4000) +
    '</div></section></div>'
  )
}
export function reveal() {
  const result = finds[view.pull] || demo,
    i = result.rank
  return (
    '<div class="reveal-stage" style="--rank:' +
    colors[i] +
    '"><small>Cone opened</small><h1>A spirit stirs!</h1><div class="burst"><div class="rays"></div>' +
    [
      [12, 28],
      [75, 20],
      [84, 55],
      [24, 73],
      [52, 8],
      [69, 82],
    ]
      .map(
        ([x, y], j) =>
          '<i class="spark" style="left:' +
          x +
          '%;top:' +
          y +
          '%;--delay:' +
          j * 80 +
          'ms">✦</i>',
      )
      .join('') +
    (i === 6
      ? '<span class="creature ' +
        (result.verdant ? 'verdant' : '') +
        '">' +
        art('stag') +
        '</span>'
      : creature(i, 8, result.verdant)) +
    '</div><div class="tooltip reward"><div class="subhead">' +
    badge(i) +
    '<span class="new">' +
    (result.fresh ? 'NEW!' : hearts(result.bond)) +
    '</span></div><h2 style="color:' +
    colors[i] +
    '">' +
    spirits[i] +
    '</h2>' +
    (result.verdant
      ? '<div class="verdant-mark">' + icon('goldleaf', 2) + ' Verdant</div>'
      : '') +
    '<em>' +
    lore[i] +
    '</em></div><div class="buttons">' +
    (view.pull + 1 < finds.length
      ? action(
          'next',
          'Next spirit (' + (view.pull + 2) + ' / ' + finds.length + ')',
          'gold',
        )
      : '<a class="action gold" href="#spirits">Spirit book</a>') +
    '<a class="action" href="#banner">Back to cones</a></div></div>'
  )
}
export const jokes = [
  'Why did the tree join voice? To branch out.',
  'What does the crab pay in? Sand dollars.',
  'Why was the cone so calm? It was pining for nothing.',
]
export function camp() {
  const names = ['Fern', 'Wren', 'You']
  return (
    title('Treehouse voice', 'Campfire') +
    '<div class="camp-art"><div class="call-count"><i></i> 3 in voice</div>' +
    names
      .map(
        (n, i) =>
          '<div class="camper c' +
          i +
          '"><div>' +
          icon('face' + i, 4) +
          creature([2, 4, 3][i], 2) +
          '</div><small>' +
          n +
          '</small></div>',
      )
      .join('') +
    '<div class="fire">' +
    icon('campfire', 5) +
    '</div><button class="cat" data-act="joke" aria-label="Ask the grove cat for a dad joke">' +
    icon('cat', 2) +
    '</button>' +
    (view.joke >= 0
      ? '<button class="speech" data-act="dismiss">' +
        jokes[view.joke] +
        '</button>'
      : '') +
    '</div><div class="camp-actions"><section><div class="subhead">Cone queue <small>' +
    state.queue.length +
    ' waiting</small></div><p>' +
    state.queue.join(' → ') +
    '</p>' +
    action(
      'queue',
      state.queue.includes('You') ? 'Warm together' : 'Queue a cone',
      'gold',
      !state.queue.includes('You') && !state.cones,
    ) +
    '</section><a class="leafle-tile" href="#leafle"><div class="sample-tiles"><b>W</b><b>Y</b><b>N</b></div><strong>Daily Leafle ›</strong><small>Play with the call</small></a></div>'
  )
}
