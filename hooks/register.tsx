import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AddedModel, SearchResult, SwitchChoice, SwitchState } from '../types'
import { asText, canUseTools, catalogUrl, parseCatalog, plan, select, summary, wordsOf } from './catalog'
import type { Settings } from './switching'
import { asAdded, asLastModel, BUILT_IN, formatSettings, isBuiltIn, parseSettings, stateFrom, withAnthropic, withModel } from './switching'

const setting = atom({ plugin: 'model-relay', key: 'setting' } as const, null)
const note = atom({ plugin: 'model-relay', key: 'note' } as const, '')
const manage = atom({ plugin: 'model-relay', key: 'manage' } as const, null)
const searching = atom({ plugin: 'model-relay', key: 'searching' } as const, null)

// Slash commands with no argument: where each one switches to.
const COMMANDS: Record<string, { to: string; description: string }> = {
  switchback: { to: 'anthropic', description: "Switch new sessions to Anthropic's Claude models (your Claude login)" },
  switchopenrouter: { to: 'last', description: 'Switch new sessions to OpenRouter with the model used last' },
  switchfree: { to: 'free', description: "Switch new sessions to OpenRouter's free router (openrouter/free)" },
  switchcoder: { to: 'coder', description: 'Switch new sessions to Nemotron 3 Ultra, a free coding model' },
  switchqwen: { to: 'qwen', description: 'Switch new sessions to Qwen3 Coder (paid, billed to your OpenRouter key)' },
  claudemode: { to: 'status', description: 'Show which model new sessions will use' },
}

// Slash commands that take an argument: managing the list of OpenRouter models.
const MODEL_COMMANDS = [
  { name: 'addmodel', argumentHint: '<model id, type or name>', description: 'Add an OpenRouter model to the model list (no argument opens the search box)' },
  { name: 'findmodel', argumentHint: '<type or name, e.g. coding>', description: 'Search OpenRouter by type (coding, roleplay, reasoning, ...) or name for models that work with Claude Code' },
  { name: 'removemodel', argumentHint: '<model id>', description: 'Take a model you added off the model list' },
  { name: 'switchmodel', argumentHint: '<model id>', description: 'Switch new sessions to any OpenRouter model by its id' },
]

const MANAGE = '__manage'
const NEW_SESSION = 'Start a new session to use it.'
const NO_KEY =
  'Set your OpenRouter API key first: run /plugin configure model-relay@j12will12-professai. Get a key at https://openrouter.ai/settings/keys.'
const SEARCH_TIMEOUT_MS = 25000

// Each search's number. Stop, Done or a newer search moves it on, and a search whose number is no
// longer current has its result thrown away when it arrives.
let searchRun = 0

// Claude Code's user settings.json, where the env block that picks the model lives.
async function settingsPath($: EngineInterface) {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (dir) {
    return `${dir}/settings.json`
  }
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (!home) {
    throw new Error('Could not find your home folder.')
  }

  return `${home}/.claude/settings.json`
}

async function readSettings($: EngineInterface): Promise<Settings> {
  const path = await settingsPath($)

  return (await $.fs.exists(path)) ? parseSettings(await $.fs.read(path), path) : {}
}

async function writeSettings($: EngineInterface, settings: Settings) {
  await $.fs.write(await settingsPath($), formatSettings(settings))
}

// The models the user added, and the OpenRouter model used last, in the plugin's own store.
async function addedModels($: EngineInterface) {
  return asAdded(await $.store.get('added'))
}

async function saveAdded($: EngineInterface, models: AddedModel[]) {
  await $.store.set('added', models)
}

async function fetchCatalog($: EngineInterface, category?: string) {
  const res = await $.http.fetch(catalogUrl(category), { headers: { 'User-Agent': 'model-relay' } })
  if (!res.ok) {
    throw new Error(`OpenRouter's model list answered with status ${res.status}`)
  }

  return parseCatalog(res.text)
}

// The catalog entry for a model id, matched whatever its capitals; undefined when OpenRouter has none.
async function findModel($: EngineInterface, id: string) {
  const wanted = id.trim().toLowerCase()

  return (await fetchCatalog($)).find(m => m.id.toLowerCase() === wanted)
}

// Words are a type (coding, roleplay, reasoning, ...), name words, a model id, or a mix ("free coding").
async function search($: EngineInterface, text: string, limit = 10): Promise<SearchResult> {
  const words = wordsOf(text)
  const typed = plan(words, true)
  let found = select(await fetchCatalog($, typed.category), typed, limit)
  if (found.typed && found.hits.length === 0) {
    found = select(await fetchCatalog($), plan(words, false), limit) // nothing of that type: try the words as a name
  }

  return { title: found.title, hits: found.hits }
}

