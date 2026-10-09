import { expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

// Everything beneath the plugin is faked here: settings.json, OpenRouter's catalog, the store.
const HOME = 'C:/Users/me'
const SETTINGS = `${HOME}/.claude/settings.json`
const KEY = { options: { openrouter_api_key: 'sk-or-test' } }

const model = (id: string, name: string, prompt: string, completion: string, params: string[], image = false) => ({
  id,
  name,
  pricing: { prompt, completion },
  supported_parameters: params,
  architecture: { input_modalities: image ? ['image', 'text'] : ['text'] },
})
const CATALOG = [
  model('deepseek/deepseek-v4-pro', 'DeepSeek: DeepSeek V4 Pro', '0.00000021', '0.00000042', ['tools', 'reasoning']),
  model('deepseek/deepseek-v4-flash:free', 'DeepSeek: DeepSeek V4 Flash (free)', '0', '0', ['tools']),
  model('meta-llama/llama-5-70b', 'Meta: Llama 5 70B', '0.0000001', '0.0000003', ['tools'], true),
  model('acme/no-tools', 'Acme: No Tools', '0', '0', ['temperature']),
  model('qwen/qwen3-coder', 'Qwen: Qwen3 Coder 480B A35B', '0.0000003', '0.000001', ['tools']),
  // A router that picks a model per request: OpenRouter lists its price as -1.
  model('openrouter/auto', 'Auto Router', '-1', '-1', ['tools']),
]
// OpenRouter's programming ranking, best first; the model without tools is ranked but never shown.
const CODING = ['meta-llama/llama-5-70b', 'acme/no-tools', 'deepseek/deepseek-v4-pro']

type World = {
  settings?: object | string // what settings.json holds at the start; absent, no file
  status?: number // OpenRouter's answer to the catalog request
  slow?: { clock: MockClock; ms: number } // OpenRouter answers only after this long
  env?: Record<string, string>
}

function world(on: On, { settings, status = 200, slow, env = { USERPROFILE: HOME } }: World = {}) {
  mock.env(on, env)
  mock.store(on)
  // Paths reach the hooks beneath in the platform's own spelling (backslashes on Windows).
  const norm = (path: string) => path.split('\\').join('/')
  const files = new Map<string, string>()
  if (settings !== undefined) {
    const path = env.CLAUDE_CONFIG_DIR ? `${env.CLAUDE_CONFIG_DIR}/settings.json` : SETTINGS
    files.set(path, typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2))
  }
  const writes: string[] = []
  on('fs.exists', async (_$, e) => ({ value: files.has(norm(e.path)) }))
  on('fs.read', async (_$, e) => {
    const text = files.get(norm(e.path))
    if (text === undefined) {
      throw new Error(`ENOENT: ${e.path}`)
    }
    return { value: text }
  })
  on('fs.write', async (_$, e) => {
    files.set(norm(e.path), e.text)
    writes.push(norm(e.path))
    return { value: undefined }
  })

  const fetched: string[] = []
  on('http.fetch', async (_$, e) => {
    fetched.push(e.url)
    if (slow) {
      await slow.clock.sleep(slow.ms)
    }
    const category = new URL(e.url).searchParams.get('category')
    const data = category === 'programming' ? CODING.map(id => CATALOG.find(m => m.id === id)) : category ? [] : CATALOG
    const text = JSON.stringify({ data })
    return { value: { status, ok: status >= 200 && status < 300, headers: {}, text } }
  })

  const commands: string[] = []
  const status_: string[] = []
  const toasts: string[] = []
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.status', async (_$, e) => {
    status_.push(e.text ?? '')
    return { value: undefined }
  })
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  const read = (path = SETTINGS) => JSON.parse(files.get(path) ?? '{}') as { env?: Record<string, string> } & Record<string, unknown>

  return { files, writes, fetched, commands, status: status_, toasts, read }
}

