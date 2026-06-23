import NormalFeed from '@/components/NormalFeed'
import { DEFAULT_RELAY_URL, SPECIAL_FEED_ID } from '@/constants'
import { checkAlgoRelay } from '@/lib/relay'
import { useFeed } from '@/providers/FeedProvider'
import { PostFromProvider } from '@/providers/PostFromProvider'
import relayInfoService from '@/services/relay-info.service'
import { useEffect, useMemo, useState } from 'react'

export default function RelaysFeed() {
  const { relayUrls, feedInfo } = useFeed()
  const [isReady, setIsReady] = useState(false)
  const [areAlgoRelays, setAreAlgoRelays] = useState(false)
  const feedId = useMemo(() => {
    if (feedInfo?.feedType === 'global') {
      return SPECIAL_FEED_ID.GLOBAL
    }
    if (feedInfo?.feedType === 'relay' && feedInfo.id) {
      return `relay-${feedInfo.id}`
    } else if (feedInfo?.feedType === 'relays' && feedInfo.id) {
      return `relays-${feedInfo.id}`
    }
    return 'relays-default'
  }, [feedInfo])

  useEffect(() => {
    const init = async () => {
      const relayInfos = await relayInfoService.getRelayInfos(relayUrls)
      setAreAlgoRelays(relayInfos.every((relayInfo) => checkAlgoRelay(relayInfo)))
      setIsReady(true)
    }
    init()
  }, [relayUrls])

  if (!isReady) {
    return null
  }

  const postFrom =
    feedInfo?.feedType === 'relay' && feedInfo.id === DEFAULT_RELAY_URL
      ? [DEFAULT_RELAY_URL]
      : undefined

  return (
    <PostFromProvider value={postFrom}>
      <NormalFeed
        feedId={feedId}
        subRequests={[{ urls: relayUrls, filter: {} }]}
        areAlgoRelays={areAlgoRelays}
        showRelayCloseReason
        defaultTabId="postsAndReplies"
      />
    </PostFromProvider>
  )
}