function labelOf(state: SwitchState) {
  const choice = state.choices.find(c => c.key === state.current)

  return choice ? choice.label : (state.model ?? 'unknown model')
}

async function refresh($: EngineInterface) {
  const state = stateFrom(await readSettings($), await addedModels($))
  await update($, setting, () => state)
  $.ui.status(`Model: ${labelOf(state)}`)

  return state
}

// Switches new sessions to Anthropic or to an OpenRouter model, and says what happened.
async function switchTo($: EngineInterface, apiKey: string, model: string | null) {
  const settings = await readSettings($)
  const next = model === null ? withAnthropic(settings) : withModel(settings, model, apiKey)
  if (typeof next !== 'string') {
    await writeSettings($, next)
    if (model !== null) {
      await $.store.set('lastModel', model) // so /switchopenrouter brings this model back
    }
  }
  const outcome = typeof next === 'string' ? next : 'switched'
  const state = await refresh($)
  const text =
    outcome === 'no-key'
      ? NO_KEY
      : outcome === 'already'
        ? `Already set to ${labelOf(state)}.`
        : `Switched to ${labelOf(state)}. ${NEW_SESSION}`
  await update($, note, () => text)
  if (outcome === 'switched') {
    $.ui.toast(text)
  }

  return text
}

// /switchmodel: any OpenRouter model by its id, once OpenRouter confirms the id and that the
// model can use tools, so a typo never points new sessions at a model that doesn't exist.
async function switchToId($: EngineInterface, apiKey: string, id: string) {
  const model = await findModel($, id)
  if (model === undefined) {
    return `OpenRouter has no model with the id "${id.trim()}". Search for one with /findmodel <words>.`
  }
  if (!canUseTools(model)) {
    return `${model.name ?? model.id} (${model.id}) can't use tools, which Claude Code needs, so new sessions weren't switched to it.`
  }

  return switchTo($, apiKey, model.id)
}

const modelOf = (choice: SwitchChoice) => (choice.key === 'anthropic' ? null : (choice.model ?? null))

async function openManage($: EngineInterface) {
  await update($, manage, () => ({ query: '', title: '', hits: [] }))
  await update($, note, () => '')
}

async function closeManage($: EngineInterface) {
  searchRun += 1 // a search still running ends with the panel
  await update($, searching, () => null)
  await update($, manage, () => null)
}

async function stopSearch($: EngineInterface) {
  searchRun += 1
  let stopped: string | null = null
  await update($, searching, query => {
    stopped = query
    return null
  })
  await update($, note, () => (stopped === null ? '' : `Stopped searching for "${stopped}".`))
}

// Adds an OpenRouter model to the dropdown; answers what happened.
async function addModel($: EngineInterface, id: string) {
  const wanted = id.trim()
  const added = await addedModels($)
  const listed = (model: string) => isBuiltIn(model) || added.some(a => a.model.toLowerCase() === model.toLowerCase())
  let text: string
  let ok = false
  if (listed(wanted)) {
    text = `${wanted} is already in the list.`
  } else {
    const model = await findModel($, wanted)
    if (model === undefined) {
      text = `OpenRouter has no model with the id "${wanted}". Search for one with /findmodel <words>.`
    } else if (listed(model.id)) {
      text = `${model.id} is already in the list.`
    } else if (!canUseTools(model)) {
      text = `${model.name ?? model.id} (${model.id}) can't use tools, which Claude Code needs, so it wasn't added.`
    } else {
      const hit = summary(model)
      await saveAdded($, [...added, { model: hit.id, label: hit.label, detail: hit.detail }])
      text = `Added ${hit.label} (${hit.id}), ${hit.price}. Pick it from the dropdown to switch to it.`
      ok = true
    }
  }
  await refresh($)
  if (ok) {
    await closeManage($)
    $.ui.toast(text)
  }
  await update($, note, () => text)

  return text
}

async function removeModel($: EngineInterface, id: string) {
  const wanted = id.trim()
  const added = await addedModels($)
  const entry = added.find(a => a.model.toLowerCase() === wanted.toLowerCase())
  let text: string
  if (isBuiltIn(wanted)) {
    text = `${wanted} is built in and can't be removed.`
  } else if (entry === undefined) {
    text = `${wanted} isn't one of the models you added.`
  } else {
    await saveAdded($, added.filter(a => a !== entry))
    text = `Removed ${entry.model} from the list.`
  }
  await refresh($)
  await update($, note, () => text)

  return text
}

