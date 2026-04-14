import NoteList, { TNoteListRef } from '@/components/NoteList'
import Tabs from '@/components/Tabs'
import TrustScoreFilter from '@/components/TrustScoreFilter'
import { Button } from '@/components/ui/button'
import UserAggregationList, { TUserAggregationListRef } from '@/components/UserAggregationList'
import { ExtendedKind } from '@/constants'
import { isTouchDevice } from '@/lib/utils'
import { useKindFilter } from '@/providers/KindFilterProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import storage from '@/services/local-storage.service'
import { TFeedSubRequest, TNoteListMode } from '@/types'
import { useMemo, useRef, useState } from 'react'
import { Event } from 'nostr-tools'
import { VolumeX } from 'lucide-react'
import KindFilter from '../KindFilter'
import { RefreshButton } from '../RefreshButton'

export default function NormalFeed({
  trustScoreFilterId,
  subRequests,
  areAlgoRelays = false,
  isMainFeed = false,
  showRelayCloseReason = false,
  disable24hMode = false,
  onRefresh,
  isPubkeyFeed = false,
  filterMutedNotes = true,
  showMutedContent = false,
  filterFn
}: {
  trustScoreFilterId?: string
  subRequests: TFeedSubRequest[]
  areAlgoRelays?: boolean
  isMainFeed?: boolean
  showRelayCloseReason?: boolean
  disable24hMode?: boolean
  onRefresh?: () => void
  isPubkeyFeed?: boolean
  filterMutedNotes?: boolean
  showMutedContent?: boolean
  filterFn?: (event: Event) => boolean
}) {
  const { showKinds } = useKindFilter()
  const { getMinTrustScore } = useUserTrust()
  const [temporaryShowKinds, setTemporaryShowKinds] = useState(showKinds)
  const [listMode, setListMode] = useState<TNoteListMode>(() => storage.getNoteListMode())
  const supportTouch = useMemo(() => isTouchDevice(), [])
  const noteListRef = useRef<TNoteListRef>(null)
  const userAggregationListRef = useRef<TUserAggregationListRef>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const showKindsFilter = useMemo(() => {
    return subRequests.every((req) => !req.filter.kinds?.length)
  }, [subRequests])
  const [trustFilterOpen, setTrustFilterOpen] = useState(false)
  const [showMuted, setShowMuted] = useState(false)
  const trustScoreThreshold = useMemo(() => {
    return trustScoreFilterId ? getMinTrustScore(trustScoreFilterId) : undefined
  }, [trustScoreFilterId, getMinTrustScore])

  const handleListModeChange = (mode: TNoteListMode) => {
    setListMode(mode)
    if (isMainFeed) {
      storage.setNoteListMode(mode)
    }
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleShowKindsChange = (newShowKinds: number[]) => {
    setTemporaryShowKinds(newShowKinds)
    noteListRef.current?.scrollToTop()
  }

  const handleTrustFilterOpenChange = (open: boolean) => {
    setTrustFilterOpen(open)
  }

  const combinedFilterFn = useMemo(() => {
    return (event: Event) => {
      if (
        event.kind === ExtendedKind.FOLLOW_SET &&
        event.tags.some(
          (tag) =>
            (tag[0] === 'd' || tag[0] === 'title') && tag[1]?.toLowerCase() === 'bookmark'
        )
      ) {
        return false
      }
      if (
        (event.kind === ExtendedKind.FOLLOW_SET ||
          event.kind === ExtendedKind.FOLLOW_PACK ||
          event.kind === 10000) &&
        !event.tags.some((tag) => tag[0] === 'p')
      ) {
        return false
      }
      return filterFn ? filterFn(event) : true
    }
  }, [filterFn])

  return (
    <>
      <Tabs
        value={listMode === '24h' && disable24hMode ? 'posts' : listMode}
        tabs={[
          { value: 'posts', label: 'Notes' },
          { value: 'postsAndReplies', label: 'Replies' },
          ...(!disable24hMode ? [{ value: '24h', label: '24h Pulse' }] : [])
        ]}
        onTabChange={(listMode) => {
          handleListModeChange(listMode as TNoteListMode)
        }}
        options={
          <>
            <Button
              variant="ghost"
              size="titlebar-icon"
              className={showMuted ? 'text-foreground' : 'text-muted-foreground'}
              onClick={() => setShowMuted((v) => !v)}
              title={showMuted ? 'Hide muted users' : 'Show muted users'}
            >
              <VolumeX size={16} />
            </Button>
            {!supportTouch && (
              <RefreshButton
                onClick={() => {
                  if (onRefresh) {
                    onRefresh()
                    return
                  }
                  if (listMode === '24h') {
                    userAggregationListRef.current?.refresh()
                  } else {
                    noteListRef.current?.refresh()
                  }
                }}
              />
            )}
            {trustScoreFilterId && (
              <TrustScoreFilter
                filterId={trustScoreFilterId}
                onOpenChange={handleTrustFilterOpenChange}
              />
            )}
            {showKindsFilter && (
              <KindFilter
                showKinds={temporaryShowKinds}
                onShowKindsChange={handleShowKindsChange}
              />
            )}
          </>
        }
        active={trustFilterOpen}
      />
      <div ref={topRef} className="scroll-mt-[calc(6rem+1px)]" />
      {listMode === '24h' && !disable24hMode ? (
        <UserAggregationList
          ref={userAggregationListRef}
          showKinds={temporaryShowKinds}
          subRequests={subRequests}
          areAlgoRelays={areAlgoRelays}
          showRelayCloseReason={showRelayCloseReason}
          isPubkeyFeed={isPubkeyFeed}
          trustScoreThreshold={trustScoreThreshold}
        />
      ) : (
        <NoteList
          ref={noteListRef}
          showKinds={temporaryShowKinds}
          subRequests={subRequests}
          hideReplies={listMode === 'posts'}
          areAlgoRelays={areAlgoRelays}
          showRelayCloseReason={showRelayCloseReason}
          isPubkeyFeed={isPubkeyFeed}
          trustScoreThreshold={trustScoreThreshold}
          filterMutedNotes={showMuted ? false : filterMutedNotes}
          showMutedContent={showMuted ? true : showMutedContent}
          filterFn={combinedFilterFn}
        />
      )}
    </>
  )
}