const START = { cwd: 'C:/work', surface: 'terminal', isInteractive: true } as const
const typed = (command: string, args = '') => ({
  command,
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 100 },
})
const BAND = {
  plugin: 'model-relay',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const OPENROUTER_QWEN = {
  env: {
    ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
    ANTHROPIC_AUTH_TOKEN: 'sk-or-old',
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_MODEL: 'qwen/qwen3-coder',
  },
}

test('the dropdown and status line show the model new sessions use', async ($, on) => {
  mock.clock(on)
  const w = world(on, { settings: OPENROUTER_QWEN })
  await $.session.start(START)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ key: 'model' }))?.props.value).toBe('qwen')
    await ui.unmount()
  }
  expect(w.status.at(-1)).toBe('Model: Qwen3 Coder (paid)')
  expect(w.writes).toEqual([])
})

test('switching to OpenRouter writes only its env entries, and switching back removes only those', KEY, async ($, on) => {
  mock.clock(on)
  const w = world(on, { settings: { permissions: { defaultMode: 'auto' }, theme: 'dark', env: { MY_VAR: 'keep' } } })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'model' }))?.props.value).toBe('anthropic')

  await ui.select({ key: 'model', value: 'qwen' })
  const on_ = w.read()
  expect(on_.permissions).toEqual({ defaultMode: 'auto' })
  expect(on_.theme).toBe('dark')
  expect(on_.env).toEqual({
    MY_VAR: 'keep',
    ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
    ANTHROPIC_AUTH_TOKEN: 'sk-or-test',
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_MODEL: 'qwen/qwen3-coder',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen/qwen3-coder',
    ANTHROPIC_SMALL_FAST_MODEL: 'qwen/qwen3-coder',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'qwen/qwen3-coder',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'qwen/qwen3-coder',
    CLAUDE_CODE_SUBAGENT_MODEL: 'qwen/qwen3-coder',
  })
  expect(w.files.get(SETTINGS)?.endsWith('}\n')).toBe(true)
  expect(await ui.find({ type: 'Text', text: /Switched to Qwen3 Coder \(paid\)\. Start a new session/ })).toBeDefined()
  expect(w.toasts.at(-1)).toMatch(/Switched to Qwen3 Coder/)

  await ui.select({ key: 'model', value: 'anthropic' })
  expect(w.read()).toEqual({ permissions: { defaultMode: 'auto' }, theme: 'dark', env: { MY_VAR: 'keep' } })
  expect((await ui.find({ key: 'model' }))?.props.value).toBe('anthropic')
  await ui.unmount()
})

test('without an OpenRouter key it says how to set one and changes nothing', async ($, on) => {
  mock.clock(on)
  const w = world(on, { settings: { theme: 'dark' } })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.select({ key: 'model', value: 'free' })
  expect(await ui.find({ type: 'Text', text: /Set your OpenRouter API key first: run \/plugin configure model-relay/ })).toBeDefined()
  expect(w.writes).toEqual([])
  await ui.unmount()
})

test('an OpenRouter key already in settings.json is kept when the plugin has none', async ($, on) => {
  mock.clock(on)
  const w = world(on, { settings: OPENROUTER_QWEN })
  await $.session.start(START)
  expect((await $.command.run(typed('switchcoder')))?.text).toMatch(/Switched to Nemotron 3 Ultra/)
  expect(w.read().env?.ANTHROPIC_AUTH_TOKEN).toBe('sk-or-old')
  expect(w.read().env?.ANTHROPIC_MODEL).toBe('nvidia/nemotron-3-ultra-550b-a55b:free')
})

