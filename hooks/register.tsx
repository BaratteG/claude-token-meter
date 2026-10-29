import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { CompactAt, Meter, Run, Runs, Segment } from '../types'
import { HISTORY } from './history'

const EMPTY: Meter = { tokens: 0, cache: 0, input: 0, output: 0 }
const session = atom({ plugin: 'token-meter', key: 'meter' } as const, EMPTY)
const compactAt = atom({ plugin: 'token-meter', key: 'compactAt' } as const, null as CompactAt | null)
// the rows drawn under the prompt's hint line, each a run of styled segments
const meterRows = atom({ plugin: 'token-meter', key: 'rows' } as const, [] as Segment[][])
const runs = atom({ plugin: 'token-meter', key: 'runs' } as const, { agents: {} } as Runs)

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7j' }
// one per group, two columns wide; the person's font draws all but the context's in one color, so
// they take ICON_COLOR (the plain set, if a font draws them in their own: ◐ ◷ ↻ ● ∑)
const ICONS = { context: '🧠', quota: '⏳', reset: '🔄', session: '💬', global: '📈', model: '🤖', agents: '👥' }
// a quota's own icon, by window; another kind takes ICONS.quota
const QUOTA_ICONS: Record<string, string> = { five_hour: '🕔', seven_day: '📅' }
// the labels' gray (the dark theme's `inactive`, #999999) 20 % darker; no theme color is read
const ICON_COLOR = '#7a7a7a'
// each window's length, to draw how far into it we are
const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3600e3, seven_day: 7 * 86400e3 }

