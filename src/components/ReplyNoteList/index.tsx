import { useFilteredReplies } from '@/hooks'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { useStuff } from '@/hooks/useStuff'
import { getEventKey } from '@/lib/event'
import threadService from '@/services/thread.service'
import { Event as NEvent } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingBar } from '../LoadingBar'
import ReplyNote, { ReplyNoteSkeleton } from '../ReplyNote'
import SubReplies from './SubReplies'

const LIMIT = 100
const SHOW_COUNT = 10

export default function ReplyNoteList({ stuff, showMutedContent = false }: { stuff: NEvent | string; showMutedContent?: boolean }) {
  const { t } = useTranslation()
  const { stuffKey } = useStuff(stuff)
  const [initialLoading, setInitialLoading] = useState(false)
  const { replies } = useFilteredReplies(stuffKey, showMutedContent)

  // Initial subscription
  useEffect(() => {
    const loadInitial = async () => {
      setInitialLoading(true)
      await threadService.subscribe(stuff, LIMIT)
      setInitialLoading(false)
    }

    loadInitial()

    return () => {
      threadService.unsubscribe(stuff)
    }
  }, [stuff])

  const handleLoadMore = useCallback(async () => {
    return await threadService.loadMore(stuff, LIMIT)
  }, [stuff])

  const { visibleItems, loading, shouldShowLoadingIndicator, bottomRef } = useInfiniteScroll({
    items: replies,
    showCount: SHOW_COUNT,
    onLoadMore: handleLoadMore,
    initialLoading
  })

  return (
    <div>
      {(loading || initialLoading) && <LoadingBar />}
      <div>
        {visibleItems.map((reply) => (
          <Item key={reply.id} reply={reply} showMutedContent={showMutedContent} />
        ))}
      </div>
      <div ref={bottomRef} />
      {shouldShowLoadingIndicator ? (
        <ReplyNoteSkeleton />
      ) : (
        <div className="mb-3 mt-2 text-center text-sm text-muted-foreground">
          {replies.length > 0 ? t('no more replies') : t('no replies')}
        </div>
      )}
    </div>
  )
}

function Item({ reply, showMutedContent }: { reply: NEvent; showMutedContent: boolean }) {
  const key = useMemo(() => getEventKey(reply), [reply])

  return (
    <div className="relative border-b">
      <ReplyNote event={reply} showMutedContent={showMutedContent} />
      <SubReplies parentKey={key} />
    </div>
  )
}