type Outcome = { result: SearchResult } | { error: string } | { timedOut: true }

// Searches OpenRouter, giving up after SEARCH_TIMEOUT_MS.
function searchWithLimit($: EngineInterface, text: string) {
  return new Promise<Outcome>(resolve => {
    const timer = $.clock.after(SEARCH_TIMEOUT_MS, () => resolve({ timedOut: true }))
    search($, text).then(
      result => {
        timer.cancel()
        resolve({ result })
      },
      (err: unknown) => {
        timer.cancel()
        resolve({ error: err instanceof Error ? err.message : String(err) })
      },
    )
  })
}

// The search box: a name, a model id, a type such as coding, or a mix.
async function find($: EngineInterface, text: string) {
  const query = text.trim()
  if (query === '') {
    return
  }
  const run = ++searchRun
  await update($, searching, () => query)
  await update($, note, () => '')
  const outcome = await searchWithLimit($, query)
  if (run !== searchRun) {
    return // stopped, or a newer search took over
  }
  await update($, searching, () => null)
  if ('timedOut' in outcome) {
    await update($, note, () => `Search failed: it didn't finish within ${SEARCH_TIMEOUT_MS / 1000} seconds. Check your internet connection and try again.`)
    return
  }
  if ('error' in outcome) {
    await update($, note, () => `Search failed: ${outcome.error}. Try again in a moment.`)
    return
  }
  const { title, hits } = outcome.result
  // A whole model id pasted in: add it straight away.
  if (hits.some(hit => hit.id === query)) {
    await addModel($, query)
    return
  }
  await update($, manage, () => ({ query, title, hits }))
}