export const fmt = (n: number) =>
  (n >= 1e9 ? `${(n / 1e9).toFixed(2)}Md` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`).replace('.', ',')
// claude-opus-5-5 → Opus 5.5, claude-3-5-haiku-20241022 → Haiku 3.5; an id of another shape as given
export const modelName = (id: string) => {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(id)
  const old = /claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)/.exec(id)
  const [family, major, minor] = m ? [m[1], m[2], m[3]] : old ? [old[3], old[1], old[2]] : []
  return family ? `${family[0].toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}` : id
}
const effortName = (e: Run['effort']) => (typeof e === 'number' ? fmt(e) : e)
// an agent the engine still runs; a teammate waiting for a message is idle and drops out
const ACTIVE = new Set(['pending', 'running', 'waiting'])

const usd = (n: number) => `${n.toFixed(2).replace('.', ',')} $`

// time to a window's reset, to the minute: 3j4h, 2h05, 12min
const left = (ms: number) => {
  const m = Math.max(0, Math.ceil(ms / 60e3))
  const d = Math.floor(m / 1440)
  const h = Math.floor(m / 60) % 24
  return d > 0 ? `${d}j${h}h` : h > 0 ? `${h}h${String(m % 60).padStart(2, '0')}` : `${m}min`
}

const hex = (h: number, s = 0.9, l = 0.5) => {
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

// green (hue 120) when empty, through yellow, to red (0) when full
export const levelColor = (percent: number) => hex(120 - 1.2 * Math.max(0, Math.min(100, percent)))

// a thin 10-cell bar, one cell per 10 %: the filled part colored by level unless told, the rest dim
export const bar = (percent: number, color = levelColor(percent)): Segment[] => {
  const n = Math.round(Math.max(0, Math.min(100, percent)) / 10)
  return [
    { text: '━'.repeat(n), color },
    { text: '─'.repeat(10 - n), dimColor: true },
  ].filter(s => s.text)
}

let saving: Promise<unknown> = Promise.resolve()
// earlier versions pinned the meter as the status line: drop it once per load
let unpinned = false

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

// the token count at which auto-compaction runs, from /context's local estimate (no request)
async function refreshCompactAt($: EngineInterface) {
  const b = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
  if (b) await update($, compactAt, () => ({ tokens: b.isAutoCompactEnabled ? (b.autoCompactThreshold ?? null) : null }))
}

async function show($: EngineInterface, usage: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>) {
  const m = await read($, session)
  const l = await live($)
  // not read yet, after a reload for instance: read it now
  if ((await read($, compactAt)) === null) await refreshCompactAt($)
  // the context fills toward the auto-compaction threshold, or the whole window when it is off
  const limit = (await read($, compactAt))?.tokens ?? usage.context.window
  const now = await $.clock.now()


  // icons in Claude's accent, labels and units subdued, figures bold; groups apart by space alone
  const GAP: Segment = { text: '   ' }
  const icon = (c: string): Segment => ({ text: `${c} `, ...(c !== ICONS.context && { color: ICON_COLOR }) })
  const label = (t: string): Segment => ({ text: `${t} `, color: 'inactive' })
  const unit = (t: string): Segment => ({ text: t, color: 'inactive' })
  const figure = (t: string, color?: string): Segment => ({ text: t, bold: true, ...(color && { color }) })
  const gauge = (c: string, name: string, percent: number, value: string): Segment[] => [
    icon(c),
    label(name),
    ...bar(percent),
    { text: ' ' },
    figure(value, levelColor(percent)),
  ]

  // the first row, every bar: the context, then each quota's use and the time gone in its window,
  // filling toward the reset, with the time left after it
  const bars: Segment[][] = [
    ...(usage.context.tokens !== undefined ? [gauge(ICONS.context, 'ctx', (100 * usage.context.tokens) / limit, fmt(usage.context.tokens))] : []),
    ...usage.rateLimits.map(r => {
      const used = gauge(QUOTA_ICONS[r.kind] ?? ICONS.quota, LABELS[r.kind] ?? r.kind, r.percentUsed, `${r.percentUsed}%`)
      if (!r.resetsAt) return used
      const toReset = Date.parse(r.resetsAt) - now
      const span = WINDOW_MS[r.kind]
      return [
        ...used,
        { text: '  ' },
        icon(ICONS.reset),
        ...(span ? [...bar(100 - (100 * toReset) / span, 'suggestion'), { text: ' ' }] : []),
        unit(left(toReset)),
      ]
    }),
  ]
  // the model and effort of a loop's last request
  const run = (r: Run): Segment[] => [figure(modelName(r.model)), ...(r.effort !== undefined ? [unit(` · ${effortName(r.effort)}`)] : [])]
  const rs = await read($, runs)

  // the second row: the main loop's model, this session's tokens and what they cost, then the total over every session
  const figures: Segment[] = [
    ...(rs.main ? [icon(ICONS.model), ...run(rs.main), GAP] : []),
    icon(ICONS.session),
    label('session'),
    figure(fmt(m.tokens)),
    unit(' tokens'),
    ...(usage.cost ? [unit(' · '), figure(usd(usage.cost.usd)), unit(' API')] : []),
    GAP,
    icon(ICONS.global),
    label('global'),
    figure(fmt(HISTORY.tokens + l.tokens)),
    unit(' tokens'),
  ]

  // the third row, while subagents run: each one's type, model and effort
  const agents = Object.keys(rs.agents).length > 0 ? (await $.agent.list()).filter(a => rs.agents[a.id] && ACTIVE.has(a.status)) : []
  const parallel: Segment[] = agents.flatMap((a, i) => [...(i > 0 ? [GAP] : [icon(ICONS.agents)]), label(a.type), ...run(rs.agents[a.id])])

  const rows = [
    ...(bars.length > 0 ? [bars.flatMap((g, i) => (i > 0 ? [GAP, ...g] : g))] : []),
    figures,
    ...(parallel.length > 0 ? [parallel] : []),
  ]
  await update($, meterRows, () => rows)
  if (!unpinned) {
    unpinned = true
    $.ui.status(undefined)
  }
}

export const register: Register = on => {
  // after each main-thread turn, and whenever a rate-limit window moves
  on('session.measure', async ($, e, next) => {
    // the threshold follows the model and its window: reread it as the context moves
    if (e.changed.includes('context')) await refreshCompactAt($)
    await show($, e)
    return next(e)
  })

  // the countdowns to the resets move while idle: redraw every minute
  on('session.start', async ($, e, next) => {
    if (e.isInteractive) $.clock.every(60e3, async () => show($, await $.session.usage()))
    return next(e)
  })

  // under the prompt's hint line, kept as the engine draws it; the status line folds newlines away
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const hint = await next(e)
    const rows = await read($, meterRows)
    if (rows.length === 0) return hint

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {hint}
        {/* a blank row between the engine's line (the mode, its pills) and the meter, indented as that line is */}
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          {rows.map(r => (
            <Text>{r.map(({ text, ...style }) => (Object.keys(style).length > 0 ? <Text {...style}>{text}</Text> : text))}</Text>
          ))}
        </Box>
      </Box>
    )
  })

  // every model request, main thread and subagents: the live part
  on('turn.step', async function* ($, e, next) {
    const r: Run = { model: e.model, ...(e.effort !== undefined && { effort: e.effort }) }
    const id = e.agentId
    const isNew = id !== undefined && !(await read($, runs)).agents[id]
    await update($, runs, m => (id ? { ...m, agents: { ...m.agents, [id]: r } } : { ...m, main: r }))
    // a subagent's first request: on the agents' row while it waits for the answer
    if (isNew) await show($, await $.session.usage())
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
    await show($, await $.session.usage())
  })

  // a subagent's run is over: off the agents' row
  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id && (await read($, runs)).agents[id]) {
      await update($, runs, m => ({ ...m, agents: Object.fromEntries(Object.entries(m.agents).filter(([k]) => k !== id)) }))
      await show($, await $.session.usage())
    }
    return next(e)
  })
}
