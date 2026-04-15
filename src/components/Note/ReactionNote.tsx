import { useSecondaryPage } from '@/PageManager'
import { toNote } from '@/lib/link'
import { generateBech32IdFromATag, generateBech32IdFromETag, tagNameEquals } from '@/lib/tag'
import { TEmoji } from '@/types'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Emoji from '../Emoji'
import ParentNotePreview from '../ParentNotePreview'

export default function ReactionNote({ event, className }: { event: Event; className?: string }) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()

  const targetBech32Id = useMemo(() => {
    const eTags = event.tags.filter(tagNameEquals('e'))
    const lastETag = eTags[eTags.length - 1]
    if (lastETag) return generateBech32IdFromETag(lastETag)

    const aTags = event.tags.filter(tagNameEquals('a'))
    const lastATag = aTags[aTags.length - 1]
    if (lastATag) return generateBech32IdFromATag(lastATag)

    return undefined
  }, [event])

  const emoji = useMemo<TEmoji | string>(() => {
    const content = event.content || '+'
    const match = content.match(/^:([^:]+):$/)
    if (match) {
      const shortcode = match[1]
      const emojiTag = event.tags.find(
        (tag) => tag[0] === 'emoji' && tag[1] === shortcode && tag[2]
      )
      if (emojiTag) {
        return { shortcode: emojiTag[1], url: emojiTag[2] } as TEmoji
      }
    }
    return content
  }, [event])

  return (
    <div className={className}>
      <div className="text-2xl leading-none">
        <Emoji emoji={emoji} classNames={{ img: 'size-8' }} />
      </div>
      {targetBech32Id && (
        <ParentNotePreview
          label={t('reacted to')}
          eventId={targetBech32Id}
          className="mt-2"
          onClick={(e) => {
            e.stopPropagation()
            push(toNote(targetBech32Id))
          }}
        />
      )}
    </div>
  )
}
