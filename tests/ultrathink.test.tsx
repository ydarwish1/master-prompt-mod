import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelCompleteResult, On, RenderSurface } from 'claude-code'

import { RAINBOW, boosted, capSvg, cleanReply, letters, masterAsk, noteFor, skillBody } from '../hooks/bar'

const band = <S extends RenderSurface>(surface: S, isWorking = false) =>
  ({
    plugin: 'ultrathink-mod',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  }) as const

// Nothing sits beneath the plugin: these hooks stand for the engine, and
// record the effort each request reaches it with and each command run.
// With `isClockMocked`, the test's mock.clock answers $.clock instead.
function engine(on: On, contextPercent = 9, isClockMocked = false) {
  const efforts: unknown[] = []
  const contexts: (readonly string[])[] = []
  const runs: string[] = []
  const toasts: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'ultra' } }))
  on('command.run', (_, e) => {
    runs.push(e.command)
    return { text: '' }
  })
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 18000, window: 200000, percent: contextPercent },
      rateLimits: [
        { kind: 'seven_day', percentUsed: 42 },
        { kind: 'five_hour', percentUsed: 5 },
      ],
    },
  }))
  on('prompt.submit', (_, e) => {
    contexts.push(e.context ?? [])
    return { text: e.text, context: e.context }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    efforts.push(e.agentId ? `${e.agentId}:${e.effort}` : e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? ''))
    return { value: undefined }
  })
  if (!isClockMocked) {
    on('clock.now', () => ({ value: 1_000_000 }))
    on('clock.every', () => ({ value: undefined }))
    on('clock.after', () => ({ value: undefined }))
  }
  // The engine's own band beneath: an empty box.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return { efforts, contexts, runs, toasts }
}

async function step($: Engine, turnId: string, index: number, effort: string, agentId?: string, model = 'claude-opus-5-5') {
  const stream = $.turn.step({ turnId, index, model, effort: effort as 'medium', messageCount: 1, ...(agentId ? { agentId } : {}) })
  let r = await stream.next()
  while (!r.done) r = await stream.next()
}

const start = ($: Engine, turnId: string) => $.turn.start({ text: 'go', turnId })
const complete = ($: Engine, turnId: string) =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'answer' })
const submit = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
const ultra = ($: Engine) =>
  $.command.run({ command: 'ultra', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

const SKILL_MD = '---\nname: be-ambitious\ndescription: test\n---\n\n# Be ambitious\n\nAim at the outcome.\n'
const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

// The prompt box, the skill file and the model, as the Master prompt button meets them.
// `drafts` answers each read of the box in turn (the last one repeats); `answer` is the model's reply.
function world(on: On, drafts: string[], answer: () => Promise<ModelCompleteResult>) {
  const filled: { text: string; mode: string }[] = []
  const asks: { model: string; effort: unknown; prompt: string }[] = []
  const forks: string[] = []
  let reads = 0
  mock.env(on, { HOME: '/home/you' })
  on('prompt.read', () => {
    const text = drafts[Math.min(reads++, drafts.length - 1)] ?? ''
    return { value: { text, cursor: text.length } }
  })
  on('fs.list', () => ({ value: [] }))
  // The press's trace file: kept in memory, never written to disk.
  on('fs.write', () => ({ value: undefined }))
  on('fs.read', (_, e) => {
    if (e.path === '/home/you/.claude/skills/be-ambitious/SKILL.md') return { value: SKILL_MD }
    return { deny: 'no such file' }
  })
  on('model.fork', (_, e) => {
    forks.push(e.prompt)
    return { value: { isAnswered: false, reason: 'nothing-to-fork' } }
  })
  on('model.complete', async (_, e) => {
    asks.push({ model: e.model, effort: e.effort, prompt: e.prompt })
    return { value: await answer() }
  })
  on('prompt.fill', (_, e) => {
    filled.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  return { filled, asks, forks }
}

test('the terminal draws circle glyphs and a rainbow Master prompt Button', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Button', key: 'ultrathink' })).toBe(undefined)
  expect((await ui.find({ type: 'Button', key: 'master-prompt' }))?.text).toContain('Master prompt')
  const first = (await ui.findAll({ type: 'Text' })).find(t => t.text === 'M')
  expect(first?.props.color).toBe(RAINBOW[0])
  expect((await ui.find({ type: 'Text', text: '9%' }))?.text).toBe(' 9%')
  expect((await ui.find({ type: 'Text', text: '42%' }))?.text).toBe(' 42%')
  expect((await ui.find({ type: 'Text', text: '◑' }))?.text).toBe('◑')
  await ui.unmount()
})

test('the desktop draws rings and the Master prompt key cap where Ultrathink sat', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Button', key: 'master-prompt' })).toBe(undefined)
  const svgs = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source))
  expect(svgs).toHaveLength(4)
  expect(svgs[3]).toBe(capSvg('rest'))
  expect(capSvg('rest')).toContain(`fill="${RAINBOW[0]}">M<`)
  expect(capSvg('rest')).not.toContain('ultrathink')
  expect(capSvg('on')).toContain('@keyframes')
  expect(capSvg('rest')).not.toContain('@keyframes')
  expect(await ui.find({ type: 'Client', key: 'master-prompt' })).not.toBe(undefined)
  await ui.unmount()
})

