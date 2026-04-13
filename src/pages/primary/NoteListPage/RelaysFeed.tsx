import NormalFeed from '@/components/NormalFeed'
import { checkAlgoRelay } from '@/lib/relay'
import { useFeed } from '@/providers/FeedProvider'
import relayInfoService from '@/services/relay-info.service'
import { Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'

const MOSTR_RELAY_HOSTNAME = 'relay.mostr.pub'

function isMostrRelay(url: string) {
  try {
    return new URL(url).hostname === MOSTR_RELAY_HOSTNAME
  } catch {
    return false
  }
}

export default function RelaysFeed() {
  const { relayUrls, feedInfo } = useFeed()
  const [isReady, setIsReady] = useState(false)
  const [areAlgoRelays, setAreAlgoRelays] = useState(false)

  const mostrFilterFn = useCallback(
    (event: Event) => !event.tags.some((tag) => tag[0] === 'proxy' && tag[1]?.startsWith('at://')),
    []
  )

  const filterFn = useMemo(() => {
    if (relayUrls.length === 1 && isMostrRelay(relayUrls[0])) {
      return mostrFilterFn
    }
    return undefined
  }, [relayUrls, mostrFilterFn])
  const trustScoreFilterId = useMemo(() => {
    if (feedInfo?.feedType === 'relay' && feedInfo.id) {
      return `relay-${feedInfo.id}`
    } else if (feedInfo?.feedType === 'relays' && feedInfo.id) {
      return `relays-${feedInfo.id}`
    } else if (feedInfo?.feedType === 'global') {
      return 'relays-global'
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

  return (
    <NormalFeed
      trustScoreFilterId={trustScoreFilterId}
      subRequests={[{ urls: relayUrls, filter: {} }]}
      areAlgoRelays={areAlgoRelays}
      isMainFeed
      showRelayCloseReason
      filterFn={filterFn}
    />
  )
}