// Runs what a button, the dropdown, the search box or the timer started; anything that goes
// wrong shows under the band instead of leaving a "Searching..." that never ends.
function act($: EngineInterface, work: () => Promise<unknown>) {
  work().catch((err: unknown) => update($, note, () => `Something went wrong: ${messageOf(err)}`))
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

// A slash command's answer; an error shows as its output instead of failing the command.
const answer = (work: () => Promise<string>) =>
  work()
    .then(text => ({ text }))
    .catch((err: unknown) => ({ text: `model-relay: ${messageOf(err)}` }))

// A command hook that fails anyway, or runs past its time, still answers, saying why.
const commandFailed = (_$: unknown, _e: unknown, next: { error: { kind: 'throw' | 'timeout'; message?: string } }) => ({
  text:
    next.error.kind === 'timeout'
      ? "model-relay couldn't finish that command in time. Check your internet connection and try again."
      : `model-relay couldn't finish that command: ${next.error.message ?? 'unknown error'}`,
})

export const register: Register = (on, options) => {
  const option = options.openrouter_api_key
  const apiKey = typeof option === 'string' ? option.trim() : ''

  on('session.start', async ($, e, next) => {
    for (const [name, { description }] of Object.entries(COMMANDS)) {
      await $.command.register({ name, description })
    }
    for (const { name, description, argumentHint } of MODEL_COMMANDS) {
      await $.command.register({ name, description, argumentHint })
    }
    // A search cut off by a reload never answers: clear what it left on screen.
    await update($, searching, () => null)
    await refresh($).catch((err: unknown) => update($, note, () => `model-relay can't read your settings: ${messageOf(err)}`))
    // Picks up switches made elsewhere (another session, or settings.json edited by hand).
    $.clock.every(60000, () => act($, () => refresh($)))

    return next(e)
  })

  for (const [name, { to }] of Object.entries(COMMANDS)) {
    on('command.run', { command: name }, $ =>
      answer(async () => {
        if (to === 'status') {
          return `${(await refresh($)).summary} Use the dropdown above the prompt to change it.`
        }
        if (to === 'anthropic') {
          return switchTo($, apiKey, null)
        }

        return switchTo($, apiKey, to === 'last' ? asLastModel(await $.store.get('lastModel')) : BUILT_IN[to]![0])
      }),
    ).catch(commandFailed)
  }

  on('command.run', { command: 'addmodel' }, ($, e) =>
    answer(async () => {
      const arg = e.args.trim()
      if (arg === '') {
        await openManage($)

        return 'Search by type (coding, roleplay, ...), name or model id in the box above the prompt (ctrl+x then tab to reach it).'
      }

      return arg.includes('/') ? addModel($, arg) : asText(await search($, arg, 20), arg)
    }),
  ).catch(commandFailed)

  on('command.run', { command: 'findmodel' }, ($, e) =>
    answer(async () => {
      const arg = e.args.trim()

      return arg === '' ? 'Usage: /findmodel <type or name>, for example /findmodel coding' : asText(await search($, arg, 20), arg)
    }),
  ).catch(commandFailed)

  on('command.run', { command: 'removemodel' }, ($, e) =>
    answer(async () => {
      const arg = e.args.trim()

      return arg === '' ? 'Usage: /removemodel <model id>' : removeModel($, arg)
    }),
  ).catch(commandFailed)

  on('command.run', { command: 'switchmodel' }, ($, e) =>
    answer(async () => {
      const arg = e.args.trim()

      return arg === '' ? 'Usage: /switchmodel <OpenRouter model id>' : switchToId($, apiKey, arg)
    }),
  ).catch(commandFailed)

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, setting)
    const message = await read($, note)
    if (e.props.hasSurvey || (state === null && message === '')) {
      return next(e)
    }
    if (state === null) {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>{message}</Text>
    }
    const pick = (value: string) => {
      const choice = state.choices.find(c => c.key === value)
      if (value === MANAGE) {
        act($, () => openManage($))
      } else if (choice && value !== state.current) {
        act($, () => switchTo($, apiKey, modelOf(choice)))
      }
    }

    if (e.surface === 'mobile') {
      const { Box, Button, Text } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          <Text dimColor>Model for new sessions:</Text>
          <Box flexDirection="row">
            {state.choices.map(c => (
              <Button
                key={`model-${c.key}`}
                label={c.label}
                variant={c.key === state.current ? 'primary' : 'secondary'}
                onPress={() => pick(c.key)}
              />
            ))}
          </Box>
          {message !== '' && <Text dimColor>{message}</Text>}
        </Box>
      )
    }

    const { Box, Button, Input, Select, Text } = $.ui.resolve(e)
    const panel = await read($, manage)
    const searchingFor = await read($, searching)

    if (panel !== null) {
      const added = state.choices.filter(c => c.custom)

      return (
        <Box flexDirection="column">
          <Text bold>Add an OpenRouter model (only models that can use tools are listed)</Text>
          <Input
            key="search"
            label="Search"
            placeholder="name, model id, or type (e.g. deepseek, qwen/qwen3-coder, coding)"
            submitLabel="search"
            autoFocus
            onSubmit={value => act($, () => find($, value))}
          />
          {searchingFor !== null && (
            <Box flexDirection="row" columnGap={1}>
              <Text dimColor>Searching OpenRouter for "{searchingFor}"...</Text>
              <Button key="stop" label="Stop" onPress={() => act($, () => stopSearch($))} />
            </Box>
          )}
          {searchingFor === null && panel.query !== '' && panel.hits.length === 0 && (
            <Text dimColor>No OpenRouter model that can use tools matches "{panel.query}".</Text>
          )}
          {panel.hits.length > 0 && <Text dimColor>{panel.title}:</Text>}
          {panel.hits.map((hit, i) => (
            <Box flexDirection="row">
              <Button key={`add-${i}`} label="Add" onPress={() => act($, () => addModel($, hit.id))} />
              <Text wrap="truncate-end"> {hit.rank ? `#${hit.rank} ` : ''}{hit.label}  {hit.id}  {hit.price}</Text>
            </Box>
          ))}
          {added.length > 0 && <Text dimColor>Models you added:</Text>}
          {added.map((c, i) => (
            <Box flexDirection="row">
              <Button key={`remove-${i}`} label="Remove" onPress={() => act($, () => removeModel($, c.model ?? c.key))} />
              <Text wrap="truncate-end"> {c.label}  {c.model}</Text>
            </Box>
          ))}
          <Button key="done" label="Done" onPress={() => act($, () => closeManage($))} />
          {message !== '' && <Text dimColor>{message}</Text>}
        </Box>
      )
    }

    const items = state.choices.map(c => ({ value: c.key, label: c.label }))
    if (state.current === 'other') {
      items.push({ value: 'other', label: `Other: ${state.model ?? 'unknown'}` })
    }
    items.push({ value: MANAGE, label: '+ Add or remove OpenRouter models...' })

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Select key="model" label="Model for new sessions" options={items} value={state.current} onSelect={pick} />
          <Text> </Text>
          <Button key="manage" label="Add or remove models" onPress={() => act($, () => openManage($))} />
        </Box>
        {message !== '' && <Text dimColor>{message}</Text>}
      </Box>
    )
  })
}
