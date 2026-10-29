import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'

import { HISTORY } from './history'
import { bar, fmt, levelColor, modelName } from './register'

// the engine beneath the plugin: 1000 in / 200 out / 5000 cache read per request, $1.50 spent
// auto-compaction at 125k by default; `null` turns it off
const world = (on: On, store: Record<string, unknown> = {}, rateLimits: SessionRateLimit[] = [], threshold: number | null = 125_000) => {
  mock.store(on, store)
  on('ui.status', () => ({ value: undefined }))
  // the engine's own hint line
  on('ui.render', { component: 'PromptHint' }, () => ({ type: 'Text' as const, children: ['? for shortcuts'] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  const breakdown = { isAutoCompactEnabled: threshold !== null, ...(threshold !== null && { autoCompactThreshold: threshold }) } as never
  on('session.usage', ($, e) => ({
    value: { startedAt: 0, context: { tokens: 50_000, window: 200_000, ...(e.breakdown && { breakdown }) }, rateLimits, cost: { usd: 1.5 } },
  }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))
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

const step = async ($: Engine, index: number, run: { model?: string; effort?: 'low' | 'high'; agentId?: string } = {}) => {
  const s = $.turn.step({ turnId: 't', index, model: 'claude-opus-5-5', effort: 'high', messageCount: 1, ...run })
  for await (const _ of s);
  await s.result
}

// the tree drawn at the bottom: the engine's hint line, then the meter's rows
const drawn = async ($: Engine) =>
  (
    await $.ui.mount({
      plugin: 'token-meter',
      surface: 'terminal',
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })
  ).drawn()

// the same as text, one entry per row
const bottom = async ($: Engine) => {
  const d = await drawn($)
  if (d.type !== 'Box') return [textOf(d)]
  const [hint, meter] = (d.children ?? []) as { children?: unknown[] }[]
  return [textOf(hint), ...(meter?.children ?? []).map(textOf)]
}

// the meter's block under the hint line, and its rows
const meter = async ($: Engine) => ((await drawn($)).children ?? [])[1] as { props?: object; children?: unknown[] }

const textOf = (n: unknown): string =>
  typeof n === 'string' ? n : ((n as { children?: unknown[] }).children ?? []).map(textOf).join('')

// the meter's lines, one per row
const status = async ($: Engine) => (await bottom($)).slice(1).join('\n')

// the styled pieces of the meter's first row, by the text each draws
const firstRow = async ($: Engine) => {
  const row = ((await meter($)).children ?? [])[0] as { children?: unknown[] }
  const pieces = (row.children ?? []).map(c => (typeof c === 'string' ? { text: c, props: {} } : { text: textOf(c), props: (c as { props?: object }).props ?? {} }))
  return (text: string) => pieces.filter(p => p.text === text).map(p => p.props)
}

const measure = ($: Engine, rateLimits: SessionRateLimit[]) =>
  $.session.measure({ context: { window: 200000 }, rateLimits, cost: { usd: 1.5 }, changed: ['rateLimits'] })

test('counts session tokens and adds them to the history and live global total', async ($, on) => {
  world(on, { total: { since: HISTORY.through, tokens: 1_000_000, cache: 900_000 } })
  await step($, 0)
  await step($, 1)
  expect((await status($))).toBe(
    ['🧠 ctx ━━━━────── 50k', `🤖 Opus 5.5 · high   💬 session 12k tokens · 1,50 $ API   📈 global ${fmt(HISTORY.tokens + 1_012_400)} tokens`].join('\n'),
  )
})

test('a count from before the last import starts over', async ($, on) => {
  world(on, { total: 1_000_000 })
  await step($, 0)
  expect((await status($))).toContain(`📈 global ${fmt(HISTORY.tokens + 6_200)} tokens`)
})

test('draws a bar per quota', async ($, on) => {
  world(on)
  await measure($, [{ kind: 'five_hour', percentUsed: 3 }, { kind: 'seven_day', percentUsed: 10 }])
  expect((await status($))).toBe(
    `🕔 5h ────────── 3%   📅 7j ━───────── 10%\n💬 session 0 tokens · 1,50 $ API   📈 global ${fmt(HISTORY.tokens)} tokens`,
  )
})

test('counts down to each window reset, redrawn every minute', async ($, on) => {
  const clock = world(on, {}, [
    { kind: 'five_hour', percentUsed: 3, resetsAt: '2026-10-12T12:05:00Z' },
    { kind: 'seven_day', percentUsed: 10, resetsAt: '2026-10-15T14:00:00Z' },
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(60e3)
  expect((await status($))).toContain('   🕔 5h ────────── 3%  🔄 ━━━━━━──── 2h04   📅 7j ━───────── 10%  🔄 ━━━━━───── 3j3h\n')
  await clock.advance(120 * 60e3)
  expect((await status($))).toContain('   🕔 5h ────────── 3%  🔄 ━━━━━━━━━━ 4min   📅 7j ━───────── 10%  🔄 ━━━━━━──── 3j1h\n')
})

test('draws a percentage as a 10-cell bar, one cell per 10 %', async () => {
  expect([0, 4, 5, 37, 100, 120].map(p => bar(p).map(s => s.text).join(''))).toEqual(
    ['──────────', '──────────', '━─────────', '━━━━──────', '━━━━━━━━━━', '━━━━━━━━━━'],
  )
})

test('fills the context bar toward the auto-compaction threshold', async ($, on) => {
  world(on, {}, [], 400_000)
  await step($, 0)
  expect((await status($))).toStartWith('🧠 ctx ━───────── 50k\n')
})

test('without auto-compaction, the context bar fills toward the whole window', async ($, on) => {
  world(on, {}, [], null)
  await step($, 0)
  expect((await status($))).toStartWith('🧠 ctx ━━━─────── 50k\n')
})

test("keeps the engine's hint line above the meter", async ($, on) => {
  world(on)
  expect(await bottom($)).toEqual(['? for shortcuts'])
  await step($, 0)
  const rows = await bottom($)
  expect(rows[0]).toBe('? for shortcuts')
  // one blank row between them
  expect((await meter($)).props).toMatchObject({ marginTop: 1, paddingLeft: 2 })
  expect(rows.slice(1).map(r => r.split(' ')[1])).toEqual(['ctx', 'Opus'])
})

test('colors the filled part green to red by level, dims the rest', async ($, on) => {
  expect([0, 50, 100, 150].map(levelColor)).toEqual(['#0df20d', '#f2f20d', '#f20d0d', '#f20d0d'])
  expect(bar(37)).toEqual([
    { text: '━━━━', color: levelColor(37) },
    { text: '──────', dimColor: true },
  ])
  world(on)
  await step($, 0)
  const piece = await firstRow($)
  // 50k of 125k: 40 %, the filled part and the figure in that level's color
  expect(piece('━━━━')).toEqual([{ color: levelColor(40) }])
  expect(piece('──────')).toEqual([{ dimColor: true }])
  expect(piece('50k')).toEqual([{ bold: true, color: levelColor(40) }])
})

test('draws the time gone in a quota window in a color of its own', async ($, on) => {
  world(on, {}, [{ kind: 'five_hour', percentUsed: 3, resetsAt: '2026-10-12T12:30:00Z' }], null)
  await measure($, [{ kind: 'five_hour', percentUsed: 3, resetsAt: '2026-10-12T12:30:00Z' }])
  const piece = await firstRow($)
  // 2h30 left of 5h: half the window gone
  expect(piece('━━━━━')).toEqual([{ color: 'suggestion' }])
  expect(piece('2h30')).toEqual([{ color: 'inactive' }])
})

test('marks each group with an icon, its label subdued', async ($, on) => {
  world(on, {}, [{ kind: 'five_hour', percentUsed: 3, resetsAt: '2026-10-12T12:30:00Z' }])
  await step($, 0)
  const piece = await firstRow($)
  // the context's emoji keeps its own colors, the other icons take a gray a shade under the labels'
  expect(piece('🧠 ')).toEqual([{}])
  expect([...piece('🕔 '), ...piece('🔄 ')]).toEqual([{ color: '#7a7a7a' }, { color: '#7a7a7a' }])
  expect([...piece('ctx '), ...piece('5h ')]).toEqual([{ color: 'inactive' }, { color: 'inactive' }])
})

test('names a model by its family and version', async () => {
  expect(['claude-opus-5-5', 'claude-haiku-4-5-20251001', 'claude-opus-4-20250514', 'claude-3-5-haiku-20241022', 'claude-sonnet-5-5[1m]', 'm'].map(modelName)).toEqual(
    ['Opus 5.5', 'Haiku 4.5', 'Opus 4', 'Haiku 3.5', 'Sonnet 5.5', 'm'],
  )
})

test('lists the subagents running, each with its model and effort, until its run ends', async ($, on) => {
  world(on)
  const status = { a1: 'running', a2: 'running', a3: 'completed' }
  on('agent.list', () => ({
    value: Object.entries(status).map(([id, s]) => ({ id, description: id, type: { a1: 'scout', a2: 'worker', a3: 'deep' }[id]!, status: s as never })),
  }))
  await step($, 0)
  await step($, 0, { agentId: 'a1', model: 'claude-haiku-5-5', effort: 'low' })
  await step($, 0, { agentId: 'a2', model: 'claude-sonnet-5-5' })
  await step($, 0, { agentId: 'a3', model: 'claude-opus-5-5' })
  expect((await bottom($)).at(-1)).toBe('👥 scout Haiku 5.5 · low   worker Sonnet 5.5 · high')
  await $.turn.complete({ turnId: 't', agentId: 'a1', answer: '', durationMs: 0, isAborted: false, reason: 'answer' })
  expect((await bottom($)).at(-1)).toBe('👥 worker Sonnet 5.5 · high')
  await $.turn.complete({ turnId: 't', agentId: 'a2', answer: '', durationMs: 0, isAborted: false, reason: 'answer' })
  expect((await bottom($)).at(-1)).toStartWith('🤖 Opus 5.5 · high   💬 session')
})
