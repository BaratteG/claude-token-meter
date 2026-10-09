import { atom, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Meter } from '../types'

const EMPTY: Meter = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, weekLast: null, weekUsed: 0 }
const meter = atom({ plugin: 'token-meter', key: 'meter' } as const, EMPTY)

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7j' }

const fmt = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`

async function show($: EngineInterface, usage: Pick<SessionUsage, 'rateLimits' | 'cost'>, monthlyUsd: number) {
  const week = usage.rateLimits.find(r => r.kind === 'seven_day')?.percentUsed
  const m = await update($, meter, m => {
    if (week === undefined) return m
    // a drop means the weekly window reset: all of `week` was used since
    const gained = m.weekLast === null ? 0 : week >= m.weekLast ? week - m.weekLast : week
    return { ...m, weekLast: week, weekUsed: m.weekUsed + gained }
  })

  // ponytail: the weekly % is account-wide, so parallel sessions inflate "Abo"; it amortizes
  // the monthly price over 52/12 weeks of fully used quota. Upgrade if that model is too rough.
  const subscriptionUsd = (m.weekUsed / 100) * monthlyUsd * (12 / 52)

  $.ui.status(
    [
      `${fmt(m.input + m.output + m.cacheRead + m.cacheWrite)} tokens` +
        ` (in ${fmt(m.input)} · out ${fmt(m.output)} · cache ${fmt(m.cacheRead + m.cacheWrite)})`,
      usage.cost && `API $${usage.cost.usd.toFixed(2)}`,
      ...usage.rateLimits.map(r => `${LABELS[r.kind] ?? r.kind} ${r.percentUsed}%`),
      monthlyUsd > 0 && week !== undefined && `Abo ≈ $${subscriptionUsd.toFixed(2)}`,
    ]
      .filter(Boolean)
      .join(' · '),
  )
}

export const register: Register = (on, options) => {
  const monthlyUsd = Number(options.subscriptionUsd) || 0

  // after each main-thread turn, and whenever a rate-limit window moves
  on('session.measure', async ($, e, next) => {
    await show($, e, monthlyUsd)
    return next(e)
  })

  // every model request, main thread and subagents: the live part
  on('turn.step', async function* ($, e, next) {
    const { usage: u } = yield* next(e)
    if (!u) return

    await update($, meter, m => ({
      ...m,
      input: m.input + u.input_tokens,
      output: m.output + u.output_tokens,
      cacheRead: m.cacheRead + u.cache_read_input_tokens,
      cacheWrite: m.cacheWrite + u.cache_creation_input_tokens,
    }))
    await show($, await $.session.usage(), monthlyUsd)
  })
}
