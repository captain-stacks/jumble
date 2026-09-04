import NormalFeed from '@/components/NormalFeed'
import { SPECIAL_FEED_ID } from '@/constants'
import { checkAlgoRelay } from '@/lib/relay'
import { useFeed } from '@/providers/FeedProvider'
import relayInfoService from '@/services/relay-info.service'
import { useEffect, useMemo, useState } from 'react'

export default function RelaysFeed() {
  const { activeRelayUrls, feedInfo } = useFeed()
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
      const relayInfos = await relayInfoService.getRelayInfos(activeRelayUrls)
      setAreAlgoRelays(relayInfos.every((relayInfo) => checkAlgoRelay(relayInfo)))
      setIsReady(true)
    }
    init()
  }, [activeRelayUrls])

  if (!isReady) {
    return null
  }

  return (
    <NormalFeed
      feedId={feedId}
      subRequests={[{ urls: activeRelayUrls, filter: {} }]}
      areAlgoRelays={areAlgoRelays}
      showRelayCloseReason
    />
  )
}
