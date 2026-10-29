export type Meter = {
  // every token of every model request this session: input, output, cache reads and writes
  tokens: number
  // the part of `tokens` read from or written to the prompt cache
  cache: number
  // the parts of `tokens` sent outside the cache, and generated
  input: number
  output: number
}

// the auto-compaction threshold as last read; `tokens` null when auto-compaction is off
export type CompactAt = { tokens: number | null }

// a run of text in a row under the prompt, with its style
export type Segment = { text: string; color?: string; dimColor?: boolean; bold?: boolean }

// what a model loop last sent its requests with: the model's id, the effort when the model takes one
export type Run = { model: string; effort?: string | number }
// the main loop's, absent before its first request, and each subagent's still running, by id
export type Runs = { main?: Run; agents: Record<string, Run> }

declare module 'claude-code' {
  interface PluginState {
    'token-meter': { meter: Meter; compactAt: CompactAt | null; rows: Segment[][]; runs: Runs }
  }
}
