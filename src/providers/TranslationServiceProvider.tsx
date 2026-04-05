import { ExtendedKind } from '@/constants'
import { getPollMetadataFromEvent } from '@/lib/event-metadata'
import libreTranslate from '@/services/libre-translate.service'
import storage from '@/services/local-storage.service'
import openai from '@/services/openai.service'
import translation from '@/services/translation.service'
import { TTranslationAccount, TTranslationServiceConfig } from '@/types'
import { Event, kinds } from 'nostr-tools'
import { createContext, useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNostr } from './NostrProvider'

const translatedEventCache: Map<string, Event> = new Map()
const translatedTextCache: Map<string, string> = new Map()
const sourceLangCache: Map<string, string> = new Map()

type TTranslationServiceContext = {
  config: TTranslationServiceConfig
  translatedEventIdSet: Set<string>
  translateText: (text: string) => Promise<string>
  translateEvent: (event: Event) => Promise<Event | void>
  getTranslatedEvent: (eventId: string) => Event | null
  getSourceLang: (eventId: string) => string | null
  showOriginalEvent: (eventId: string) => void
  getAccount: () => Promise<TTranslationAccount | void>
  regenerateApiKey: () => Promise<string | undefined>
  updateConfig: (newConfig: TTranslationServiceConfig) => void
}

const TranslationServiceContext = createContext<TTranslationServiceContext | undefined>(undefined)

export const useTranslationService = () => {
  const context = useContext(TranslationServiceContext)
  if (!context) {
    throw new Error('useTranslation must be used within a TranslationProvider')
  }
  return context
}

