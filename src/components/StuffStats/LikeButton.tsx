import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerOverlay } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { LONG_PRESS_THRESHOLD, SPECIAL_TRUST_SCORE_FILTER_ID } from '@/constants'
import { useStuff } from '@/hooks/useStuff'
import { useStuffStatsById } from '@/hooks/useStuffStatsById'
import {
  createExternalContentReactionDraftEvent,
  createReactionDraftEvent
} from '@/lib/draft-event'
import { getDefaultRelayUrls } from '@/lib/relay'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import client from '@/services/client.service'
import stuffStatsService from '@/services/stuff-stats.service'
import { TEmoji } from '@/types'
import { ArrowLeft, Loader, SendHorizonal, SmilePlus } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Emoji from '../Emoji'
import EmojiPicker from '../EmojiPicker'
import SuggestedEmojis from '../SuggestedEmojis'
import { formatCount } from './utils'
import { formatError } from '@/lib/error'
import { toast } from 'sonner'

export default function LikeButton({ stuff }: { stuff: Event | string }) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { pubkey, publish, checkLogin } = useNostr()
  const { getMinTrustScore, meetsMinTrustScore } = useUserTrust()
  const { quickReaction, quickReactionEmoji, disableReactions } = useUserPreferences()
  const { event, externalContent, stuffKey } = useStuff(stuff)
  const [liking, setLiking] = useState(false)
  const [isEmojiReactionsOpen, setIsEmojiReactionsOpen] = useState(false)
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [isTextInputMode, setIsTextInputMode] = useState(false)
  const [textReaction, setTextReaction] = useState('')
  const [likeCount, setLikeCount] = useState(0)
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const isLongPressRef = useRef(false)
  const noteStats = useStuffStatsById(stuffKey)
  const myLastEmoji = useMemo(() => {
    const stats = noteStats || {}
    const myLike = stats.likes?.find((like) => like.pubkey === pubkey)
    return myLike?.emoji
  }, [noteStats, pubkey])

  useEffect(() => {
    const filterLikes = async () => {
      const stats = noteStats || {}
      const likes = stats.likes || []
      let count = 0

      const trustScoreThreshold = getMinTrustScore(SPECIAL_TRUST_SCORE_FILTER_ID.INTERACTIONS)
      if (!trustScoreThreshold) {
        setLikeCount(likes.length)
        return
      }
      await Promise.all(
        likes.map(async (like) => {
          if (await meetsMinTrustScore(like.pubkey, trustScoreThreshold)) {
            count++
          }
        })
      )
      setLikeCount(count)
    }
    filterLikes()
  }, [noteStats, meetsMinTrustScore, getMinTrustScore])

  useEffect(() => {
    setTimeout(() => {
      setIsPickerOpen(false)
      setIsTextInputMode(false)
      setTextReaction('')
    }, 100)
  }, [isEmojiReactionsOpen])

  const like = async (emoji: string | TEmoji) => {
    checkLogin(async () => {
      if (liking || !pubkey) return

      setLiking(true)
      const timer = setTimeout(() => setLiking(false), 10_000)

      try {
        if (!noteStats?.updatedAt) {
          await stuffStatsService.fetchStuffStats(stuffKey, pubkey)
        }

        const reaction = event
          ? createReactionDraftEvent(event, emoji)
          : createExternalContentReactionDraftEvent(externalContent, emoji)
        const seenOn = event ? client.getSeenEventRelayUrls(event.id) : getDefaultRelayUrls()
        const evt = await publish(reaction, { additionalRelayUrls: seenOn })
        stuffStatsService.updateStuffStatsByEvents([evt])
      } catch (error) {
        const errors = formatError(error)
        errors.forEach((err) => {
          toast.error(`${t('Failed to like')}: ${err}`, { duration: 10_000 })
        })
      } finally {
        setLiking(false)
        clearTimeout(timer)
      }
    })
  }

  const handleLongPressStart = () => {
    if (!quickReaction) return
    isLongPressRef.current = false
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true
      setIsEmojiReactionsOpen(true)
    }, LONG_PRESS_THRESHOLD)
  }

  const handleLongPressEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handleClick = (e: React.MouseEvent | React.TouchEvent) => {
    if (quickReaction) {
      // If it was a long press, don't trigger the click action
      if (isLongPressRef.current) {
        isLongPressRef.current = false
        return
      }
      // Quick reaction mode: click to react with default emoji
      // Prevent dropdown from opening
      e.preventDefault()
      e.stopPropagation()
      like(quickReactionEmoji)
    } else {
      setIsEmojiReactionsOpen(true)
    }
  }

  if (disableReactions) {
    if (!likeCount && !myLastEmoji) return null
    return (
      <div className="flex h-full items-center gap-1 px-3 text-muted-foreground">
        {myLastEmoji ? (
          <Emoji emoji={myLastEmoji} classNames={{ img: 'size-4' }} />
        ) : (
          <SmilePlus />
        )}
        {!!likeCount && <div className="text-sm">{formatCount(likeCount)}</div>}
      </div>
    )
  }

  const trigger = (
    <button
      className="flex h-full items-center gap-1 px-3 text-muted-foreground enabled:hover:text-primary"
      title={t('Like')}
      disabled={liking}
      onClick={handleClick}
      onMouseDown={handleLongPressStart}
      onMouseUp={handleLongPressEnd}
      onMouseLeave={handleLongPressEnd}
      onTouchStart={handleLongPressStart}
      onTouchEnd={handleLongPressEnd}
    >
      {liking ? (
        <Loader className="animate-spin" />
      ) : myLastEmoji ? (
        <>
          <Emoji emoji={myLastEmoji} classNames={{ img: 'size-4' }} />
          {!!likeCount && <div className="text-sm">{formatCount(likeCount)}</div>}
        </>
      ) : (
        <>
          <SmilePlus />
          {!!likeCount && <div className="text-sm">{formatCount(likeCount)}</div>}
        </>
      )}
    </button>
  )

  const textReactionInput = (
    <div className="flex items-center gap-1 p-2" onClick={(e) => e.stopPropagation()}>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 text-muted-foreground"
        onClick={() => setIsTextInputMode(false)}
      >
        <ArrowLeft size={16} />
      </Button>
      <Input
        autoFocus
        className="h-8"
        placeholder={t('React with text...')}
        value={textReaction}
        onChange={(e) => setTextReaction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && textReaction.trim()) {
            setIsEmojiReactionsOpen(false)
            like(textReaction.trim())
          }
        }}
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 text-muted-foreground enabled:hover:text-primary"
        disabled={!textReaction.trim()}
        onClick={() => {
          if (!textReaction.trim()) return
          setIsEmojiReactionsOpen(false)
          like(textReaction.trim())
        }}
      >
        <SendHorizonal size={16} />
      </Button>
    </div>
  )

  if (isSmallScreen) {
    return (
      <>
        {trigger}
        <Drawer open={isEmojiReactionsOpen} onOpenChange={setIsEmojiReactionsOpen}>
          <DrawerOverlay onClick={() => setIsEmojiReactionsOpen(false)} />
          <DrawerContent hideOverlay>
            {isTextInputMode ? (
              textReactionInput
            ) : (
              <EmojiPicker
                onEmojiClick={(emoji) => {
                  setIsEmojiReactionsOpen(false)
                  if (!emoji) return

                  like(emoji)
                }}
                onTextReactionClick={() => setIsTextInputMode(true)}
              />
            )}
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  return (
    <Popover open={isEmojiReactionsOpen} onOpenChange={(open) => setIsEmojiReactionsOpen(open)}>
      <PopoverAnchor asChild>{trigger}</PopoverAnchor>
      <PopoverContent side="top" className="w-fit border-0 p-0 shadow-lg">
        {isTextInputMode ? (
          textReactionInput
        ) : isPickerOpen ? (
          <EmojiPicker
            onEmojiClick={(emoji, e) => {
              e.stopPropagation()
              setIsEmojiReactionsOpen(false)
              if (!emoji) return

              like(emoji)
            }}
            onTextReactionClick={() => setIsTextInputMode(true)}
          />
        ) : (
          <SuggestedEmojis
            onEmojiClick={(emoji) => {
              setIsEmojiReactionsOpen(false)
              like(emoji)
            }}
            onMoreButtonClick={() => {
              setIsPickerOpen(true)
            }}
            onTextReactionClick={() => setIsTextInputMode(true)}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}
