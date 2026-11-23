// ultrathink-mod: one bar above the prompt with the context window, the 5-hour
// and 7-day limits, the prompt cache, a Master prompt button in the rainbow
// letters Claude Code paints the word ultrathink in, and a Compact button.
//
// Master prompt takes what you have typed in the prompt box, rewrites it with the
// be-ambitious skill (Altitude, Depth, Range) and puts the rewritten prompt back
// in the box for you to read and send. Claude Opus 5.5 writes it, every time, at
// medium effort, from the draft alone (no chat history, no tools).
//
// /ultra still runs your next message (or, while Claude works, the rest of this
// turn) at xhigh: only that turn's main requests change, your /effort setting
// stays, a level at or above xhigh stays, subagents keep theirs, and Opus 4.6 and
// Sonnet 4.6, which have no xhigh, get high. A boosted message also tells Claude
// the level it runs at, so it answers truly when asked.
//
// The terminal draws the meters as circle glyphs and the button as a Button
// (0 presses it once the bar has the focus). The desktop draws each meter as a
// ring and the button as a key cap: a picture (capSvg) with a Client over it for
// the click (master-client.tsx). Beside it, Compact runs /compact (9).
//
// The bar itself makes no model calls; only a press of Master prompt does.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { UltrathinkMeters, UltrathinkState } from '../types'
import {
  BLUE, CAP_H, CAP_W, ORANGE, WORD,
  boosted, cacheOf, capSvg, cleanReply, contextPercent, letters, masterAsk, nameOf, noteFor, pie, ringSvg, skillBody, target,
  usedColor, usedOf, windowsOf,
} from './bar'
import type { MasterProps } from './master-client'

const IDLE: UltrathinkState = { armed: false, pending: false, boostTurn: null, currentTurn: null, effort: null, model: null }

const meters = atom({ plugin: 'ultrathink-mod', key: 'meters' } as const, { context: null, windows: [] } as UltrathinkMeters)
const lastAt = atom({ plugin: 'ultrathink-mod', key: 'lastAt' } as const, 0)
const ultra = atom({ plugin: 'ultrathink-mod', key: 'ultra' } as const, IDLE)
const isCompacting = atom({ plugin: 'ultrathink-mod', key: 'isCompacting' } as const, false)
const isRewriting = atom({ plugin: 'ultrathink-mod', key: 'isRewriting' } as const, false)

/** From this full, the Compact button becomes the main action. */
const COMPACT_NUDGE = 70

/** How often the bar redraws, so the cache countdown stays current. */
const TICK_MS = 30_000
/** How fast the shimmer runs through the word while the Master prompt is written. */
const SHIMMER_MS = 120
/** Under this many columns the button gets a row of its own. */
const WIDE = 110
/** Who writes every Master prompt, whatever model the session runs: Claude Opus 5.5 at medium effort. */
const MASTER_MODEL = 'claude-opus-5-5'
const MASTER_EFFORT = 'medium'
/** The most the reply may run to, in tokens, its thinking included. */
const MASTER_MAX_TOKENS = 16000
/** How long a rewrite may take before it gives up and leaves the draft. */
const MASTER_TIMEOUT_MS = 180_000

let shimmer: Timer | null = null
let frame = 0
// The terminal's shimmer redraws the bar; the desktop's runs inside its SVG.
let drawsTerminal = false

/** Runs the terminal's shimmer while the Master prompt is written, and stops it after. */
function syncShimmer($: EngineInterface, isOn: boolean): void {
  if (isOn && drawsTerminal && shimmer === null) {
    shimmer = $.clock.every(SHIMMER_MS, () => {
      frame += 1
      $.ui.invalidate('ui.render')
    })
  } else if (!isOn && shimmer !== null) {
    shimmer.cancel()
    shimmer = null
    frame = 0
  }
}

async function pull($: EngineInterface): Promise<void> {
  const u = await $.session.usage()
  await update($, meters, () => ({ context: contextPercent(u.context), windows: windowsOf(u.rateLimits) }))
}