test('a click rewrites the draft with be-ambitious and puts the Master prompt in the box', async ($, on) => {
  const { toasts } = engine(on, 9, true)
  const clock = mock.clock(on)
  let release: (() => void) | undefined
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const { filled, asks, forks } = world(on, ['fix the login crash'], async () => {
    await gate
    return { isAnswered: true, text: 'Here it is:\n```\nKeep login crash-free. Judge: zero crashes.\n```', usage }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount(band('desktop'))
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: 'master-prompt' })
  await clock.advance(1)
  // While Claude writes, the cap is on and shimmers.
  expect((await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source))[3]).toBe(capSvg('on'))
  // Claude Opus 5.5 at medium effort writes it, never a fork of the session.
  expect(asks.map(a => [a.model, a.effort])).toEqual([['claude-opus-5-5', 'medium']])
  expect(forks).toEqual([])
  expect(asks[0]?.prompt).toContain('Aim at the outcome.')
  expect(asks[0]?.prompt).not.toContain('description: test')
  expect(asks[0]?.prompt).toContain('<draft>\nfix the login crash\n</draft>')

  release?.()
  await clock.settle()
  expect(filled).toEqual([{ text: 'Keep login crash-free. Judge: zero crashes.', mode: 'replace' }])
  expect((await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source))[3]).toBe(capSvg('rest'))
  expect(toasts.at(-1)).toContain('Master prompt is in the box')
  await ui.unmount()
})

test('an empty draft asks for a prompt first and calls no model', async ($, on) => {
  const { toasts } = engine(on, 9, true)
  const clock = mock.clock(on)
  const { filled, asks } = world(on, ['   '], async () => ({ isAnswered: true, text: 'x', usage }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'master-prompt' })
  await clock.advance(1)
  await ui.unmount()
  expect(asks).toEqual([])
  expect(filled).toEqual([])
  expect(toasts.at(-1)).toContain('Type a prompt first')
})

test('a draft changed while Claude writes is left as it is', async ($, on) => {
  const { toasts } = engine(on, 9, true)
  const clock = mock.clock(on)
  const { filled } = world(on, ['first draft', 'first draft, then more'], async () => ({ isAnswered: true, text: 'Better.', usage }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'master-prompt' })
  await clock.advance(1)
  await ui.unmount()
  expect(filled).toEqual([])
  expect(toasts.at(-1)).toContain('stays as you left it')
})

test('a rewrite that times out leaves the draft as it is', async ($, on) => {
  const { toasts } = engine(on, 9, true)
  const clock = mock.clock(on)
  const { filled, asks } = world(on, ['plan the launch'], async () => ({ isAnswered: false, reason: 'aborted', usage }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'master-prompt' })
  await clock.advance(1)
  await ui.unmount()
  expect(asks.map(a => a.model)).toEqual(['claude-opus-5-5'])
  expect(filled).toEqual([])
  expect(toasts.at(-1)).toContain('Your draft is unchanged')
})