test('a settings.json that is not valid JSON is reported and left alone', KEY, async ($, on) => {
  mock.clock(on)
  const w = world(on, { settings: '{ "theme": "dark", ' })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /isn't valid JSON, so model-relay left it alone/ })).toBeDefined()
  await ui.unmount()
  expect((await $.command.run(typed('switchqwen')))?.text).toMatch(/isn't valid JSON/)
  expect(w.writes).toEqual([])
})

test("typing a type such as coding lists OpenRouter's ranking for it", async ($, on) => {
  mock.clock(on)
  const w = world(on)
  await $.session.start(START)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'manage' })
    expect((await ui.find({ key: 'search' }))?.props.placeholder).toMatch(/name, model id, or type/)
    await ui.input({ key: 'search', text: 'coding' })
    expect(w.fetched.at(-1)).toBe('https://openrouter.ai/api/v1/models?category=programming')
    expect(await ui.find({ type: 'Text', text: /top coding models, in its ranking order/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /#1 Meta: Llama 5 70B \(paid\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /#3 DeepSeek: DeepSeek V4 Pro \(paid\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /No Tools/ })).toBeUndefined()

    // A type and a name together, and an ability.
    await ui.input({ key: 'search', text: 'coding deepseek' })
    expect(await ui.find({ type: 'Text', text: /Llama/ })).toBeUndefined()
    await ui.input({ key: 'search', text: 'vision' })
    expect(await ui.find({ type: 'Text', text: /OpenRouter models with vision/ })).toBeDefined()
    expect((await ui.find({ key: 'add-0' }))?.props.label).toBe('Add')
    expect(await ui.find({ key: 'add-1' })).toBeUndefined()
    await ui.press({ key: 'done' })
    await ui.unmount()
  }
})

test('an added model joins the dropdown, picking it switches to its id, and it can be removed', KEY, async ($, on) => {
  mock.clock(on)
  const w = world(on, { settings: {} })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.select({ key: 'model', value: '__manage' })
  await ui.input({ key: 'search', text: 'deepseek' })
  // Free models come first in a name search.
  expect(await ui.find({ type: 'Text', text: /^ DeepSeek: DeepSeek V4 Flash \(free\)/ })).toBeDefined()
  await ui.press({ key: 'add-0' })
  expect(await ui.find({ key: 'search' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Added DeepSeek: DeepSeek V4 Flash \(free\)/ })).toBeDefined()

  await ui.select({ key: 'model', value: 'deepseek/deepseek-v4-flash:free' })
  expect(w.read().env?.ANTHROPIC_MODEL).toBe('deepseek/deepseek-v4-flash:free')
  expect((await ui.find({ key: 'model' }))?.props.value).toBe('deepseek/deepseek-v4-flash:free')

  await ui.press({ key: 'manage' })
  expect(await ui.find({ type: 'Text', text: /Models you added/ })).toBeDefined()
  await ui.press({ key: 'remove-0' })
  expect(await ui.find({ type: 'Text', text: /Removed deepseek\/deepseek-v4-flash:free/ })).toBeDefined()
  expect(await ui.find({ key: 'remove-0' })).toBeUndefined()
  await ui.unmount()
})

test("a pasted model id is added straight away; ids that don't exist or can't use tools are refused", async ($, on) => {
  mock.clock(on)
  world(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'manage' })
  await ui.input({ key: 'search', text: 'meta-llama/llama-5-70b' })
  expect(await ui.find({ key: 'search' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Added Meta: Llama 5 70B \(paid\)/ })).toBeDefined()
  await ui.unmount()

  expect((await $.command.run(typed('addmodel', 'meta-llama/llama-5-70b')))?.text).toMatch(/already in the list/)
  expect((await $.command.run(typed('addmodel', 'acme/no-tools')))?.text).toMatch(/can't use tools, which Claude Code needs/)
  expect((await $.command.run(typed('addmodel', 'nope/nothing')))?.text).toMatch(/OpenRouter has no model with the id "nope\/nothing"/)
  expect((await $.command.run(typed('removemodel', 'qwen/qwen3-coder')))?.text).toMatch(/built in and can't be removed/)
})

test('Stop ends a slow search, and its late answer is thrown away', async ($, on) => {
  const clock = mock.clock(on)
  world(on, { slow: { clock, ms: 15000 } })
  await $.session.start(START)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'manage' })
    await ui.input({ key: 'search', text: 'coding' })
    expect(await ui.find({ type: 'Text', text: /Searching OpenRouter for "coding"/ })).toBeDefined()
    await ui.press({ key: 'stop' })
    expect(await ui.find({ key: 'stop' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Stopped searching for "coding"/ })).toBeDefined()
    await clock.advance(15000)
    expect(await ui.find({ key: 'add-0' })).toBeUndefined()

    // A new search works as usual.
    await ui.input({ key: 'search', text: 'deepseek' })
    await clock.advance(15000)
    expect((await ui.find({ key: 'add-0' }))?.props.label).toBe('Add')
    await ui.press({ key: 'done' })
    await ui.unmount()
  }
})

