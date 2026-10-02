// Pixel kit shared by the Clawd mods (from clawd-spinner's acts.ts). Pure: no `$`.
// A canvas is ROWS cells tall, two pixels per cell (▀), and packs into Raster cells.

export const ROWS = 8
export const PH = ROWS * 2
export const DEF = 0x01000000  // the terminal's own colour: transparent
export const GROUND = PH - 1

export type Canvas = { W: number; px: Uint32Array }
export type Glyph = { x: number; row: number; ch: string; fg: number }

export const canvas = (W: number): Canvas => ({ W, px: new Uint32Array(W * PH).fill(DEF) })

export function put(c: Canvas, x: number, y: number, colour: number) {
  x = Math.round(x)
  y = Math.round(y)
  if (x >= 0 && x < c.W && y >= 0 && y < PH) c.px[y * c.W + x] = colour
}

export function rect(c: Canvas, x: number, y: number, w: number, h: number, colour: number) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(c, x + i, y + j, colour)
}

/** A stable random number in [0, 1) for the same inputs. */
export function rnd(a: number, b = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f)
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296
}

export const mix = (a: number, b: number, k: number) => {
  k = Math.min(1, Math.max(0, k))
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k) << s
  return ch(16) | ch(8) | ch(0)
}

/** Text on the frame, one glyph per character; narrow ASCII-ish only. */
export function label(glyphs: Glyph[], x: number, row: number, text: string, fg: number) {
  ;[...text].forEach((ch, i) => glyphs.push({ x: x + i, row, ch, fg }))
}

// ------------------------------------------------------------------ Clawd

export const CLAWD = 0xd97757
const CLAWD_ART = [
  '..CCCCCCCCCC..',
  '..CCECCCCECC..',
  '..CCECCCCECC..',
  '..CCCCCCCCCC..',
  '..CCCCCCCCCC..',
]
const LEGS = ['..C.C....C.C..', '...C.C..C.C...']
export const CLAWD_W = 14
export const CLAWD_TOP = GROUND - CLAWD_ART.length - 1

export type Pose = 'stand' | 'walk' | 'type' | 'dance' | 'rest'
export type Look = { colour?: number; eyes?: 'open' | 'closed' | 'x'; legs?: boolean }

/** Clawd at x, facing right (1) or left (-1), lifted `lift` pixels. */
export function clawd(c: Canvas, t: number, pose: Pose, x: number, facing: 1 | -1 = 1, lift = 0, look: Look = {}) {
  const f = Math.floor(t / 83)
  const body = look.colour ?? CLAWD
  const eyes = look.eyes ?? (f % 47 < 2 ? 'closed' : 'open')
  const ox = Math.round(x)
  const hop = pose === 'dance' ? -(Math.floor(t / 300) % 2) : 0
  const breathe = (pose === 'stand' || pose === 'rest') && Math.floor(t / 900) % 2 ? 1 : 0
  const y = CLAWD_TOP + hop + breathe - lift
  const at = (i: number) => (facing > 0 ? ox + i : ox + CLAWD_W - 1 - i)
  const P = (i: number, yy: number, colour: number) => put(c, at(i), yy, colour)
  const shade = mix(body, 0x000000, 0.18)
  CLAWD_ART.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === 'C') P(i, y + j, body)
    if (ch === 'E') P(i, y + j, eyes === 'open' ? 0x1a1410 : eyes === 'x' && j === 1 ? 0x1a1410 : body)
  }))
  if (eyes === 'closed') { P(4, y + 2, 0x1a1410); P(9, y + 2, 0x1a1410) }
  for (let i = 2; i < 12; i++) P(i, y + 4, shade)
  if (look.legs !== false) {
    const stepping = pose === 'walk' || pose === 'dance'
    ;[...LEGS[stepping ? (f >> 1) % 2 : 0]!].forEach((ch, i) => ch === 'C' && P(i, CLAWD_TOP + CLAWD_ART.length + hop - lift, shade))
  }
  const armY = y + 2
  const beat = Math.floor(t / 300) % 2
  const left: [number, number][] = pose === 'dance' && beat === 0 ? [[1, armY - 1], [0, armY - 2]] : [[1, armY], [0, armY]]
  let right: [number, number][] = [[12, armY], [13, armY]]
  if (pose === 'dance' && beat === 1) right = [[12, armY - 1], [13, armY - 2]]
  if (pose === 'type') right = [[12, armY + (f % 3 === 0 ? 1 : 0)], [13, armY + 1]]
  for (const [i, yy] of [...left, ...right]) P(i, yy, body)
}

// ------------------------------------------------------------------ walking routes

export const WALK = 0.016  // pixels per ms

export type Stop = { x: number; stay: number; pose: Pose }
export type Where = { x: number; facing: 1 | -1; pose: Pose; stop: number; still: boolean }

/** A place on a looping route: stands at each stop for `stay` ms, moves between them. */
export function along(stops: Stop[], ms: number, speed = WALK): Where {
  const legs = stops.map((s, i) => {
    const next = stops[(i + 1) % stops.length]!
    return { s, next, walk: Math.abs(next.x - s.x) / speed }
  })
  const total = legs.reduce((sum, l) => sum + l.s.stay + l.walk, 0) || 1
  let t = ms % total
  for (const [i, l] of legs.entries()) {
    if (t < l.s.stay) return { x: l.s.x, facing: 1, pose: l.s.pose, stop: i, still: true }
    t -= l.s.stay
    if (t < l.walk) return { x: l.s.x + (l.next.x - l.s.x) * (t / l.walk), facing: l.next.x >= l.s.x ? 1 : -1, pose: 'walk', stop: i, still: false }
    t -= l.walk
  }
  return { x: stops[0]!.x, facing: 1, pose: stops[0]!.pose, stop: 0, still: true }
}

export function ground(c: Canvas, colour = 0x2a2d36) {
  for (let x = 0; x < c.W; x++) put(c, x, GROUND, colour)
}

// ------------------------------------------------------------------ packing

/** The frame's cells for a Raster: columns * ROWS triplets of [codePoint, fg, bg]. Glyphs land on empty cells only. */
export function cells(c: Canvas, glyphs: Glyph[]): Uint32Array {
  const W = c.W
  const out = new Uint32Array(W * ROWS * 3)
  for (let r = 0; r < ROWS; r++) {
    for (let x = 0; x < W; x++) {
      const top = c.px[2 * r * W + x]!
      const bot = c.px[(2 * r + 1) * W + x]!
      const i = (r * W + x) * 3
      if (top === DEF && bot === DEF) out.set([0x20, DEF, DEF], i)
      else if (top === bot) out.set([0x2588, top, DEF], i)
      else if (top === DEF) out.set([0x2584, bot, DEF], i)
      else out.set([0x2580, top, bot], i)
    }
  }
  for (const g of glyphs) {
    const i = (g.row * W + g.x) * 3
    const cp = g.ch.codePointAt(0) ?? 0x20
    if (g.x >= 0 && g.x < W && g.row >= 0 && g.row < ROWS && out[i] === 0x20 && cp < 0x2e80) out.set([cp, g.fg, DEF], i)
  }
  return out
}

/** Base64 of the cells, as RasterProps.cells wants them. */
export const encode = (packed: Uint32Array): string => new Uint8Array(packed.buffer).toBase64()