// Compact runs Claude Code's own /compact, so its usual progress and result show.
// Work a press starts ends with the press and would cancel the compaction, so a
// timer runs it in a dispatch of its own that lasts until the compaction ends.
function compact($: EngineInterface): void {
  void update($, isCompacting, () => true)
  $.clock.after(1, () =>
    $.command
      .run({ command: 'compact' })
      .catch((error: unknown) => $.ui.toast(`Compacting failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => update($, isCompacting, () => false)),
  )
}

/** The be-ambitious skill's instructions and the file they came from: your own copy first, then one the app synced. */
async function readSkill($: EngineInterface): Promise<{ path: string; body: string } | null> {
  const home = await $.env.get('HOME')
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home ? `${home}/.claude` : null)
  if (!config) return null
  const paths = [`${config}/skills/be-ambitious/SKILL.md`]
  try {
    for (const entry of await $.fs.list(`${config}/skills/synced`)) {
      paths.push(`${config}/skills/synced/${entry.name}/be-ambitious/SKILL.md`)
    }
  } catch {
    // No synced skills on this machine.
  }
  for (const path of paths) {
    try {
      const body = skillBody(await $.fs.read(path))
      if (body) return { path, body }
    } catch {
      // Not there; try the next.
    }
  }
  return null
}

/** The last press's steps, one line each, in the mod's folder (overwritten by the next press). */
const TRACE_FILE = '.master-prompt.log'

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// What a press of Master prompt does: rewrite the draft with the be-ambitious
// skill and put the result in the box. The draft stays as it is when there is
// none, when the rewrite fails, or when you changed it while Claude wrote.
// Each step goes to TRACE_FILE, so a press that shows nothing can be read back.
async function master($: EngineInterface): Promise<void> {
  if (await read($, isRewriting)) {
    await $.ui.toast('Still writing your Master prompt.')
    return
  }
  // The cap lights up at once, before anything slow runs.
  await update($, isRewriting, () => true)
  syncShimmer($, true)
  const lines: string[] = []
  const note = async (line: string): Promise<void> => {
    lines.push(`${new Date(await $.clock.now()).toISOString()} ${line}`)
    await $.fs.write(`${$.plugin.root}/${TRACE_FILE}`, lines.join('\n') + '\n').catch(() => undefined)
  }
  const say = async (text: string): Promise<void> => {
    await note(`toast: ${text}`)
    await $.ui.toast(text)
  }
  try {
    await note('press')
    const { text: draft } = await $.prompt.read()
    await note(`draft: ${draft.length} chars`)
    if (!draft.trim()) {
      await say('Type a prompt first, then press Master prompt.')
      return
    }
    const skill = await readSkill($)
    await note(skill ? `skill: ${skill.path}` : 'skill: none found')
    if (!skill) {
      await say('Master prompt needs the be-ambitious skill in ~/.claude/skills/be-ambitious.')
      return
    }
    await $.ui.toast('Writing your Master prompt…')
    await note(`ask: ${MASTER_MODEL} at ${MASTER_EFFORT}`)
    const reply = await $.model.complete({
      model: MASTER_MODEL,
      effort: MASTER_EFFORT,
      prompt: masterAsk(skill.body, draft),
      maxTokens: MASTER_MAX_TOKENS,
      timeoutMs: MASTER_TIMEOUT_MS,
    })
    await note(`answer: ${reply.isAnswered ? `${reply.text.length} chars` : reply.reason}`)
    if (!reply.isAnswered) {
      await say(`Master prompt failed (${reply.reason}). Your draft is unchanged.`)
      return
    }
    const rewritten = cleanReply(reply.text)
    if (!rewritten) {
      await say('Master prompt came back empty. Your draft is unchanged.')
      return
    }
    if ((await $.prompt.read()).text !== draft) {
      await say('You changed the draft while the Master prompt was written, so it stays as you left it.')
      return
    }
    const filled = await $.prompt.fill({ text: rewritten, mode: 'replace' })
    await note(`fill: ${filled.isFilled ? 'filled' : `not filled (${filled.refusal ?? 'no reason'})`}`)
    await say(filled.isFilled ? 'Your Master prompt is in the box. Read it, then send.' : 'The Master prompt could not go in the box.')
  } catch (error) {
    await say(`Master prompt failed: ${errorText(error)}`)
  } finally {
    await update($, isRewriting, () => false)
    syncShimmer($, false)
  }
}

// Work a press starts ends with the press, and a rewrite takes a while, so a
// timer runs it in a dispatch of its own, as Compact does.
function startMaster($: EngineInterface): void {
  $.clock.after(1, () => master($).catch((error: unknown) => $.ui.toast(`Master prompt failed: ${errorText(error)}`)))
}

// What /ultra does: while a turn runs, raise (or lower) the rest of it;
// otherwise arm (or disarm) the next message. Returns a line saying so.
async function press($: EngineInterface, working: boolean): Promise<string> {
  let said = ''
  await update($, ultra, u => {
    if (working && u.currentTurn !== null) {
      if (u.boostTurn === u.currentTurn) {
        said = 'Ultrathink off: the rest of this turn goes back to your level.'
        return { ...u, boostTurn: null }
      }
      said = 'Ultrathink on: the rest of this turn runs at xhigh.'
      return { ...u, boostTurn: u.currentTurn }
    }
    said = u.armed ? 'Ultrathink off for your next message.' : 'Ultrathink on: your next message runs at xhigh.'
    return { ...u, armed: !u.armed }
  })
  return said
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'ultra',
        description: 'Ultrathink: run your next message (or, while Claude works, the rest of this turn) at xhigh effort',
        immediate: true,
      })
    } catch {
      // The name is taken; the button still works.
    }
    const result = await next(e)
    await pull($).catch(() => undefined)
    $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
    // A reload drops a rewrite under way, so the button starts at rest.
    await update($, isRewriting, () => false)
    return result
  })

  on('session.measure', async ($, e, next) => {
    const hasContext = e.changed.includes('context')
    const hasLimits = e.changed.includes('rateLimits')
    if (hasContext || hasLimits) {
      await update($, meters, m => ({
        context: hasContext ? (contextPercent(e.context) ?? m.context) : m.context,
        windows: hasLimits ? windowsOf(e.rateLimits) : m.windows,
      }))
    }
    return next(e)
  })

  // An armed message carries the boost to its turn, and a note so Claude knows it.
  on('prompt.submit', async ($, e, next) => {
    const s = await read($, ultra)
    if (!s.armed || e.command || e.isMeta || !e.text.trim()) {
      return next(e)
    }
    await update($, ultra, u =>
      e.turnId ? { ...u, armed: false, boostTurn: e.turnId } : { ...u, armed: false, pending: true },
    )
    const level = s.effort === null ? target(s.model) : boosted(s.model, s.effort)
    return next(level ? { ...e, context: [...(e.context ?? []), noteFor(level)] } : e)
  }).catch(($, e, next) => next(e)) // never hold up a prompt

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      await update($, ultra, u => ({
        ...u,
        currentTurn: e.turnId,
        pending: false,
        boostTurn: u.pending ? e.turnId : u.boostTurn,
      }))
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) {
      return yield* next(e)
    }
    const now = await $.clock.now()
    await update($, lastAt, () => now)
    const s = await update($, ultra, u => ({
      ...u,
      currentTurn: e.turnId,
      effort: typeof e.effort === 'string' ? e.effort : u.effort,
      model: e.model,
    }))
    if (s.boostTurn === e.turnId) {
      const effort = boosted(e.model, e.effort)
      if (effort) {
        return yield* next({ ...e, effort })
      }
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      await update($, ultra, u => ({
        ...u,
        boostTurn: u.boostTurn === e.turnId ? null : u.boostTurn,
        currentTurn: u.currentTurn === e.turnId ? null : u.currentTurn,
      }))
      await pull($).catch(() => undefined)
    }
    return next(e)
  })

  on('command.run', { command: 'ultra' }, async $ => {
    const s = await read($, ultra)
    await $.ui.toast(await press($, s.currentTurn !== null))
    return {}
  })

  // A click on the desktop's Master prompt cap (master-client.tsx).
  on('ui.message', async ($, e, next) => {
    const data = e.data as { press?: unknown } | null
    if (e.element !== 'master-prompt' || !data || data.press !== true) {
      return next(e)
    }
    startMaster($)
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const desktop = e.surface === 'desktop' && 'Svg' in ui && 'Client' in ui ? ui : null
    if (e.surface === 'terminal') drawsTerminal = true
    const m = await read($, meters)
    const cache = cacheOf(await read($, lastAt), await $.clock.now())
    const isWide = (e.props.bodyColumns || 80) >= WIDE

    // A meter: its ring (an Svg on the desktop, a circle glyph in the terminal), its figure, its name.
    const meter = (key: string, percent: number, color: string, value: string, name: string) => (
      <Box key={key} flexDirection="row" flexShrink={0} alignItems="center" marginRight={2}>
        {desktop ? (
          <desktop.Svg source={ringSvg(percent, color)} alt={`${name} ${value}`} width={18} height={18} />
        ) : (
          <Text color={color}>{pie(percent)}</Text>
        )}
        <Text bold>{` ${value}`}</Text>
        <Text dimColor>{` ${name}`}</Text>
      </Box>
    )
    const meterRow = [
      m.context !== null ? meter('context', m.context, usedColor(m.context), `${m.context}%`, 'context') : null,
      ...m.windows.map(w => meter(`w-${w.kind}`, usedOf(w), usedColor(usedOf(w)), `${usedOf(w)}%`, nameOf(w.kind))),
      cache ? meter('cache', cache.percentLeft, cache.isWarm ? ORANGE : BLUE, cache.text, 'cache') : null,
    ].filter(part => part !== null)

    // Compact hides while a turn runs (it would cut the turn's own context) and while one runs.
    const compactPart =
      !e.props.isWorking && !(await read($, isCompacting)) ? (
        (m.context ?? 0) >= COMPACT_NUDGE ? (
          <Button key="compact" label="Compact now" hotkey="9" plain variant="primary" onPress={() => compact($)} />
        ) : (
          <Button key="compact" label="Compact" hotkey="9" plain dimColor onPress={() => compact($)} />
        )
      ) : null

    // While the Master prompt is written, the word shimmers.
    const masterProps: MasterProps = { isOn: await read($, isRewriting) }
    const word = letters(WORD, masterProps.isOn ? frame : null)
    // The desktop's key cap: its picture, and the Client that takes the click, laid over it.
    const masterPart = desktop ? (
      <Box key="master-prompt-cap" position="relative" flexShrink={0}>
        <desktop.Svg source={capSvg(masterProps.isOn ? 'on' : 'rest')} alt="Master prompt" width={CAP_W} height={CAP_H} />
        <Box position="absolute" top={0} left={0} width="100%" height="100%">
          <desktop.Client key="master-prompt" module="./master-client.tsx" props={masterProps} width="100%" height="100%" />
        </Box>
      </Box>
    ) : (
      <Box key="master" flexDirection="row" flexShrink={0}>
        <Button key="master-prompt" label="Master prompt" hotkey="0" plain onPress={() => startMaster($)}>
          <Text color={ORANGE}>{'✦ '}</Text>
          {word.map((l, i) => (
            <Text key={`l${i}`} color={l.color} bold>
              {l.ch}
            </Text>
          ))}
        </Button>
      </Box>
    )

    const buttons = (
      <Box key="buttons" flexDirection="row" flexShrink={0} alignItems="center" columnGap={2}>
        {masterPart}
        {compactPart}
      </Box>
    )
    const meterBox = (
      <Box key="meters" flexDirection="row" flexWrap="wrap" flexShrink={1} alignItems="center">
        {meterRow}
      </Box>
    )
    // One row: the meters, then the buttons at the right. A narrow terminal stacks them.
    const mine =
      desktop || isWide ? (
        <Box flexDirection="row" paddingX={1} alignItems="center">
          {meterBox}
          <Box key="grow" flexGrow={1} />
          {buttons}
        </Box>
      ) : (
        <Box flexDirection="column" paddingX={1}>
          {meterRow.length > 0 ? meterBox : null}
          {buttons}
        </Box>
      )
    const theirs = await next(e)
    return theirs ? (
      <Box flexDirection="column">
        {mine}
        {theirs}
      </Box>
    ) : (
      mine
    )
  })
}