test('Done during a search closes the panel and drops the search', async ($, on) => {
  const clock = mock.clock(on)
  world(on, { slow: { clock, ms: 15000 } })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'manage' })
  await ui.input({ key: 'search', text: 'coding' })
  await ui.press({ key: 'done' })
  await clock.advance(15000)
  expect(await ui.find({ key: 'search' })).toBeUndefined()
  expect(await ui.find({ key: 'model' })).toBeDefined()
  await ui.unmount()
})

test('a search that takes too long gives up after 25 seconds', async ($, on) => {
  const clock = mock.clock(on)
  world(on, { slow: { clock, ms: 600000 } })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'manage' })
  await ui.input({ key: 'search', text: 'coding' })
  await clock.advance(24000)
  expect(await ui.find({ key: 'stop' })).toBeDefined()
  await clock.advance(1000)
  expect(await ui.find({ key: 'stop' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Search failed: it didn't finish within 25 seconds/ })).toBeDefined()
  await ui.unmount()
})

test('OpenRouter being down is reported, not left hanging', async ($, on) => {
  mock.clock(on)
  world(on, { status: 503 })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'manage' })
  await ui.input({ key: 'search', text: 'coding' })
  expect(await ui.find({ type: 'Text', text: /Search failed: OpenRouter's model list answered with status 503/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Searching/ })).toBeUndefined()
  await ui.unmount()
})

test('the slash commands switch, search, add and remove', KEY, async ($, on) => {
  mock.clock(on)
  const w = world(on, { settings: {} })
  await $.session.start(START)
  expect(w.commands).toEqual([
    'switchback', 'switchopenrouter', 'switchfree', 'switchcoder', 'switchqwen', 'claudemode',
    'addmodel', 'findmodel', 'removemodel', 'switchmodel',
  ])

  expect((await $.command.run(typed('switchcoder')))?.text).toMatch(/Switched to Nemotron 3 Ultra/)
  expect((await $.command.run(typed('switchback')))?.text).toMatch(/Switched to Anthropic/)
  expect(w.read()).toEqual({})
  expect((await $.command.run(typed('switchback')))?.text).toMatch(/Already set to Anthropic/)
  // /switchopenrouter brings back the OpenRouter model used last.
  expect((await $.command.run(typed('switchopenrouter')))?.text).toMatch(/Switched to Nemotron 3 Ultra/)
  expect((await $.command.run(typed('claudemode')))?.text).toMatch(/New sessions use OpenRouter: NVIDIA Nemotron 3 Ultra/)

  expect((await $.command.run(typed('findmodel', 'coding')))?.text).toMatch(/#1  meta-llama\/llama-5-70b/)
  expect((await $.command.run(typed('addmodel', 'deepseek')))?.text).toMatch(/deepseek\/deepseek-v4-pro/)
  expect((await $.command.run(typed('addmodel', 'deepseek/deepseek-v4-pro')))?.text).toMatch(/Added DeepSeek: DeepSeek V4 Pro/)
  expect((await $.command.run(typed('switchmodel', 'deepseek/deepseek-v4-pro')))?.text).toMatch(/Switched to DeepSeek: DeepSeek V4 Pro/)
  expect(w.read().env?.CLAUDE_CODE_SUBAGENT_MODEL).toBe('deepseek/deepseek-v4-pro')
  expect((await $.command.run(typed('removemodel', 'deepseek/deepseek-v4-pro')))?.text).toMatch(/Removed/)
  expect((await $.command.run(typed('findmodel')))?.text).toMatch(/Usage: \/findmodel/)

  // No argument: the search box opens above the prompt.
  await $.command.run(typed('addmodel'))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'search' })).toBeDefined()
  await ui.unmount()
})

