import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'

// the engine beneath the plugin: 1000 in / 200 out / 5000 cache read per request, $1.50 spent
const world = (on: On) => {
  const lines: (string | undefined)[] = []
  on('ui.status', ($, e) => (lines.push(e.text), { value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [], cost: { usd: 1.5 } } }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.step', async function* ($, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { model: 'm', input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 },
    }
  })
  return lines
}

const step = async ($: Engine, index: number) => {
  const s = $.turn.step({ turnId: 't', index, model: 'm', messageCount: 1 })
  for await (const _ of s);
  await s.result
}

const measure = ($: Engine, rateLimits: SessionRateLimit[]) =>
  $.session.measure({ context: { window: 200000 }, rateLimits, cost: { usd: 1.5 }, changed: ['rateLimits'] })

test('sums tokens over requests and shows the API cost', async ($, on) => {
  const lines = world(on)
  await step($, 0)
  await step($, 1)
  expect(lines.at(-1)).toBe('12.4k tokens (in 2.0k · out 400 · cache 10.0k) · API $1.50')
})

test('prices the weekly quota used, across a window reset', { options: { subscriptionUsd: 200 } }, async ($, on) => {
  const lines = world(on)
  await measure($, [{ kind: 'five_hour', percentUsed: 3 }, { kind: 'seven_day', percentUsed: 10 }])
  expect(lines.at(-1)).toContain('5h 3% · 7j 10% · Abo ≈ $0.00')
  await measure($, [{ kind: 'seven_day', percentUsed: 15 }])
  expect(lines.at(-1)).toContain('Abo ≈ $2.31') // 5% of 200 * 12/52
  await measure($, [{ kind: 'seven_day', percentUsed: 2 }])
  expect(lines.at(-1)).toContain('Abo ≈ $3.23') // reset: +2 points
})
