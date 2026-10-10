export type Meter = {
  // every token of every model request this session: input, output, cache reads and writes
  tokens: number
  // the part of `tokens` read from or written to the prompt cache
  cache: number
  // the parts of `tokens` sent outside the cache, and generated
  input: number
  output: number
  // last `seven_day` percentage seen, and the points consumed since the mod loaded
  weekLast: number | null
  weekUsed: number
}

// what the band above the prompt draws: the context, colored by size, then the rest
export type Line = { context: number | null; window: number; rest: string }

declare module 'claude-code' {
  interface PluginState {
    'token-meter': { meter: Meter; line: Line | null }
  }
}
