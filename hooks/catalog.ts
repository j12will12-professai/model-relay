// Searching OpenRouter's model catalog: plain functions over the catalog's JSON. The request
// itself is made in register.tsx.
import type { SearchHit, SearchResult } from '../types'

// OpenRouter's public model list. Reading it needs no key and sends nothing about the user.
const CATALOG_URL = 'https://openrouter.ai/api/v1/models'

export type Model = {
  id: string
  name?: string
  pricing?: Record<string, string>
  supported_parameters?: string[]
  architecture?: { input_modalities?: string[] }
}

// Searching by type. OpenRouter's own use-case categories (it ranks the top models in each):
// category: [the name shown, the words that pick it]. Words found in model names ("coder",
// "thinking", "research", "image") are left out so they still search by name.
const CATEGORIES: Record<string, [string, string[]]> = {
  programming: ['coding', ['coding', 'programming', 'programmer', 'developer', 'software']],
  roleplay: ['roleplay', ['roleplay', 'role-play', 'rp', 'characters']],
  marketing: ['marketing', ['marketing', 'ads', 'advertising', 'copywriting']],
  'marketing/seo': ['SEO', ['seo']],
  technology: ['technology', ['technology', 'tech']],
  science: ['science', ['science', 'scientific']],
  translation: ['translation', ['translation', 'translate', 'translating', 'translator']],
  legal: ['legal', ['legal', 'law', 'lawyer']],
  finance: ['finance', ['finance', 'financial', 'accounting']],
  health: ['health', ['health', 'medical', 'medicine']],
  trivia: ['trivia', ['trivia', 'knowledge']],
  academia: ['academia', ['academia', 'academic', 'study']],
}

// ...and what a model can do, read from the catalog: name: [the words that pick it, the test].
const ABILITIES: Record<string, [string[], (m: Model) => boolean]> = {
  reasoning: [['reasoning', 'reasoner'], m => (m.supported_parameters ?? []).includes('reasoning')],
  vision: [['vision', 'images', 'pictures', 'multimodal'], m => (m.architecture?.input_modalities ?? []).includes('image')],
}

// How one search reads its words: an OpenRouter category, abilities, and the words left for names.
export type Plan = { query: string; category?: string; abilities: string[]; rest: string[] }

export const wordsOf = (text: string) => text.toLowerCase().split(/\s+/).filter(w => w !== '')

// With `byType` false every word is matched against model names and ids.
export function plan(words: string[], byType: boolean): Plan {
  const query = words.join(' ')
  if (!byType) {
    return { query, abilities: [], rest: words }
  }
  const category = Object.keys(CATEGORIES).find(c => words.some(w => CATEGORIES[c]![1].includes(w)))
  const abilities = Object.keys(ABILITIES).filter(a => words.some(w => ABILITIES[a]![0].includes(w)))
  const isTypeWord = (w: string) =>
    (category !== undefined && CATEGORIES[category]![1].includes(w)) || abilities.some(a => ABILITIES[a]![0].includes(w))

  return { query, category, abilities, rest: words.filter(w => !isTypeWord(w)) }
}

// The catalog's address: with a category, OpenRouter's top models for that use, in its ranking order.
export const catalogUrl = (category?: string) => (category ? `${CATALOG_URL}?category=${encodeURIComponent(category)}` : CATALOG_URL)

export const parseCatalog = (text: string) => (JSON.parse(text) as { data: Model[] }).data

// Claude Code can't work without tool calls, so only models that support them are offered.
export const canUseTools = (m: Model) => (m.supported_parameters ?? []).includes('tools')

export function price(m: Model) {
  const cin = Number(m.pricing?.prompt ?? 0) * 1e6
  const cout = Number(m.pricing?.completion ?? 0) * 1e6
  // OpenRouter lists a router that picks a model per request (openrouter/auto) at -1.
  if (Number.isNaN(cin) || Number.isNaN(cout) || cin < 0 || cout < 0) {
    return 'price varies'
  }
  if (cin === 0 && cout === 0) {
    return 'free'
  }

  return `$${cin.toFixed(2)} in / $${cout.toFixed(2)} out per million tokens`
}

// One catalog entry as the menus show it.
export function summary(m: Model, rank: number | null = null): SearchHit {
  const cost = price(m)
  const name = m.name ?? m.id
  const tag = cost === 'free' ? 'free' : 'paid'
  const label = name.toLowerCase().includes(`(${tag})`) ? name : `${name} (${tag})`

  return { id: m.id, name, label, price: cost, detail: `${name}, ${cost}`, rank }
}

// The models of `catalog` that fit the plan, with a heading saying what the list is.
export function select(catalog: Model[], p: Plan, limit: number): SearchResult & { typed: boolean } {
  let found = catalog
    .map((m, i) => ({ rank: i + 1, m }))
    .filter(
      ({ m }) =>
        canUseTools(m) &&
        p.abilities.every(a => ABILITIES[a]![1](m)) &&
        p.rest.every(w => `${m.id} ${m.name ?? ''}`.toLowerCase().includes(w)),
    )
  const kinds = [...(p.category ? [CATEGORIES[p.category]![0]] : []), ...p.abilities]
  let title: string
  if (p.category) {
    title = `OpenRouter's top ${kinds.join(' + ')} models, in its ranking order`
  } else {
    // An exact id first, then the free ones, then the rest, each in OpenRouter's order (newest first).
    const order = (m: Model) => Number(m.id !== p.query) * 2 + Number(price(m) !== 'free')
    found = found.sort((a, b) => order(a.m) - order(b.m))
    title = kinds.length > 0 ? `OpenRouter models with ${kinds.join(' + ')}` : `OpenRouter models matching "${p.query}"`
  }
  if (p.rest.length > 0 && kinds.length > 0) {
    title += `, matching "${p.rest.join(' ')}"`
  }
  const hits = found.slice(0, limit).map(({ rank, m }) => summary(m, p.category ? rank : null))

  return { title, hits, typed: kinds.length > 0 }
}

// Search results as text, for the slash commands.
export function asText(result: SearchResult, query: string) {
  if (result.hits.length === 0) {
    return `No OpenRouter model that can use tools matches "${query}".`
  }
  const lines = result.hits.map(h => `${h.rank ? `#${h.rank}  ` : ''}${h.id}  -  ${h.name}, ${h.price}`)

  return [`${result.title} (only models that can use tools):`, ...lines, 'Add one with: /addmodel <id>'].join('\n')
}
