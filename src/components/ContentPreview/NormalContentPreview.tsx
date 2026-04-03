import { useTranslatedEvent } from '@/hooks'
import { getEmojiInfosFromEmojiTags } from '@/lib/tag'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import Content from './Content'

export default function NormalContentPreview({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const translatedEvent = useTranslatedEvent(event?.id)
  const emojiInfos = useMemo(() => getEmojiInfosFromEmojiTags(event?.tags), [event])
  const { satsToBitcoins } = useUserPreferences()

  const rawContent = translatedEvent?.content ?? event.content
  const content = satsToBitcoins
    ? rawContent.replace(/\bsats\b/gi, (match) =>
        match[0] === match[0].toUpperCase() ? 'Bitcoins' : 'bitcoins'
      )
    : rawContent

  return (
    <Content
      content={content}
      className={className}
      emojiInfos={emojiInfos}
    />
  )
}
