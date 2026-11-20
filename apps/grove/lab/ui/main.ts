import { icon } from './icons'
import { state, money, warm, save, stock } from './model'
import { nav, hud, view } from './widgets'
import { book, spiritDetail, rings, great, shop, shopTip } from './collection'
import { banner, reveal, camp, jokes } from './screens'
import { key, puzzle } from './leafle'
import { ringBand } from './scenery'
const screens = {
  hud,
  banner,
  reveal,
  spirits: book,
  rings,
  great,
  campfire: camp,
  leafle: puzzle,
  shop,
}
type Route = keyof typeof screens
const route = (): Route => {
  const h = location.hash.slice(1)
  return Object.hasOwn(screens, h) ? (h as Route) : 'hud'
}
const shell = document.querySelector<HTMLElement>('#shell')!
function render() {
  const r = route(),
    group =
      (
        { reveal: 'banner', leafle: 'campfire', rings: 'hud' } as Record<
          string,
          string
        >
      )[r] || r
  document.body.dataset.route = r
  const navigation = nav
    .map(
      ([url, s, label]) =>
        '<a href="#' +
        url +
        '" class="' +
        (url === group ? 'current' : '') +
        '" ' +
        (url === group ? 'aria-current="page"' : '') +
        '>' +
        icon(s, 2) +
        '<span>' +
        label +
        '</span></a>',
    )
    .join('')
  shell.innerHTML =
    '<header><a class="brand" href="#hud">' +
    icon('glade', 3) +
    '<span>Sequoia Grove<small>[SEQ] &nbsp; / &nbsp; Guild forest</small></span></a><div class="balance panel"><small>Leaf balance</small><div>' +
    icon('leaf', 2) +
    '<b>' +
    money(state.leaf) +
    '</b></div></div></header><nav aria-label="Grove menu" class="panel ' +
    (view.menu ? 'open' : '') +
    '"><div class="nav-title">Grove menu</div>' +
    navigation +
    '</nav><main class="' +
    (r === 'hud' ? 'hud' : r === 'reveal' ? 'reveal' : 'window panel') +
    '">' +
    screens[r]() +
    '</main><button class="mobile-menu action" data-act="menu" aria-expanded="' +
    view.menu +
    '"><b>≡</b> Grove menu</button>'
}
let timer: ReturnType<typeof setTimeout>
function say(s: string) {
  const out = document.querySelector('output')!
  out.textContent = s
  clearTimeout(timer)
  timer = setTimeout(() => (out.textContent = ''), 2600)
}
function openCones(n: number, bank = false) {
  if (!warm(n, bank))
    return say(bank ? 'No banked cones.' : 'More Leaf needed.')
  view.pull = 0
  location.hash = 'reveal'
}
function interact(a: string) {
  const [cmd, num] = a.split('-'),
    i = Number(num)
  switch (cmd) {
    case 'menu':
      view.menu = !view.menu
      break
    case 'tool':
      view.tool = i
      break
    case 'care':
      if (view.tool === 3) {
        openCones(1, true)
        break
      }
      if (!state.care) return say('All care charges used.')
      state.care--
      state.bloom += 10
      if (state.bloom >= 100) {
        state.bloom -= 100
        state.cones++
        say('Full Bloom! One cone banked.')
      } else
        say(
          ['Roots watered', 'Branches pruned', 'Needles misted'][view.tool] +
            ' · +10 Bloom',
        )
      break
    case 'warm':
      openCones(i)
      break
    case 'next':
      view.pull++
      break
    case 'season':
      view.season = i
      break
    case 'guildring':
      view.guildRing = view.guildRing === i ? -1 : i
      break
    case 'water':
      if (state.leaf < 100) return
      state.leaf -= 100
      state.water += 100
      if (!state.watered) state.lights++
      state.watered = true
      say('Your lantern glows in the branches.')
      break
    case 'queue':
      if (state.queue.includes('You')) {
        if (!state.cones) return say('No banked cones.')
        state.queue = []
        openCones(1, true)
      } else if (state.cones) state.queue.push('You')
      break
    case 'tab':
      view.tab = i
      view.item = stock.findIndex((item) => item[3] === i)
      break
    case 'buy': {
      const price = stock[view.item][2]
      if (state.owned.includes(view.item) || state.leaf < price) return
      state.leaf -= price
      state.owned.push(view.item)
      say(stock[view.item][0] + ' acquired.')
      break
    }
    case 'joke':
      view.joke = (view.joke + 1) % jokes.length
      break
    case 'dismiss':
      view.joke = -1
      break
  }
  save()
  render()
}
function inspect(el: HTMLElement) {
  const rank = el.closest<HTMLElement>('[data-rank]'),
    item = el.closest<HTMLElement>('[data-item]')
  if (rank) {
    view.rank = Number(rank.dataset.rank)
    shell
      .querySelectorAll('[data-rank]')
      .forEach((b) => b.classList.toggle('picked', b === rank))
    document.querySelector('#inspect')!.innerHTML = spiritDetail()
  }
  if (item) {
    view.item = Number(item.dataset.item)
    document.querySelector('#item-tip')!.innerHTML = shopTip()
    shell
      .querySelectorAll('[data-item]')
      .forEach((b) => b.classList.toggle('picked', b === item))
  }
}
shell.addEventListener('pointerover', (e) => inspect(e.target as HTMLElement))
shell.addEventListener('focusin', (e) => inspect(e.target as HTMLElement))
shell.addEventListener('click', (e) => {
  const el = e.target as HTMLElement,
    b = el.closest<HTMLElement>('[data-act],[data-key],[data-rank],[data-item]')
  if (b?.dataset.act) interact(b.dataset.act)
  else if (b?.dataset.key) {
    const msg = key(b.dataset.key)
    if (msg) say(msg)
    render()
  } else if (b) inspect(b)
  else if (el.matches('.wood,.wood .rings,.marks')) {
    const box = el.closest('.wood')!.getBoundingClientRect(),
      d = ringBand(
        ((e.clientX - box.left) * 100) / box.width,
        ((e.clientY - box.top) * 74) / box.height,
      )
    if (d <= 1) interact('season-' + Math.min(4, Math.floor(d * 5)))
  } else if (el.closest('nav a') && view.menu) {
    view.menu = false
    render()
  }
})
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key === 'Escape') {
    view.menu = false
    render()
    return
  }
  if (route() === 'hud' && /^[1-4]$/.test(e.key)) {
    interact('tool-' + (Number(e.key) - 1))
    return
  }
  if (
    route() !== 'leafle' ||
    (e.key === 'Enter' && (e.target as HTMLElement).closest('button,a'))
  )
    return
  const k =
    e.key === 'Backspace' ? '⌫' : e.key === 'Enter' ? '↵' : e.key.toUpperCase()
  if (!/^[A-Z↵⌫]$/.test(k)) return
  e.preventDefault()
  const msg = key(k)
  if (msg) say(msg)
  render()
})
function scaleWorld() {
  const scale = Math.ceil(Math.max(innerWidth / 256, innerHeight / 144))
  document.body.style.setProperty('--world-w', 256 * scale + 'px')
  document.body.style.setProperty('--world-h', 144 * scale + 'px')
}
window.addEventListener('resize', scaleWorld)
window.addEventListener('hashchange', () => {
  view.menu = false
  render()
  window.scrollTo(0, 0)
})
scaleWorld()
render()
