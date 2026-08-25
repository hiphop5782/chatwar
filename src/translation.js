export const LANGUAGE_OPTIONS = [
  { code: 'ko', label: '한국어' }, { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' }, { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁體中文' }, { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' }, { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' }, { code: 'ru', label: 'Русский' },
  { code: 'it', label: 'Italiano' }, { code: 'hi', label: 'हिन्दी' },
  { code: 'id', label: 'Bahasa Indonesia' }, { code: 'th', label: 'ไทย' },
  { code: 'vi', label: 'Tiếng Việt' }, { code: 'tr', label: 'Türkçe' },
  { code: 'ar', label: 'العربية' }, { code: 'ms', label: 'Bahasa Melayu' },
  { code: 'pl', label: 'Polski' }, { code: 'nl', label: 'Nederlands' },
]

const TRANSLATION_API_URL =
  'https://script.google.com/macros/s/AKfycbwXtgjDeK8fKh9z8FhnCglgyKU_5rJuxaC5vTAKklfOdLVd9_KOhYWuD4eCnop2vAPgfg/exec'
const supportedCodes = new Set(LANGUAGE_OPTIONS.map(({ code }) => code))
const cache = new Map()

export function normalizeLanguage(language = '') {
  const normalized = language.replace('_', '-').toLowerCase()
  if (normalized.startsWith('zh')) return /(?:tw|hk|hant)/.test(normalized) ? 'zh-TW' : 'zh-CN'
  const base = normalized.split('-')[0]
  return supportedCodes.has(base) ? base : 'en'
}

export function getInitialLanguage() {
  const stored = localStorage.getItem('chatwar.language')
  if (stored && supportedCodes.has(stored)) return stored
  const browserLanguages = navigator.languages?.length ? navigator.languages : [navigator.language]
  return normalizeLanguage(browserLanguages.find(Boolean) ?? 'en')
}

async function translatePart(text, target) {
  if (!text.trim()) return text
  const cacheKey = `${target}:${text}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)

  const url = new URL(TRANSLATION_API_URL)
  url.searchParams.set('text', text)
  url.searchParams.set('target', target)

  const request = fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Translation failed: ${response.status}`)
      const result = await response.json()
      if (typeof result.translatedText !== 'string') throw new Error('Invalid translation response')
      return result.translatedText
    })
    .catch((error) => {
      cache.delete(cacheKey)
      throw error
    })

  cache.set(cacheKey, request)
  return request
}

export async function translateMessage(text, sourceLanguage, targetLanguage) {
  const source = normalizeLanguage(sourceLanguage)
  const target = normalizeLanguage(targetLanguage)
  if (!text || source === target) return text

  const parts = text.split(/(\[[^\]\n]{1,20}\])/g)
  const translatedParts = await Promise.all(parts.map((part) =>
    /^\[[^\]\n]{1,20}\]$/.test(part) ? part : translatePart(part, target),
  ))
  return translatedParts.join('')
}
