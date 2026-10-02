export type Commit = { sha: string; subject: string }
export type Line = {
  repo: boolean
  name: string  // the repo's folder name
  branch: string
  commits: Commit[]  // oldest first
  dirty: number  // files changed, not committed
  ahead: number  // commits not pushed (0 without an upstream)
  conflict: boolean
  departedAt: number | null  // when a push left the station
}

declare module 'claude-code' {
  interface PluginState {
    'clawd-commute': { line: Line; shown: boolean }
  }
}
