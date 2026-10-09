// One entry of the dropdown: Anthropic, a built-in OpenRouter model, or one the user added.
export type SwitchChoice = { key: string; label: string; detail: string; model?: string; custom?: boolean }
// What new sessions will use, read from settings.json, and the choices to switch between.
export type SwitchState = {
  mode: 'anthropic' | 'openrouter'
  model: string | null
  current: string
  summary: string
  choices: SwitchChoice[]
}
// One model from OpenRouter's catalog (tool-capable models only); `rank` is its place in
// OpenRouter's ranking when the search was for a type such as coding.
export type SearchHit = { id: string; name: string; label: string; price: string; detail: string; rank: number | null }
// A search's answer: a heading saying what the list is, and the models.
export type SearchResult = { title: string; hits: SearchHit[] }
// The add/remove panel while it is open: what was searched and what came back.
export type Manage = { query: string; title: string; hits: SearchHit[] }
// A model the user added to the dropdown, kept in the plugin's store across sessions.
export type AddedModel = { model: string; label: string; detail: string }

declare module 'claude-code' {
  interface PluginState {
    // `searching`: what the search box is looking for right now, or null when no search runs.
    'model-relay': { setting: SwitchState | null; note: string; manage: Manage | null; searching: string | null }
  }
}
