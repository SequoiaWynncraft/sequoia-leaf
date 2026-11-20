// Low-resolution illustrations. Polygons are scan-converted directly to source
// pixels so neither diagonal trunks nor the canyon ridges pick up antialiasing.
const cache = new Map<string, string>()
function surface(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const c = canvas.getContext('2d')!
  function rect(x: number, y: number, w: number, h: number, color: string) {
    c.fillStyle = color
    c.fillRect(Math.round(x), Math.round(y), w, h)
  }
  function poly(coords: number[], color: string) {
    const ys = coords.filter((_, i) => i % 2)
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
      const cuts: number[] = []
      for (let i = 0; i < coords.length; i += 2) {
        const j = (i + 2) % coords.length,
          a = coords[i + 1],
          b = coords[j + 1]
        if ((a <= y && b > y) || (b <= y && a > y))
          cuts.push(coords[i] + ((y - a) / (b - a)) * (coords[j] - coords[i]))
      }
      cuts.sort((a, b) => a - b)
      for (let i = 0; i < cuts.length; i += 2)
        rect(
          Math.ceil(cuts[i]),
          y,
          Math.max(1, Math.ceil(cuts[i + 1]) - Math.ceil(cuts[i])),
          1,
          color,
        )
    }
  }
  return { canvas, rect, poly }
}
function tree() {
  const { canvas, rect, poly } = surface(116, 116)
  let seed = 321
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  // A root-bound outcrop, with exposed ochre strata under the moss cap.
  poly(
    [
      6, 96, 23, 89, 48, 87, 75, 88, 110, 95, 105, 103, 92, 107, 74, 107, 66,
      111, 39, 109, 24, 106, 12, 103,
    ],
    '#39272d',
  )
  poly(
    [
      7, 96, 29, 91, 80, 90, 109, 95, 103, 101, 86, 100, 80, 104, 66, 102, 56,
      106, 39, 103, 31, 105, 26, 101, 14, 101,
    ],
    '#81513c',
  )
  poly(
    [
      6, 95, 18, 91, 33, 90, 40, 86, 67, 87, 71, 89, 89, 88, 94, 91, 106, 91,
      110, 95, 99, 98, 84, 96, 73, 100, 60, 98, 47, 101, 30, 98, 18, 99,
    ],
    '#50603c',
  )
  for (let i = 0; i < 100; i++) {
    const x = 14 + rand() * 88,
      y = 94 + (rand() - 0.5) * (1 - Math.abs(x - 58) / 55) * 9
    rect(
      x,
      y,
      1 + Math.floor(rand() * 4),
      1,
      rand() < 0.5 ? '#879053' : '#6a7742',
    )
  }
  poly(
    [
      51, 96, 55, 84, 58, 47, 61, 19, 65, 36, 65, 69, 68, 84, 75, 93, 84, 96,
      68, 95, 63, 92, 57, 98, 57, 94, 41, 98,
    ],
    '#48312e',
  )
  poly(
    [
      46, 95, 55, 89, 57, 72, 59, 39, 62, 27, 63, 64, 61, 81, 63, 88, 68, 92,
      62, 91, 57, 95, 58, 85, 54, 92,
    ],
    '#a3603b',
  )
  poly([53, 92, 58, 82, 61, 41, 60, 79, 59, 87], '#d29450')
  const limbs = [
    [30, 75, 58, 66],
    [37, 58, 60, 53],
    [64, 61, 90, 51],
    [34, 43, 61, 45],
    [61, 38, 82, 33],
    [62, 79, 83, 72],
  ]
  for (const [x, y, u, v] of limbs) {
    poly([x, y, x + 3, y - 2, u, v - 2, u, v + 2, x + 4, y + 1], '#624034')
  }
  // Individual sprays form tiered, asymmetrical boughs. Light catches their upper left edges.
  const layers = [
    [28, 72, 25, 10],
    [81, 71, 22, 9],
    [48, 61, 32, 11],
    [86, 54, 25, 10],
    [38, 46, 28, 11],
    [73, 37, 22, 10],
    [50, 30, 19, 9],
    [66, 23, 16, 9],
    [56, 16, 13, 8],
    [62, 9, 8, 6],
  ]
  for (const [x, y, r, h] of layers) {
    const fringe: number[] = []
    for (let k = 0; k <= r * 2; k += 2) {
      const dx = k - r,
        edge =
          y + Math.sqrt(Math.max(0, 1 - (dx / r) ** 2)) * h * 0.5 + rand() * 3
      fringe.push(x + dx, Math.round(edge))
    }
    const outline = [
      x - r,
      y + 2,
      x - r + 6,
      y - 4,
      x - r + 12,
      y - 5,
      x - 4,
      y - h,
      x + 3,
      y - h + 1,
      x + 7,
      y - h + 4,
      x + r - 4,
      y - 3,
      x + r,
      y + 2,
    ]
    const bottom = []
    for (let k = fringe.length - 2; k >= 0; k -= 2)
      bottom.push(fringe[k], fringe[k + 1])
    poly([...outline, ...bottom], '#304238')
    poly(
      [
        ...outline,
        x + r - 3,
        y + 1,
        x + 7,
        y + 2,
        x + 2,
        y + 4,
        x - 5,
        y + 1,
        x - 12,
        y + 3,
        x - r + 3,
        y + 1,
      ],
      '#526842',
    )
    for (let i = 0; i < r * 1.6; i++) {
      const dx = (rand() * 2 - 1) * r * 0.85,
        cap = (1 - Math.abs(dx) / r) * h,
        py = y - cap * rand()
      rect(
        x + dx,
        py,
        Math.ceil(rand() * 4),
        1,
        py < y - cap * 0.6 ? (rand() < 0.5 ? '#96a15a' : '#adad62') : '#71874c',
      )
    }
  }
  // Lantern and rootside mushrooms.
  rect(28, 79, 1, 6, '#392c28')
  rect(26, 84, 5, 6, '#683d33')
  rect(27, 85, 3, 3, '#ffce75')
  rect(27, 85, 1, 2, '#fff2b0')
  for (const [x, y] of [
    [22, 93],
    [18, 95],
    [84, 94],
    [91, 92],
  ]) {
    rect(x, y, 1, 3, '#dbc89a')
    rect(x - 1, y - 1, 3, 2, '#c48764')
    rect(x, y - 2, 1, 1, '#e9b58b')
  }
  return canvas
}
// The portrait retains the inventory silhouette but gives the antlers and coat
// their own clusters at reveal scale.
function stag() {
  const { canvas, rect, poly } = surface(58, 53)
  const outline = '#482e35',
    shadow = '#805042',
    coat = '#bd794a',
    light = '#dfa15f',
    cream = '#ffdb94',
    gold = '#edb85c',
    moss = '#748751'
  // Branching crown, far antler first.
  const horn = (x: number, y: number, points: number[], color: string) =>
    poly(
      points.map((v, i) => v + (i % 2 ? y : x)),
      color,
    )
  horn(
    1,
    -1,
    [
      20, 20, 23, 12, 28, 10, 29, 3, 31, 2, 30, 8, 34, 6, 35, 2, 36, 2, 36, 7,
      31, 11, 30, 13, 25, 14, 23, 20,
    ],
    '#af8655',
  )
  horn(
    0,
    0,
    [
      19, 20, 17, 14, 11, 12, 7, 8, 5, 8, 4, 3, 6, 4, 8, 7, 9, 2, 11, 1, 10, 8,
      13, 10, 14, 5, 16, 3, 15, 10, 18, 12, 20, 10, 22, 5, 23, 5, 22, 12, 20,
      15, 22, 20,
    ],
    gold,
  )
  rect(9, 2, 2, 3, cream)
  rect(14, 5, 1, 4, cream)
  rect(29, 2, 2, 3, cream)
  // Far legs show below the belly, with split hooves.
  poly([27, 33, 32, 33, 29, 41, 27, 45, 24, 48, 21, 48, 23, 45, 25, 40], shadow)
  poly(
    [
      42, 33, 48, 34, 46, 39, 49, 42, 48, 48, 45, 50, 44, 49, 46, 46, 45, 43,
      40, 39,
    ],
    shadow,
  )
  poly(
    [
      13, 20, 12, 17, 16, 18, 19, 16, 22, 17, 27, 15, 25, 20, 23, 22, 26, 26,
      32, 28, 42, 26, 48, 27, 51, 25, 54, 25, 53, 28, 49, 30, 49, 35, 46, 39,
      42, 42, 41, 48, 38, 51, 36, 50, 38, 47, 38, 40, 40, 37, 32, 38, 27, 36,
      25, 39, 21, 42, 19, 49, 16, 50, 16, 48, 18, 39, 21, 35, 18, 30, 15, 28,
      10, 28, 6, 26, 7, 24, 12, 22,
    ],
    outline,
  )
  poly(
    [
      13, 21, 14, 19, 17, 20, 20, 17, 22, 19, 26, 16, 23, 21, 21, 22, 25, 27,
      34, 29, 43, 27, 48, 29, 50, 27, 53, 26, 50, 29, 47, 30, 48, 34, 45, 37,
      42, 39, 40, 44, 40, 48, 38, 49, 39, 40, 42, 36, 36, 36, 28, 35, 24, 38,
      20, 41, 18, 48, 17, 48, 19, 39, 22, 35, 19, 30, 16, 27, 10, 27, 7, 25, 12,
      23,
    ],
    coat,
  )
  poly(
    [21, 22, 23, 26, 27, 29, 36, 30, 44, 28, 46, 29, 39, 32, 28, 32, 23, 30],
    light,
  )
  poly(
    [
      7, 25, 12, 24, 16, 25, 20, 23, 18, 26, 21, 29, 23, 30, 22, 35, 19, 32, 17,
      28, 11, 27,
    ],
    cream,
  )
  poly([44, 34, 48, 31, 47, 35, 43, 39, 42, 42, 39, 43, 40, 38], shadow)
  rect(7, 24, 3, 2, outline)
  rect(14, 21, 3, 3, outline)
  rect(14, 21, 1, 1, '#fff4d1')
  rect(22, 19, 2, 1, '#e6ac8a')
  for (const [x, y] of [
    [28, 30],
    [33, 32],
    [36, 29],
    [40, 31],
    [43, 29],
    [30, 34],
  ])
    rect(x, y, 2, 1, cream)
  for (const [x, y] of [
    [26, 26],
    [31, 27],
    [38, 26],
    [42, 25],
  ]) {
    poly(
      [
        x,
        y + 2,
        x - 2,
        y - 1,
        x - 2,
        y - 3,
        x + 1,
        y - 2,
        x + 2,
        y + 1,
        x + 3,
        y - 2,
        x + 5,
        y - 3,
        x + 4,
        y,
        x + 2,
        y + 2,
      ],
      moss,
    )
    rect(x - 2, y - 3, 2, 1, '#b4ba77')
  }
  return canvas
}
function canyon() {
  const { canvas, rect, poly } = surface(170, 88)
  rect(0, 0, 170, 88, '#45365a')
  for (const [y, color] of [
    [12, '#75486c'],
    [23, '#a75e78'],
    [36, '#cb786d'],
    [46, '#e19a72'],
  ] as const)
    rect(0, y, 170, 88 - y, color)
  poly(
    [118, 28, 121, 25, 128, 25, 131, 28, 131, 34, 128, 37, 121, 37, 118, 34],
    '#f8c587',
  )
  for (const [x, y, w] of [
    [14, 19, 21],
    [7, 21, 36],
    [54, 30, 21],
    [127, 15, 18],
    [137, 13, 14],
    [92, 37, 23],
  ])
    rect(x, y, w, 1, '#cc827f')
  poly(
    [
      0, 26, 18, 26, 21, 30, 24, 31, 27, 42, 34, 44, 37, 50, 50, 50, 52, 46, 69,
      45, 73, 54, 81, 56, 100, 47, 113, 47, 120, 35, 134, 34, 137, 29, 151, 29,
      156, 39, 170, 39, 170, 88, 0, 88,
    ],
    '#80536c',
  )
  poly(
    [
      0, 41, 21, 42, 26, 52, 35, 54, 40, 59, 59, 59, 64, 65, 90, 66, 102, 59,
      128, 58, 138, 48, 151, 48, 155, 42, 170, 40, 170, 88, 0, 88,
    ],
    '#62455d',
  )
  poly(
    [
      0, 53, 24, 56, 31, 64, 43, 63, 49, 66, 72, 69, 108, 68, 120, 62, 136, 62,
      145, 54, 170, 50, 170, 88, 0, 88,
    ],
    '#45364e',
  )
  poly(
    [
      0, 61, 9, 62, 15, 68, 29, 69, 35, 74, 58, 73, 67, 71, 89, 71, 98, 73, 125,
      72, 133, 67, 151, 64, 156, 56, 170, 55, 170, 88, 0, 88,
    ],
    '#332c3e',
  )
  for (const [x, y, w] of [
    [4, 42, 13],
    [28, 54, 6],
    [53, 46, 11],
    [121, 36, 10],
    [142, 30, 8],
    [4, 55, 16],
    [142, 49, 8],
    [72, 71, 18],
    [60, 73, 9],
  ])
    rect(x, y, w, 1, '#af7977')
  return canvas
}
export const seasons = [
  'Swamp roots',
  'First guild raid',
  'First war win',
  'Level 250',
  'Season 32 victory',
]
const stories = [
  'Your first season in the Swamp. Training Twig made room by the roots.',
  'Your first graid took you from Cinfy to The Canyon Colossus.',
  'A banner rose over the Swamp after your first territory win.',
  'The guild reached level 250. Two weeks of double payouts followed.',
  'After the 80-hour Third Aequitas War, Sequoia finished with a record season rating.',
]
export { stories }
export function ringBand(x: number, y: number) {
  const dx = (x - 48) / 45,
    dy = (y - 34) / 28,
    a = Math.atan2(dy, dx)
  return (
    Math.hypot(dx, dy) *
    (1 +
      0.055 * Math.sin(3 * a + 0.6) +
      0.023 * Math.cos(7 * a - 0.8) +
      0.017 * Math.sin(5 * a))
  )
}
function rings() {
  const { canvas, rect } = surface(100, 74)
  for (let y = 0; y < 74; y++)
    for (let x = 0; x < 100; x++) {
      const d = ringBand(x, y),
        below = ringBand(x, y - 5)
      if (d > 1) {
        if (below <= 1) rect(x, y, 1, 1, x % 7 < 2 ? '#57353a' : '#854831')
        continue
      }
      const i = Math.min(4, Math.floor(d * 5)),
        f = d * 5 - i
      const colors = ['#bc8558', '#c58b5b', '#cc9364', '#d6a474', '#e6b75e']
      const grain = Math.sin(x * 0.53 + y * 0.75) + Math.sin(x * 0.8 - y * 0.14)
      const wash = grain > 1.6 && (x + 3 * y) % 5 < 3
      rect(
        x,
        y,
        1,
        1,
        f > 0.81
          ? i === 4
            ? '#805430'
            : '#915b42'
          : f < 0.16
            ? i === 4
              ? '#ffe69a'
              : '#e2ae76'
            : wash
              ? ['#b57d53', '#ba8054', '#be895b', '#c79a67', '#d6a656'][i]
              : colors[i],
      )
    }
  return canvas
}
export function art(name: 'tree' | 'rings' | 'canyon' | 'stag') {
  if (!cache.has(name))
    cache.set(name, { tree, rings, canyon, stag }[name]().toDataURL())
  return (
    '<img alt="" draggable="false" class="art ' +
    name +
    '" src="' +
    cache.get(name) +
    '">'
  )
}
