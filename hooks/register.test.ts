import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'

import { HISTORY } from './history'
import { contextColor, fmt } from './register'

// the engine beneath the plugin: 1000 in / 200 out / 5000 cache read per request, $1.50 spent
const world = (on: On, store: Record<string, unknown> = {}, rateLimits: SessionRateLimit[] = []) => {
  mock.store(on, store)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 50_000, window: 200_000 }, rateLimits, cost: { usd: 1.5 } } }))
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
  return mock.clock(on, { now: Date.parse('2026-10-12T10:00:00Z') })
}

const step = async ($: Engine, index: number) => {
  const s = $.turn.step({ turnId: 't', index, model: 'm', messageCount: 1 })
  for await (const _ of s);
  await s.result
}

// the band above the prompt as the terminal draws it: its outer Text
const band = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: 'token-meter', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } as never })
  return ui.find({ type: 'Text' })
}

const measure = ($: Engine, rateLimits: SessionRateLimit[]) =>
  $.session.measure({ context: { window: 200000 }, rateLimits, cost: { usd: 1.5 }, changed: ['rateLimits'] })

test('counts session tokens and adds them to the history and live global total', async ($, on) => {
  world(on, { total: { since: HISTORY.through, tokens: 1_000_000, cache: 900_000 } })
  await step($, 0)
  await step($, 1)
  expect((await band($))?.text).toBe(
    `Contexte : 50,0 k / 200,0 k · session : 12,4 k (dont cache 10,0 k, entrée 2,0 k, sortie 400) · global : ${fmt(HISTORY.tokens + 1_012_400)}` +
      ` (dont cache ${fmt(HISTORY.cache + 910_000)}) · api : 1,50 $`,
  )
})

test('a count from before the last import starts over', async ($, on) => {
  world(on, { total: 1_000_000 })
  await step($, 0)
  expect((await band($))?.text).toContain(`global : ${fmt(HISTORY.tokens + 6_200)} (dont cache ${fmt(HISTORY.cache + 5_000)})`)
})

test('prices the weekly quota used, across a window reset', { options: { subscriptionUsd: 200 } }, async ($, on) => {
  world(on)
  await measure($, [{ kind: 'five_hour', percentUsed: 3 }, { kind: 'seven_day', percentUsed: 10 }])
  expect((await band($))?.text).toContain("abo : 3 % (5 h), 10 % (semaine) · ≈ 0,00 $ d'abo")
  await measure($, [{ kind: 'seven_day', percentUsed: 15 }])
  expect((await band($))?.text).toContain("≈ 2,31 $ d'abo") // 5% of 200 * 12/52
  await measure($, [{ kind: 'seven_day', percentUsed: 2 }])
  expect((await band($))?.text).toContain("≈ 3,23 $ d'abo") // reset: +2 points
})

test('counts down to each window reset, redrawn every minute', async ($, on) => {
  const clock = world(on, {}, [
    { kind: 'five_hour', percentUsed: 3, resetsAt: '2026-10-12T12:05:00Z' },
    { kind: 'seven_day', percentUsed: 10, resetsAt: '2026-10-15T14:00:00Z' },
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(60e3)
  expect((await band($))?.text).toContain('abo : 3 % (5 h, reset dans 2 h 04), 10 % (semaine, reset dans 3 j 3 h)')
  await clock.advance(120 * 60e3)
  expect((await band($))?.text).toContain('3 % (5 h, reset dans 4 min), 10 % (semaine, reset dans 3 j 1 h)')
})

test('colors the context green, red at 300k, violet from 500k', async ($, on) => {
  expect([0, 150e3, 300e3, 400e3, 500e3, 900e3].map(contextColor)).toEqual(
    ['#0df20d', '#f2f20d', '#f20d0d', '#f20da6', '#a60df2', '#a60df2'],
  )
  world(on)
  await step($, 0)
  const b = await band($)
  expect(b?.children[0]).toMatchObject({ props: { color: contextColor(50e3) } })
  expect(b?.children[1]).toMatchObject({ props: { color: 'suggestion' } })
})
