import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Line, Meter } from '../types'
import { HISTORY } from './history'

const EMPTY: Meter = { tokens: 0, cache: 0, input: 0, output: 0, weekLast: null, weekUsed: 0 }
const session = atom({ plugin: 'token-meter', key: 'meter' } as const, EMPTY)
const line = atom({ plugin: 'token-meter', key: 'line' } as const, null as Line | null)

const LABELS: Record<string, string> = { five_hour: '5 h', seven_day: 'semaine' }

export const fmt = (n: number) =>
  (n >= 1e9 ? `${(n / 1e9).toFixed(2)} Md` : n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : `${n}`).replace('.', ',')
const usd = (n: number) => `${n.toFixed(2).replace('.', ',')} $`

const hex = (h: number, s = 0.9, l = 0.5) => {
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

// green (hue 120) to red (0) at 200k, then through magenta to violet (280) at 400k and beyond
export const contextColor = (tokens: number) =>
  hex(tokens <= 200e3 ? 120 - (120 * tokens) / 200e3 : 360 - (80 * Math.min(tokens - 200e3, 200e3)) / 200e3)

let saving: Promise<unknown> = Promise.resolve()

// ponytail: one write at a time within a session; two sessions writing in the same instant can
// lose a request's count. Upgrade to per-session keys summed at load if that ever matters.
async function addGlobal($: EngineInterface, n: number, c: number) {
  saving = saving
    .catch(() => undefined)
    .then(async () => {
      const l = await live($)
      await $.store.set('total', { since: HISTORY.through, tokens: l.tokens + n, cache: l.cache + c })
    })
  await saving
}

// tokens counted live since the last import; a new import (another `through`) starts it over
async function live($: EngineInterface) {
  const v = (await $.store.get('total')) as { since?: string; tokens?: number; cache?: number } | undefined
  return v?.since === HISTORY.through
    ? { tokens: Number(v.tokens) || 0, cache: Number(v.cache) || 0 }
    : { tokens: 0, cache: 0 }
}

async function show($: EngineInterface, usage: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>, monthlyUsd: number) {
  const week = usage.rateLimits.find(r => r.kind === 'seven_day')?.percentUsed
  const m = await update($, session, m => {
    if (week === undefined) return m
    // a drop means the weekly window reset: all of `week` was used since
    const gained = m.weekLast === null ? 0 : week >= m.weekLast ? week - m.weekLast : week
    return { ...m, weekLast: week, weekUsed: m.weekUsed + gained }
  })
  const l = await live($)

  // ponytail: the weekly % is account-wide, so parallel sessions inflate this; it amortizes
  // the monthly price over 52/12 weeks of fully used quota. Upgrade if that model is too rough.
  const subscriptionUsd = (m.weekUsed / 100) * monthlyUsd * (12 / 52)

  const rest = [
    `session : ${fmt(m.tokens)} (dont cache ${fmt(m.cache)}, entrée ${fmt(m.input)}, sortie ${fmt(m.output)})`,
    `global : ${fmt(HISTORY.tokens + l.tokens)} (dont cache ${fmt(HISTORY.cache + l.cache)})`,
    usage.cost && `api : ${usd(usage.cost.usd)}`,
    usage.rateLimits.length > 0 &&
      `abo : ${usage.rateLimits.map(r => `${r.percentUsed} % (${LABELS[r.kind] ?? r.kind})`).join(', ')}`,
    monthlyUsd > 0 && week !== undefined && `≈ ${usd(subscriptionUsd)} d'abonnement`,
  ]
    .filter(Boolean)
    .join(' · ')
  await update($, line, () => ({ context: usage.context.tokens ?? null, window: usage.context.window, rest }))
}

export const register: Register = (on, options) => {
  const monthlyUsd = Number(options.subscriptionUsd) || 0

  // after each main-thread turn, and whenever a rate-limit window moves
  on('session.measure', async ($, e, next) => {
    await show($, e, monthlyUsd)
    return next(e)
  })

  // a band above the prompt, since the status line draws no colors
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const l = await read($, line)
    if (e.props.hasSurvey || l === null) return next(e)

    const { Text } = $.ui.resolve(e)
    return (
      <Text>
        {l.context !== null && (
          <Text color={contextColor(l.context)}>
            Contexte : {fmt(l.context)} / {fmt(l.window)} ·{' '}
          </Text>
        )}
        <Text color="suggestion">{l.rest}</Text>
      </Text>
    )
  })

  // every model request, main thread and subagents: the live part
  on('turn.step', async function* ($, e, next) {
    const { usage: u } = yield* next(e)
    if (!u) return

    const c = u.cache_read_input_tokens + u.cache_creation_input_tokens
    const n = u.input_tokens + u.output_tokens + c
    await update($, session, m => ({
      ...m,
      tokens: m.tokens + n,
      cache: m.cache + c,
      input: m.input + u.input_tokens,
      output: m.output + u.output_tokens,
    }))
    await addGlobal($, n, c)
    await show($, await $.session.usage(), monthlyUsd)
  })
}
