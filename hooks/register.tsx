import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { encode, ROWS } from './art'
import { EMPTY, frame, hintDir, parseLog, parseStatus } from './scene'
import type { Line } from '../types'

const FRAME_MS = 120
const EDGE = 2
const line = atom({ plugin: 'clawd-commute', key: 'line' } as const, EMPTY)
const shown = atom({ plugin: 'clawd-commute', key: 'shown' } as const, false)

/** The band's mount, for blits between redraws. Module state: a reload starts over. */
const band = { mount: null as { requestId: string; columns: number } | null, last: '', blit: true, lastRefresh: 0, startedAt: 0 }
/** The repo the line follows: the session's, else the one Claude last worked in, else the freshest child repo. */
const follow = { dir: null as string | null }

async function git($: EngineInterface, args: string[], cwd = follow.dir ?? undefined) {
  try {
    return await $.process.run(['git', ...args], { timeoutMs: 5000, ...(cwd ? { cwd } : {}) })
  } catch {
    return { exitCode: 1, stdout: '', stderr: '' }
  }
}

async function toplevel($: EngineInterface, dir: string) {
  const r = await git($, ['rev-parse', '--show-toplevel'], dir)
  return r.exitCode === 0 ? r.stdout.trim() : null
}

/** The session's own repo, else the repo under it (or under Agents/) with the newest commit. */
async function discover($: EngineInterface) {
  const cwd = await $.session.cwd()
  const own = await toplevel($, cwd)
  if (own) return own
  let best: { dir: string; at: number } | null = null
  for (const parent of [cwd, `${cwd}/Agents`]) {
    let entries: { name: string; kind: string }[] = []
    try {
      entries = await $.fs.list(parent)
    } catch {
      continue
    }
    for (const entry of entries) {
      const dir = `${parent}/${entry.name}`
      if (entry.kind !== 'dir' || !(await $.fs.exists(`${dir}/.git`))) continue
      const at = Number((await git($, ['log', '-1', '--format=%ct'], dir)).stdout.trim()) || 0
      if (!best || at > best.at) best = { dir, at }
    }
  }
  return best?.dir ?? null
}

async function refresh($: EngineInterface) {
  band.lastRefresh = await $.clock.now()
  if (!follow.dir) follow.dir = await discover($)
  const head = follow.dir ? await git($, ['rev-parse', '--abbrev-ref', 'HEAD']) : { exitCode: 1, stdout: '' }
  if (head.exitCode !== 0) {
    await update($, line, old => ({ ...EMPTY, departedAt: old.departedAt }))
    return
  }
  const [log, status, ahead] = await Promise.all([
    git($, ['log', '-n', '12', '--format=%h%x09%s']),
    git($, ['status', '--porcelain']),
    git($, ['rev-list', '--count', '@{u}..HEAD']),
  ])
  const s = parseStatus(status.stdout)
  await update($, line, old => ({
    repo: true,
    name: (follow.dir ?? '').split(/[\\/]/).pop() ?? '',
    branch: head.stdout.trim(),
    commits: parseLog(log.stdout),
    dirty: s.dirty,
    conflict: s.conflict,
    ahead: ahead.exitCode === 0 ? Number(ahead.stdout.trim()) || 0 : 0,
    departedAt: old.departedAt,
  }))
}

async function paint($: EngineInterface) {
  const m = band.mount
  if (!m || !(await read($, shown))) return
  const now = await $.clock.now()
  const cells = encode(frame(await read($, line), now - band.startedAt, now, m.columns))
  if (cells === band.last) return
  band.last = cells
  if (!band.blit) return
  const r = await $.ui.blit({ requestId: m.requestId, key: 'line', cells })
  if ('deny' in r && r.deny) {
    band.blit = false
    $.ui.invalidate('ui.render')
  }
}

export const register: Register = hook => {
  hook('session.start', async ($, e, next) => {
    band.startedAt = await $.clock.now()
    await $.command.register({ name: 'clawd-commute', description: 'Show or hide your branch as a tram line above the prompt', immediate: true })
    void refresh($)
    if (e.isInteractive) $.clock.every(FRAME_MS, () => void paint($))
    return next(e)
  })

  hook('command.run', { command: 'clawd-commute' }, async $ => {
    const now = !(await read($, shown))
    await update($, shown, () => now)
    if (now) await refresh($)
    return { text: now ? 'Clawd Commute: on.' : 'Clawd Commute: off.' }
  })

  // Anything that can move the repo: look again afterwards, at most every 3 s.
  hook('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.tool === 'Bash' && /\bgit\s+push\b/.test(String(e.command ?? '')) && ran.deny === undefined && ran.isError !== true) {
      const now = await $.clock.now()
      await update($, line, old => ({ ...old, departedAt: now }))
      $.ui.toast('Clawd Commute: the tram has departed (pushed)')
    }
    const hint = hintDir(e.tool, e as unknown as Record<string, unknown>)
    if (hint) {
      const dir = /^([a-zA-Z]:)?[\\/]/.test(hint) ? hint : `${await $.session.cwd()}/${hint}`
      const top = await toplevel($, dir)
      if (top && top !== follow.dir) {
        follow.dir = top
        void refresh($)
        return ran
      }
    }
    const touches = e.tool === 'Bash' || e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'NotebookEdit'
    if (touches && (await $.clock.now()) - band.lastRefresh > 3000) void refresh($)
    return ran
  })

  hook('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const columns = Math.min(e.props.bodyColumns, e.viewport?.columns ?? e.props.bodyColumns) - EDGE
    if (e.props.hasSurvey || e.surface !== 'terminal' || columns < 40 || !(await read($, shown))) {
      band.mount = null
      return next(e)
    }
    const { Raster, Box } = $.ui.resolve(e)
    const now = await $.clock.now()
    const current: Line = await read($, line)
    if (band.mount?.requestId !== e.requestId) band.blit = true
    band.mount = { requestId: e.requestId, columns }
    const cells = encode(frame(current, now - band.startedAt, now, columns))
    band.last = cells
    const below = await next(e)
    return (
      <Box flexDirection="column">
        <Raster key="line" columns={columns} rows={ROWS} cells={cells} />
        {below}
      </Box>
    )
  })
}
