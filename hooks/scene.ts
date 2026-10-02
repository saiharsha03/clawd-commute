// The branch as a tram line: each recent commit a station, Clawd rides between them.
// Pure: frame() turns the line and the time into Raster cells.
import { along, canvas, cells, clawd, GROUND, label, put, rect, type Glyph, type Stop } from './art'

import type { Commit, Line } from '../types'

export const EMPTY: Line = { repo: false, branch: '', commits: [], dirty: 0, ahead: 0, conflict: false, departedAt: null }

const RAIL = 0x6a6f7a
const POST = 0x4a505c
const SIGN = 0x5fa8a0
const HEAD = 0x8fd1c8
const TEXT = 0x9aa0ac
const DIM = 0x5c6270
const RED = 0xd9534f
const CAR = 0x3c5a78
const CAR_LIT = 0x5b80a8
const SPACING = 20
const DEPART_MS = 6000

/** Parses `git log --format=%h%x09%s` (newest first) into stations, oldest first. */
export function parseLog(out: string): Commit[] {
  return out.split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => { const [sha = '', ...rest] = l.split('\t'); return { sha, subject: rest.join('\t') } })
    .reverse()
}

/** Parses `git status --porcelain`: how many files changed, and whether any is unmerged. */
export function parseStatus(out: string): { dirty: number; conflict: boolean } {
  const lines = out.split('\n').filter(l => l.length > 2)
  return { dirty: lines.length, conflict: lines.some(l => /^(UU|AA|DD|AU|UA|DU|UD) /.test(l)) }
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + '~' : s)

function station(c: ReturnType<typeof canvas>, g: Glyph[], x: number, sign: number) {
  rect(c, x, 9, 1, 6, POST)
  rect(c, x - 2, 8, 5, 1, sign)
}

function tram(c: ReturnType<typeof canvas>, t: number, x: number) {
  clawd(c, t, 'walk', x, 1, 0, { legs: false })  // 'walk': no breathing, the eyes stay above the car
  rect(c, x - 1, 12, 16, 3, CAR)
  rect(c, x - 1, 12, 16, 1, CAR_LIT)
  for (const w of [1, 2, 11, 12]) put(c, x + w, 14, 0x15171c)
}

export function frame(line: Line, t: number, now: number, W: number): Uint32Array {
  const c = canvas(W)
  const g: Glyph[] = []
  for (let x = 0; x < W; x++) put(c, x, GROUND, RAIL)

  if (!line.repo) {
    station(c, g, 30, DIM)
    label(g, 1, 0, 'no line here', TEXT)
    label(g, 22, 2, 'not a git repo', DIM)
    clawd(c, t, 'stand', 8, 1)
    return cells(c, g)
  }

  const room = Math.max(1, Math.floor((W - 34) / SPACING))
  const shown = line.commits.slice(-room)
  const xs = shown.map((_, i) => 10 + i * SPACING)
  label(g, 1, 0, clip(`${line.branch} line`, Math.max(8, W - 30)), TEXT)
  xs.forEach((x, i) => {
    const isHead = i === shown.length - 1
    station(c, g, x, isHead ? HEAD : SIGN)
    label(g, x - 3, 1, shown[i]!.sha.slice(0, 7), isHead ? HEAD : DIM)
    label(g, x - 3, 2, clip(shown[i]!.subject, SPACING - 2), isHead ? TEXT : DIM)
  })

  // the next stop: what is not committed yet, what is not pushed yet
  const nx = Math.max((xs.at(-1) ?? 0) + SPACING, W - 22)
  const pending = line.dirty > 0 || line.ahead > 0 || line.conflict
  if (pending) {
    station(c, g, nx, line.conflict ? RED : DIM)
    label(g, nx - 3, 1, line.conflict ? 'CONFLICT' : 'next', line.conflict ? RED : DIM)
    if (line.dirty) label(g, nx - 3, 2, `+${line.dirty} changed`, TEXT)
    if (line.ahead) label(g, nx - 3, 3, `${line.ahead} to push`, TEXT)
    for (let k = 0; k < Math.min(line.dirty, 5); k++) {  // passengers waiting
      const px = nx - 4 - k * 2
      const bob = Math.floor(t / 400 + k) % 2
      put(c, px, 11 + bob, 0xc8ccd8); rect(c, px, 12 + bob, 1, 2, 0x8a90a0)
    }
  }

  const departing = line.departedAt !== null && now - line.departedAt < DEPART_MS
  if (departing) {
    const from = (xs.at(-1) ?? 10) - 7
    tram(c, t, from + (now - line.departedAt!) * 0.03)
    label(g, Math.max(1, W - 12), 0, 'departed', HEAD)
    return cells(c, g)
  }

  const stops: Stop[] = xs.map(x => ({ x: x - 7, stay: 1600, pose: 'stand' }))
  if (pending && !line.conflict) stops.push({ x: nx - 18, stay: 2200, pose: 'stand' })
  if (stops.length === 0) stops.push({ x: 3, stay: 1000, pose: 'stand' })
  tram(c, t, along(stops, t, 0.022).x)
  return cells(c, g)
}
