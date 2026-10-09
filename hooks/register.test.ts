import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'

import { HISTORY } from './history'
import { fmt } from './register'

// the engine beneath the plugin: 1000 in / 200 out / 5000 cache read per request, $1.50 spent
const world = (on: On, store: Record<string, unknown> = {}) => {
  mock.store(on, store)
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

test('counts session tokens and adds them to the history and live global total', async ($, on) => {
  const lines = world(on, { total: { since: HISTORY.through, tokens: 1_000_000, cache: 900_000 } })
  await step($, 0)
  await step($, 1)
  expect(lines.at(-1)).toBe(
    `Tokens session : 12,4 k (dont cache 10,0 k) · global : ${fmt(HISTORY.tokens + 1_012_400)}` +
      ` (dont cache ${fmt(HISTORY.cache + 910_000)}) · coût API session : 1,50 $`,
  )
})

test('a count from before the last import starts over', async ($, on) => {
  const lines = world(on, { total: 1_000_000 })
  await step($, 0)
  expect(lines.at(-1)).toContain(`global : ${fmt(HISTORY.tokens + 6_200)} (dont cache ${fmt(HISTORY.cache + 5_000)})`)
})

test('prices the weekly quota used, across a window reset', { options: { subscriptionUsd: 200 } }, async ($, on) => {
  const lines = world(on)
  await measure($, [{ kind: 'five_hour', percentUsed: 3 }, { kind: 'seven_day', percentUsed: 10 }])
  expect(lines.at(-1)).toContain("abonnement utilisé : 3 % (5 h), 10 % (semaine) · ≈ 0,00 $ d'abonnement")
  await measure($, [{ kind: 'seven_day', percentUsed: 15 }])
  expect(lines.at(-1)).toContain("≈ 2,31 $ d'abonnement") // 5% of 200 * 12/52
  await measure($, [{ kind: 'seven_day', percentUsed: 2 }])
  expect(lines.at(-1)).toContain("≈ 3,23 $ d'abonnement") // reset: +2 points
})