export function TranslationServiceProvider({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation()
  const [config, setConfig] = useState<TTranslationServiceConfig>({ service: 'jumble' })
  const { pubkey, startLogin } = useNostr()
  const [translatedEventIdSet, setTranslatedEventIdSet] = useState<Set<string>>(new Set())

  useEffect(() => {
    translation.changeCurrentPubkey(pubkey)
    const config = storage.getTranslationServiceConfig(pubkey)
    setConfig(config)
  }, [pubkey])

  const getAccount = async (): Promise<TTranslationAccount | void> => {
    if (config.service !== 'jumble') return
    if (!pubkey) {
      startLogin()
      return
    }
    return await translation.getAccount()
  }

  const regenerateApiKey = async (): Promise<string | undefined> => {
    if (config.service !== 'jumble') return
    if (!pubkey) {
      startLogin()
      return
    }
    return await translation.regenerateApiKey()
  }

  const getTranslatedEvent = (eventId: string): Event | null => {
    const target = i18n.language
    const cacheKey = target + '_' + eventId
    return translatedEventCache.get(cacheKey) ?? null
  }

  const translate = async (text: string, target: string): Promise<{ text: string; sourceLang: string }> => {
    if (openai.isInitialized()) {
      const result = await openai.translateText(text, target)
      return { text: result.translated, sourceLang: result.sourceLang }
    } else if (config.service === 'libre_translate') {
      const text_ = await libreTranslate.translate(text, target, config.server, config.api_key)
      return { text: text_, sourceLang: '' }
    } else {
      const text_ = await translation.translate(text, target)
      return { text: text_, sourceLang: '' }
    }
  }

  const translateText = async (text: string): Promise<string> => {
    if (!text) {
      return text
    }

    const target = i18n.language
    const cacheKey = target + '_' + text
    const cache = translatedTextCache.get(cacheKey)
    if (cache) {
      return cache
    }

    const result = await translate(text, target)
    translatedTextCache.set(cacheKey, result.text)
    return result.text
  }

  const translateHighlightEvent = async (event: Event): Promise<{ event: Event; sourceLang: string }> => {
    const target = i18n.language
    const comment = event.tags.find((tag) => tag[0] === 'comment')?.[1]

    const texts = {
      content: event.content,
      comment
    }
    const joinedText = joinTexts(texts)
    if (!joinedText) return { event, sourceLang: '' }

    const result = await translate(joinedText, target)
    const translatedTexts = splitTranslatedText(result.text)
    return {
      event: {
        ...event,
        content: translatedTexts.content ?? event.content,
        tags: event.tags.map((tag) =>
          tag[0] === 'comment' ? ['comment', translatedTexts.comment ?? tag[1]] : tag
        )
      },
      sourceLang: result.sourceLang
    }
  }

  const translatePollEvent = async (event: Event): Promise<{ event: Event; sourceLang: string }> => {
    const target = i18n.language
    const pollMetadata = getPollMetadataFromEvent(event)

    const texts: Record<string, string> = {
      question: event.content,
      ...pollMetadata?.options.reduce(
        (acc, option) => {
          acc[option.id] = option.label
          return acc
        },
        {} as Record<string, string>
      )
    }
    const joinedText = joinTexts(texts)
    if (!joinedText) return { event, sourceLang: '' }

    const result = await translate(joinedText, target)
    const translatedTexts = splitTranslatedText(result.text)
    return {
      event: {
        ...event,
        content: translatedTexts.question ?? '',
        tags: event.tags.map((tag) =>
          tag[0] === 'option' ? ['option', tag[1], translatedTexts[tag[1]] ?? tag[2]] : tag
        )
      },
      sourceLang: result.sourceLang
    }
  }

  const getSourceLang = (eventId: string): string | null => {
    return sourceLangCache.get(eventId) ?? null
  }

  const translateEvent = async (event: Event): Promise<Event | void> => {
    if (config.service === 'jumble' && !openai.isInitialized() && !pubkey) {
      startLogin()
      return
    }

    const target = i18n.language
    const cacheKey = target + '_' + event.id
    const cache = translatedEventCache.get(cacheKey)
    if (cache) {
      setTranslatedEventIdSet((prev) => new Set(prev.add(event.id)))
      return cache
    }

    let translatedEvent: Event | undefined
    let sourceLang = ''
    if (event.kind === kinds.Highlights) {
      const r = await translateHighlightEvent(event)
      translatedEvent = r.event
      sourceLang = r.sourceLang
    } else if (event.kind === ExtendedKind.POLL) {
      const r = await translatePollEvent(event)
      translatedEvent = r.event
      sourceLang = r.sourceLang
    } else {
      const result = await translate(event.content, target)
      if (!result.text) {
        return
      }
      translatedEvent = { ...event, content: result.text }
      sourceLang = result.sourceLang
    }

    translatedEventCache.set(cacheKey, translatedEvent)
    if (sourceLang) sourceLangCache.set(event.id, sourceLang)
    setTranslatedEventIdSet((prev) => new Set(prev.add(event.id)))
    return translatedEvent
  }

  const showOriginalEvent = (eventId: string) => {
    setTranslatedEventIdSet((prev) => {
      const newSet = new Set(prev)
      newSet.delete(eventId)
      return newSet
    })
  }

  const updateConfig = (newConfig: TTranslationServiceConfig) => {
    setConfig(newConfig)
    storage.setTranslationServiceConfig(newConfig, pubkey)
  }

  return (
    <TranslationServiceContext.Provider
      value={{
        config,
        translatedEventIdSet,
        getAccount,
        regenerateApiKey,
        translateText,
        translateEvent,
        getTranslatedEvent,
        getSourceLang,
        showOriginalEvent,
        updateConfig
      }}
    >
      {children}
    </TranslationServiceContext.Provider>
  )
}

function joinTexts(texts: Record<string, string | undefined>): string {
  return (
    Object.entries(texts).filter(([, content]) => content && content.trim() !== '') as [
      string,
      string
    ][]
  )
    .map(([key, content]) => `=== ${key} ===\n${content.trim()}\n=== ${key} ===`)
    .join('\n\n')
}

function splitTranslatedText(translated: string) {
  const regex = /=== (.+?) ===\n([\s\S]*?)\n=== \1 ===/g
  const results: Record<string, string | undefined> = {}

  let match: RegExpExecArray | null
  while ((match = regex.exec(translated)) !== null) {
    const key = match[1].trim()
    const content = match[2].trim()
    results[key] = content
  }

  return results
}
