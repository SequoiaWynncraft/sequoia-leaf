import { icon } from './icons'
const day = new Date().toISOString().slice(0, 10)
const words = ['FRUMA', 'NIVLA', 'WYBEL', 'GAVEL']
const answer = words[Math.floor(Date.parse(day) / 86400000) % words.length]
let guesses: string[] = JSON.parse(
    sessionStorage.getItem('leafle-' + day) || '[]',
  ),
  draft = ''
const score = (word: string) => {
  const result = Array(5).fill('miss'),
    left = answer.split('')
  for (let i = 0; i < 5; i++)
    if (word[i] === answer[i]) {
      result[i] = 'right'
      left[i] = ''
    }
  for (let i = 0; i < 5; i++)
    if (result[i] === 'miss' && left.includes(word[i])) {
      result[i] = 'near'
      left[left.indexOf(word[i])] = ''
    }
  return result
}
const done = () => guesses.includes(answer) || guesses.length >= 6
const mini = (name: string, solved: boolean, rows: number, own = false) =>
  `<div class="friend"><div class="mini">${Array.from({ length: 30 }, (_, i) => `<i class="${solved && i < rows * 5 ? (own ? score(guesses[Math.floor(i / 5)])[i % 5] : i >= (rows - 1) * 5 ? 'right' : ['miss', 'near', 'right'][(i * 7) % 3]) : ''}"></i>`).join('')}</div><div><strong>${name}</strong><small>${solved ? `Solved in ${rows}` : 'Still thinking'}</small></div></div>`
export function puzzle() {
  return `<div class="puzzlepage"><div class="puzzlebody"><div class="stamp">Treehouse daily</div><h1>Leafle</h1><p>Six guesses for a five-letter Wynncraft word.</p><div class="wordboard" role="img" aria-label="${guesses.map((w) => w + ' ' + score(w).join(' ')).join('. ') || 'Empty puzzle board'}">${Array.from(
    { length: 6 },
    (_, i) => {
      const w = guesses[i] ?? (i === guesses.length ? draft : '')
      return Array.from(
        { length: 5 },
        (_, j) =>
          `<b class="${guesses[i] ? score(w)[j] : i === guesses.length ? 'current' : ''}">${w[j] || ''}</b>`,
      ).join('')
    },
  ).join(
    '',
  )}</div><strong aria-live="polite">${done() ? (guesses.includes(answer) ? 'Solved! Your board is open to the call.' : 'The word was ' + answer + '.') : ''}</strong><div class="keyboard">${[
    'QWERTYUIOP',
    'ASDFGHJKL',
    '↵ZXCVBNM⌫',
  ]
    .map(
      (row) =>
        `<div>${row
          .split('')
          .map(
            (k) =>
              `<button data-key="${k}" aria-label="${k === '↵' ? 'Submit guess' : k === '⌫' ? 'Delete letter' : k}" ${done() ? 'disabled' : ''}>${k}</button>`,
          )
          .join('')}</div>`,
    )
    .join(
      '',
    )}</div></div><aside><span class="stamp">${day}</span><h2>At the fire</h2><p>Boards open when a friend solves the puzzle.</p>${mini('Fern', true, 3)}${mini('Wren', false, 0)}${mini('You', guesses.includes(answer), guesses.length, true)}<a class="textlink" href="#campfire">${icon('campfire')} Back to campfire</a></aside></div>`
}
export function key(k: string) {
  if (done()) return ''
  if (k === '⌫') draft = draft.slice(0, -1)
  else if (k === '↵') {
    if (draft.length !== 5) return 'Use five letters.'
    guesses.push(draft)
    draft = ''
    sessionStorage.setItem('leafle-' + day, JSON.stringify(guesses))
  } else if (/^[A-Z]$/.test(k) && draft.length < 5) draft += k
  return ''
}