test('mobile gets one button per model', KEY, async ($, on) => {
  mock.clock(on)
  const w = world(on, { settings: OPENROUTER_QWEN })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'mobile' })
  expect((await ui.find({ key: 'model-qwen' }))?.props.variant).toBe('primary')
  await ui.press({ key: 'model-anthropic' })
  expect(w.read().env).toBeUndefined()
  await ui.unmount()
})

test('settings live in CLAUDE_CONFIG_DIR when it is set', KEY, async ($, on) => {
  mock.clock(on)
  const w = world(on, { settings: { theme: 'dark' }, env: { USERPROFILE: HOME, CLAUDE_CONFIG_DIR: 'D:/claude-config' } })
  await $.session.start(START)
  await $.command.run(typed('switchfree'))
  expect(w.writes).toEqual(['D:/claude-config/settings.json'])
  expect(w.read('D:/claude-config/settings.json').env?.ANTHROPIC_MODEL).toBe('openrouter/free')
})

test('ids match whatever their capitals, and /switchmodel checks the id with OpenRouter first', KEY, async ($, on) => {
  mock.clock(on)
  const w = world(on, { settings: {} })
  await $.session.start(START)

  // No second copy of a built-in or added model, however it's capitalized.
  expect((await $.command.run(typed('addmodel', 'Qwen/Qwen3-Coder')))?.text).toMatch(/Qwen\/Qwen3-Coder is already in the list/)
  expect((await $.command.run(typed('addmodel', 'DeepSeek/DeepSeek-V4-Pro')))?.text).toMatch(/Added DeepSeek: DeepSeek V4 Pro \(paid\) \(deepseek\/deepseek-v4-pro\)/)
  expect((await $.command.run(typed('addmodel', 'deepseek/DEEPSEEK-v4-pro')))?.text).toMatch(/already in the list/)
  expect((await $.command.run(typed('removemodel', 'DEEPSEEK/deepseek-v4-pro')))?.text).toMatch(/Removed deepseek\/deepseek-v4-pro from the list/)

  // A typo or a model without tools never reaches settings.json.
  expect((await $.command.run(typed('switchmodel', 'deepseek/deepseek-v4-prro')))?.text).toMatch(/OpenRouter has no model with the id "deepseek\/deepseek-v4-prro"/)
  expect((await $.command.run(typed('switchmodel', 'acme/no-tools')))?.text).toMatch(/can't use tools, which Claude Code needs, so new sessions weren't switched to it/)
  expect(w.writes).toEqual([])
  expect((await $.command.run(typed('switchmodel', 'Meta-Llama/Llama-5-70B')))?.text).toMatch(/Switched to meta-llama\/llama-5-70b/)
  expect(w.read().env?.ANTHROPIC_MODEL).toBe('meta-llama/llama-5-70b')

  // A model that isn't in the dropdown shows as "Other".
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'model' }))?.props.value).toBe('other')
  await ui.unmount()
})

test("a router whose price varies isn't called free", async ($, on) => {
  mock.clock(on)
  world(on)
  await $.session.start(START)
  const text = (await $.command.run(typed('findmodel', 'auto router')))?.text
  expect(text).toMatch(/openrouter\/auto  -  Auto Router, price varies/)
  expect(text).not.toMatch(/Auto Router, free/)
})
