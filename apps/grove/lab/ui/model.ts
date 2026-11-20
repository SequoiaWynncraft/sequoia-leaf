export const ranks = [
  'Leafkin',
  'Sapling',
  'Sprite',
  'Dryad',
  'Druid',
  'Treant',
  'Yggdrasil',
]
export const colors = [
  '#16B20B',
  '#52EE47',
  '#87cbea',
  '#e9ae86',
  '#c8b1ef',
  '#E20B0B',
  '#FDD36F',
]
export const odds = [40, 27, 16, 9, 5, 2.5, 0.5]
export const spirits = [
  'Mossmote',
  'Slug',
  'Chickaree',
  'Emberkit',
  'Fog Owl',
  'Cinder Hind',
  'Elder Stag',
]
export const sprites = [
  'Mossmote',
  'Slug',
  'Chickaree',
  'Emberkit',
  'Fog Owl',
  'Cinder Hind',
  'Elder Stag',
]
export const lore = [
  'Two bright eyes under a hill of moss.',
  'A silver thread marks the path home.',
  'Buried three seeds and remembered two.',
  'Even its footprints stay warm until dawn.',
  'Mist beads on the tips of its ear tufts.',
  'Steps as softly as ash on stone.',
  'The canyon falls quiet when its antlers appear.',
]
export const jobs = [
  'Tends the fern beds.',
  'Spreads moss over roots.',
  'Plants seedlings around your tree.',
  'Keeps your campfire lit.',
  'Brings mist to refill a care charge.',
  'Warms the cones by the fire.',
  'Guides lost spirits back to your glade.',
]
export const tabs = [
  'Decor',
  'Tree styles',
  'Lights',
  'Nametag frames',
  'Leaf badge colours',
]
export const stock = [
  ['Swamp stepping stones', 'stone', 650, 0],
  ['Cinfy lantern', 'lamp', 900, 2],
  ['Amber canopy', 'glade', 1800, 1],
  ['Gilded grain', 'frame', 1200, 3],
  ['Fruma fern', 'leaf', 450, 0],
  ['Swamp bloom', 'bloom', 320, 0],
  ['Training Twig flag', 'flag', 720, 0],
  ['Dusk cedar', 'forest', 1250, 1],
  ['Firefly lamp', 'star', 800, 2],
  ['Amethyst trim', 'frame', 850, 3],
  ['Fern green', 'leaf', 450, 4],
  ['Verdant gold', 'goldleaf', 950, 4],
] as const
export const money = (n: number) => n.toLocaleString('en-US')
export const state = {
  leaf: 6840,
  care: 4,
  bloom: 60,
  cones: 3,
  pity: 17,
  water: 18750,
  lights: 38,
  bonds: [2, 1, 2, 3, 1, 0, 0],
  owned: [] as number[],
  queue: ['Fern', 'Wren'],
  watered: false,
  verdants: [] as number[],
}
const storage = 'seq-grove-pixels-v1'
try {
  Object.assign(state, JSON.parse(sessionStorage.getItem(storage) || '{}'))
} catch {}
export const save = () => sessionStorage.setItem(storage, JSON.stringify(state))
export type Find = {
  rank: number
  verdant: boolean
  fresh: boolean
  bond: number
}
export const demo: Find = { rank: 6, verdant: true, fresh: true, bond: 1 }
export let finds: Find[] = []
export function warm(n: number, bank = false) {
  if (bank ? state.cones < n : state.leaf < n * 400) return false
  if (bank) state.cones -= n
  else state.leaf -= n * 400
  finds = Array.from({ length: n }, () => {
    const roll = Math.random() * 100
    let total = 0
    let rank = odds.findIndex((weight) => (total += weight) > roll)
    if (state.pity >= 39) rank = Math.max(5, rank)
    state.pity = rank >= 5 ? 0 : state.pity + 1
    const bond = ++state.bonds[rank],
      verdant = Math.random() < 0.05 || bond === 4
    if (verdant && !state.verdants.includes(rank)) state.verdants.push(rank)
    return { rank, verdant, fresh: bond === 1, bond }
  })
  save()
  return true
}
