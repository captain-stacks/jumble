import { useSecondaryPage } from '@/PageManager'
import { Skeleton } from '@/components/ui/skeleton'
import { SPECIAL_TRUST_SCORE_FILTER_ID } from '@/constants'
import { useFetchEvents } from '@/hooks/useFetchEvent'
import { useThread } from '@/hooks/useThread'
import { getEventKey } from '@/lib/event'
import { toNote } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { Event } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import ClickableCard from '../ClickableCard'
import ClientTag from '../ClientTag'
import Collapsible from '../Collapsible'
import Content from '../Content'
import { FormattedTimestamp } from '../FormattedTimestamp'
import Nip05 from '../Nip05'
import NoteOptions from '../NoteOptions'
import OpBadge from '../OpBadge'
import ParentNotePreview from '../ParentNotePreview'
import PowBadge from '../PowBadge'
import StuffStats from '../StuffStats'
import TranslateButton from '../TranslateButton'
import TrustScoreBadge from '../TrustScoreBadge'
import UserAvatar, { UserAvatarSkeleton } from '../UserAvatar'
import Username from '../Username'

export default function ReplyNote({
  event,
  parentEventId,
  onClickParent = () => {},
  highlight = false,
  hideThreadGuide = false,
  className = '',
  opPubkey
}: {
  event: Event
  parentEventId?: string
  onClickParent?: () => void
  highlight?: boolean
  hideThreadGuide?: boolean
  className?: string
  opPubkey?: string
}) {
  const { isSmallScreen } = useScreenSize()
  const { push } = useSecondaryPage()
  const { getMinTrustScore, meetsMinTrustScore } = useUserTrust()
  const { autoLoadProfilePicture } = useContentPolicy()
  const eventKey = useMemo(() => getEventKey(event), [event])
  const replyIds = useThread(eventKey)
  const { eventsById: replyEventsById } = useFetchEvents(replyIds)
  const replies = useMemo(
    () => replyIds.flatMap((id) => (replyEventsById.get(id) ? [replyEventsById.get(id)!] : [])),
    [replyIds, replyEventsById]
  )
  const [hasReplies, setHasReplies] = useState(false)

  useEffect(() => {
    const checkHasReplies = async () => {
      if (!replies || replies.length === 0) {
        setHasReplies(false)
        return
      }

      const trustScoreThreshold = getMinTrustScore(SPECIAL_TRUST_SCORE_FILTER_ID.INTERACTIONS)
      for (const reply of replies) {
        if (trustScoreThreshold && !(await meetsMinTrustScore(reply.pubkey, trustScoreThreshold))) {
          continue
        }
        setHasReplies(true)
        return
      }
      setHasReplies(false)
    }

    checkHasReplies()
  }, [replies, getMinTrustScore, meetsMinTrustScore])

  return (
    <ClickableCard
      className={cn(
        'clickable relative pb-3 transition-colors duration-500',
        highlight ? 'bg-primary/40' : '',
        className
      )}
      onClick={() => push(toNote(event))}
    >
      {hasReplies &&
        !hideThreadGuide &&
        (autoLoadProfilePicture ? (
          <div className="bg-border absolute inset-s-8.25 top-14 bottom-0 z-20 w-0.5" />
        ) : (
          <div className="absolute inset-s-2 top-5 bottom-0 z-20 w-3 rounded-ss-lg border-s-2 border-t-2" />
        ))}
      <Collapsible>
        <div
          className={cn(
            'flex items-start gap-2 pe-4 pt-3',
            autoLoadProfilePicture || hideThreadGuide ? 'ps-4' : 'ps-7'
          )}
        >
          <UserAvatar userId={event.pubkey} size="medium" className="mt-0.5 shrink-0" />
          <div className="w-full overflow-hidden">
            <div className="flex items-start justify-between gap-2">
              <div className="w-0 flex-1">
                <div className="flex items-center gap-1">
                  <Username
                    userId={event.pubkey}
                    className="text-muted-foreground hover:text-foreground truncate text-sm font-semibold"
                    skeletonClassName="h-3"
                  />
                  {opPubkey === event.pubkey && <OpBadge />}
                  <TrustScoreBadge pubkey={event.pubkey} className="size-3.5!" />
                  <ClientTag event={event} />
                </div>
                <div className="text-muted-foreground flex items-center gap-1 text-sm">
                  <Nip05 pubkey={event.pubkey} append="·" />
                  <FormattedTimestamp
                    timestamp={event.created_at}
                    className="shrink-0"
                    short={isSmallScreen}
                  />
                  <PowBadge event={event} className="shrink-0" />
                </div>
              </div>
              <div className="flex shrink-0 items-center">
                <TranslateButton event={event} className="py-0" />
                <NoteOptions event={event} className="shrink-0 [&_svg]:size-5" />
              </div>
            </div>
            {parentEventId && (
              <ParentNotePreview
                className="mt-2"
                eventId={parentEventId}
                onClick={(e) => {
                  e.stopPropagation()
                  onClickParent()
                }}
              />
            )}
            <Content className="mt-2" event={event} />
          </div>
        </div>
      </Collapsible>
      <StuffStats
        className={cn(
          'me-4 mt-2 ps-1',
          autoLoadProfilePicture ? 'ms-14' : hideThreadGuide ? 'ms-4' : 'ms-7'
        )}
        classNames={{
          topList: cn(
            '-me-4',
            autoLoadProfilePicture ? '-ms-14' : hideThreadGuide ? '-ms-4' : '-ms-7'
          ),
          topListContent: cn(
            'pe-4',
            autoLoadProfilePicture ? 'ps-14' : hideThreadGuide ? 'ps-4' : 'ps-7'
          )
        }}
        stuff={event}
        displayTopZapsAndLikes
      />
    </ClickableCard>
  )
}

export function ReplyNoteSkeleton() {
  return (
    <div className="flex w-full items-start gap-2 px-4 py-3">
      <UserAvatarSkeleton className="mt-0.5 h-9 w-9" />
      <div className="w-full">
        <div className="py-1">
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="my-1">
          <Skeleton className="my-1 mt-2 h-4 w-full" />
        </div>
        <div className="my-1">
          <Skeleton className="my-1 h-4 w-2/3" />
        </div>
      </div>
    </div>
  )
}
