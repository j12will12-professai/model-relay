// Which model new sessions use: plain functions over the settings.json object. Reading and
// writing the file happens in register.tsx.
import type { AddedModel, SwitchChoice, SwitchState } from '../types'

// Claude Code reads these from the `env` block of its user settings.json when a session starts.
// Switching to OpenRouter sets them; switching back removes exactly these. Nothing else in the
// file is ever changed, permissions included.
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api'
// Every model Claude Code may call: the main one, background tasks, helper agents, and the
// haiku/sonnet/opus aliases, so nothing falls back to a paid Claude model through OpenRouter.
const MODEL_KEYS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
]
const KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', ...MODEL_KEYS]

const ANTHROPIC: SwitchChoice = { key: 'anthropic', label: 'Anthropic (Claude login)', detail: "Anthropic's Claude models on your Claude login" }
// The built-in OpenRouter choices; models the user adds join them. key: [model id, label, detail]
export const BUILT_IN: Record<string, [string, string, string]> = {
  free: ['openrouter/free', 'OpenRouter free router', "OpenRouter's free router (a different free model each request)"],
  coder: ['nvidia/nemotron-3-ultra-550b-a55b:free', 'Nemotron 3 Ultra (free coder)', 'NVIDIA Nemotron 3 Ultra, a free coding model'],
  qwen: ['qwen/qwen3-coder', 'Qwen3 Coder (paid)', 'Qwen3 Coder, paid (about $0.30 in / $1.00 out per million tokens)'],
}
export const isBuiltIn = (model: string) => Object.values(BUILT_IN).some(([id]) => id === model.toLowerCase())

export type Settings = Record<string, unknown> & { env?: Record<string, string> }

export function parseSettings(text: string, path: string): Settings {
  try {
    return JSON.parse(text) as Settings
  } catch {
    // Never overwrite a file this plugin can't read.
    throw new Error(`${path} isn't valid JSON, so model-relay left it alone. Fix the file, then try again.`)
  }
}

export const formatSettings = (settings: Settings) => `${JSON.stringify(settings, null, 2)}\n`

const isOpenRouter = (env: Record<string, string>) => (env.ANTHROPIC_BASE_URL ?? '').includes('openrouter.ai')

// What the plugin keeps in its store, read defensively.
export const asAdded = (stored: unknown): AddedModel[] => (Array.isArray(stored) ? (stored as AddedModel[]) : [])
export const asLastModel = (stored: unknown) => (typeof stored === 'string' && stored !== '' ? stored : BUILT_IN.free![0])

export function stateFrom(settings: Settings, added: AddedModel[]): SwitchState {
  const env = settings.env ?? {}
  const openrouter = isOpenRouter(env)
  const model = openrouter ? (env.ANTHROPIC_MODEL ?? null) : null
  const choices: SwitchChoice[] = [
    ANTHROPIC,
    ...Object.entries(BUILT_IN).map(([key, [id, label, detail]]) => ({ key, model: id, label, detail })),
    ...added.map(a => ({ key: a.model, model: a.model, label: a.label, detail: a.detail, custom: true })),
  ]
  const choice = openrouter ? choices.find(c => c.model !== undefined && c.model === model) : ANTHROPIC
  const summary = openrouter
    ? `New sessions use OpenRouter: ${choice?.detail ?? 'a model not in the list'} (${model ?? 'no model set'}).`
    : 'New sessions use Anthropic (your Claude login).'

  return { mode: openrouter ? 'openrouter' : 'anthropic', model, current: choice?.key ?? 'other', summary, choices }
}

// The settings with the OpenRouter entries removed, or 'already' when there are none.
export function withAnthropic(settings: Settings): Settings | 'already' {
  const env = { ...(settings.env ?? {}) }
  if (!isOpenRouter(env)) {
    return 'already'
  }
  for (const key of KEYS) {
    delete env[key]
  }
  const next: Settings = { ...settings, env }
  if (Object.keys(env).length === 0) {
    delete next.env
  }

  return next
}

// The settings pointing new sessions at OpenRouter with `model`. The key is the one the user gave
// the plugin's settings; with none, an OpenRouter key already in settings.json is left where it is.
export function withModel(settings: Settings, model: string, apiKey: string): Settings | 'already' | 'no-key' {
  const env = { ...(settings.env ?? {}) }
  const keepsKey = apiKey === '' && isOpenRouter(env) && Boolean(env.ANTHROPIC_AUTH_TOKEN)
  if (apiKey === '' && !keepsKey) {
    return 'no-key'
  }
  if (isOpenRouter(env) && MODEL_KEYS.every(k => env[k] === model) && (keepsKey || env.ANTHROPIC_AUTH_TOKEN === apiKey)) {
    return 'already'
  }
  env.ANTHROPIC_BASE_URL = OPENROUTER_BASE_URL
  if (!keepsKey) {
    env.ANTHROPIC_AUTH_TOKEN = apiKey
  }
  env.ANTHROPIC_API_KEY = ''
  for (const key of MODEL_KEYS) {
    env[key] = model
  }

  return { ...settings, env }
}
