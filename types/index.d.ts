export type Meter = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  // last `seven_day` percentage seen, and the points consumed since the mod loaded
  weekLast: number | null
  weekUsed: number
}

declare module 'claude-code' {
  interface PluginState {
    'token-meter': { meter: Meter }
  }
}
