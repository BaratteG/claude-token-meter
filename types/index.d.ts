export type Meter = {
  // every token of every model request this session: input, output, cache reads and writes
  tokens: number
  // last `seven_day` percentage seen, and the points consumed since the mod loaded
  weekLast: number | null
  weekUsed: number
}

declare module 'claude-code' {
  interface PluginState {
    'token-meter': { session: Meter }
  }
}