test('/ultra before sending runs only the next message at xhigh, and tells Claude', async ($, on) => {
  const { efforts, contexts } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await ultra($)
  await submit($, 'why is the build slow?')
  expect(contexts[0]).toEqual([noteFor('xhigh')])

  await start($, 't1')
  await step($, 't1', 0, 'medium')
  await step($, 't1', 1, 'medium', 'a1')
  await step($, 't1', 2, 'medium')
  await complete($, 't1')

  await submit($, 'thanks')
  expect(contexts[1]).toEqual([])
  await start($, 't2')
  await step($, 't2', 0, 'medium')

  expect(efforts).toEqual(['xhigh', 'a1:medium', 'xhigh', 'medium'])
})

test('/ultra while Claude works raises the rest of that turn only', async ($, on) => {
  const { efforts } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await start($, 't1')
  await step($, 't1', 0, 'high')
  await ultra($)
  const ui = await $.ui.mount(band('terminal', true))
  // Compact would cut the running turn's own context, so it hides while Claude works.
  expect(await ui.find({ type: 'Button', key: 'compact' })).toBe(undefined)
  await ui.unmount()
  await step($, 't1', 1, 'high')
  await complete($, 't1')

  await start($, 't2')
  await step($, 't2', 0, 'high')

  expect(efforts).toEqual(['high', 'xhigh', 'high'])
})

test('a second /ultra cancels', async ($, on) => {
  const { efforts, contexts } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await ultra($)
  await ultra($)
  await submit($, 'one')
  await start($, 't1')
  await step($, 't1', 0, 'medium')
  await complete($, 't1')

  await ultra($)
  await submit($, 'two')
  await start($, 't2')
  await step($, 't2', 0, 'medium')

  expect(contexts[0]).toEqual([])
  expect(efforts).toEqual(['medium', 'xhigh'])
})

test('Compact shows while idle, runs /compact, and leads from 70% full', async ($, on) => {
  const { runs } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    const button = await ui.find({ type: 'Button', key: 'compact' })
    expect(button?.text).toBe('Compact')
    expect(button?.props.variant).toBe(undefined)
    await ui.unmount()
  }

  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'compact' })
  await ui.unmount()
  expect(runs).toEqual(['compact'])
})

test('from 70% full, Compact is the main action', async ($, on) => {
  engine(on, 75)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount(band('desktop'))
  const button = await ui.find({ type: 'Button', key: 'compact' })
  expect(button?.text).toBe('Compact now')
  expect(button?.props.variant).toBe('primary')
  await ui.unmount()
})

test('the boost never lowers a level, and gives 4.6 models high', () => {
  expect(boosted('claude-opus-5-5', 'max')).toBe(null)
  expect(boosted('claude-opus-5-5', 'xhigh')).toBe(null)
  expect(boosted('claude-opus-5-5', 'high')).toBe('xhigh')
  expect(boosted('claude-opus-4-6', 'medium')).toBe('high')
  expect(boosted('claude-haiku-4-5', undefined)).toBe(null)
  expect(boosted('claude-opus-5-5', 8000)).toBe(null)
})

test('the shimmer runs a lighter band through the word', () => {
  expect(letters('ultrathink', null).map(l => l.color)).toEqual([...RAINBOW, ...RAINBOW.slice(0, 3)])
  const lit = letters('ultrathink', 5)
  expect(lit.filter(l => !RAINBOW.includes(l.color)).map(l => l.ch).join('')).toBe('tra')
})

test('the skill loses its frontmatter, and the reply loses its fence', () => {
  expect(skillBody(SKILL_MD)).toBe('# Be ambitious\n\nAim at the outcome.')
  expect(skillBody('# No frontmatter')).toBe('# No frontmatter')
  expect(cleanReply('  Just the prompt.  ')).toBe('Just the prompt.')
  expect(cleanReply('Plan...\n```text\nThe prompt.\n```\nNext: rung 1')).toBe('The prompt.')
  expect(masterAsk('RULES', 'my draft')).toContain('<skill name="be-ambitious">\nRULES\n</skill>')
})
