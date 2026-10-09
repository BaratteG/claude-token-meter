import { atom, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Meter } from '../types'

const EMPTY: Meter = { tokens: 0, weekLast: null, weekUsed: 0 }
const session = atom({ plugin: 'token-meter', key: 'session' } as const, EMPTY)

const LABELS: Record<string, string> = { five_hour: '5 h', seven_day: 'semaine' }

const fmt = (n: number) =>
  (n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : `${n}`).replace('.', ',')
const usd = (n: number) => `${n.toFixed(2).replace('.', ',')} $`

let saving: Promise<unknown> = Promise.resolve()

// ponytail: one write at a time within a session; two sessions writing in the same instant can
// lose a request's count. Upgrade to per-session keys summed at load if that ever matters.
async function addGlobal($: EngineInterface, n: number) {
  saving = saving
    .catch(() => undefined)
    .then(async () => $.store.set('total', Number((await $.store.get('total')) ?? 0) + n))
  await saving
}

async function show($: EngineInterface, usage: Pick<SessionUsage, 'rateLimits' | 'cost'>, monthlyUsd: number) {
  const week = usage.rateLimits.find(r => r.kind === 'seven_day')?.percentUsed
  const m = await update($, session, m => {
    if (week === undefined) return m
    // a drop means the weekly window reset: all of `week` was used since
    const gained = m.weekLast === null ? 0 : week >= m.weekLast ? week - m.weekLast : week
    return { ...m, weekLast: week, weekUsed: m.weekUsed + gained }
  })
  const total = Number((await $.store.get('total')) ?? 0)

  // ponytail: the weekly % is account-wide, so parallel sessions inflate this; it amortizes
  // the monthly price over 52/12 weeks of fully used quota. Upgrade if that model is too rough.
  const subscriptionUsd = (m.weekUsed / 100) * monthlyUsd * (12 / 52)

  $.ui.status(
    [
      `Tokens session : ${fmt(m.tokens)}`,
      `global : ${fmt(total)}`,
      usage.cost && `coût API session : ${usd(usage.cost.usd)}`,
      usage.rateLimits.length > 0 &&
        `abonnement utilisé : ${usage.rateLimits.map(r => `${r.percentUsed} % (${LABELS[r.kind] ?? r.kind})`).join(', ')}`,
      monthlyUsd > 0 && week !== undefined && `≈ ${usd(subscriptionUsd)} d'abonnement`,
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

    const n = u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
    await update($, session, m => ({ ...m, tokens: m.tokens + n }))
    await addGlobal($, n)
    await show($, await $.session.usage(), monthlyUsd)
  })
}
