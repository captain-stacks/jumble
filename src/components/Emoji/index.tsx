import { isInsecureUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import recentEmojiService from '@/services/recent-emoji.service'
import { TEmoji } from '@/types'
import { Heart, ImageOff } from 'lucide-react'
import { HTMLAttributes, useState } from 'react'

export default function Emoji({
  emoji,
  classNames
}: Omit<HTMLAttributes<HTMLDivElement>, 'className'> & {
  emoji: TEmoji | string
  classNames?: {
    text?: string
    img?: string
  }
}) {
  const { allowInsecureConnection } = useUserPreferences()
  const [hasError, setHasError] = useState(false)

  if (typeof emoji === 'string') {
    return emoji === '+' ? (
      <Heart className={cn('size-5 fill-red-400 text-red-400', classNames?.img)} />
    ) : (
      <span className={cn('whitespace-nowrap', classNames?.text)}>{emoji}</span>
    )
  }

  if (hasError || (!allowInsecureConnection && isInsecureUrl(emoji.url))) {
    if (!classNames?.text) {
      return (
        <span
          title={`:${emoji.shortcode}:`}
          className={cn(
            'inline-flex items-center justify-center align-middle text-muted-foreground',
            classNames?.img
          )}
        >
          <ImageOff className="size-1/2" />
        </span>
      )
    }
    return (
      <span className={cn('whitespace-nowrap', classNames?.text)}>{`:${emoji.shortcode}:`}</span>
    )
  }

  return (
    <img
      src={emoji.url}
      alt={emoji.shortcode}
      draggable={false}
      className={cn('pointer-events-none inline-block size-5', classNames?.img)}
      onLoad={() => {
        setHasError(false)
      }}
      onError={() => {
        setHasError(true)
        recentEmojiService.markBroken(emoji.url)
      }}
    />
  )
}
