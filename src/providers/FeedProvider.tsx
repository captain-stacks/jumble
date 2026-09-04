import {
  IS_COMMUNITY_MODE,
  BIG_RELAY_URLS,
  COMMUNITY_RELAY_SETS,
  COMMUNITY_RELAYS
} from '@/constants'
import { getRelaySetFromEvent } from '@/lib/event-metadata'
import { isWebsocketUrl, normalizeUrl } from '@/lib/url'
import indexedDb from '@/services/indexed-db.service'
import storage from '@/services/local-storage.service'
import { TFeedInfo, TFeedType, TRelaySet } from '@/types'
import { kinds } from 'nostr-tools'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useFavoriteRelays } from './FavoriteRelaysProvider'
import { useNostr } from './NostrProvider'

type TFeedContext = {
  feedInfo: TFeedInfo
  relayUrls: string[]
  activeRelayUrls: string[]
  disabledRelayUrls: string[]
  toggleRelayUrl: (url: string) => void
  isReady: boolean
  switchFeed: (
    feedType: TFeedType | null,
    options?: { activeRelaySetId?: string; pubkey?: string; relay?: string | null }
  ) => Promise<void>
  noteEvaluationFlashCount: number
  triggerNoteEvaluationFlash: () => void
}

const FeedContext = createContext<TFeedContext | undefined>(undefined)

export const useFeed = () => {
  const context = useContext(FeedContext)
  if (!context) {
    throw new Error('useFeed must be used within a FeedProvider')
  }
  return context
}

export function FeedProvider({ children }: { children: React.ReactNode }) {
  const { pubkey, isInitialized } = useNostr()
  const { relaySets } = useFavoriteRelays()
  const [relayUrls, setRelayUrls] = useState<string[]>([])
  const [disabledRelayUrls, setDisabledRelayUrls] = useState<string[]>([])
  const [isReady, setIsReady] = useState(false)
  const [feedInfo, setFeedInfo] = useState<TFeedInfo>(null)
  const feedInfoRef = useRef<TFeedInfo>(feedInfo)
  // Flashes a dot next to the feed dropdown each time a new note arrives in
  // the feed, so the reader has a lightweight cue that fresh content landed.
  const [noteEvaluationFlashCount, setNoteEvaluationFlashCount] = useState(0)
  const triggerNoteEvaluationFlash = useCallback(() => {
    setNoteEvaluationFlashCount((count) => count + 1)
  }, [])

  // Relays a user has unchecked to stop loading from, for the currently active feed only.
  // Reset whenever the feed's relay set changes (see setRelayUrls call sites in switchFeed).
  useEffect(() => {
    setDisabledRelayUrls([])
  }, [relayUrls])

  const activeRelayUrls = useMemo(
    () => relayUrls.filter((url) => !disabledRelayUrls.includes(url)),
    [relayUrls, disabledRelayUrls]
  )

  const toggleRelayUrl = useCallback(
    (url: string) => {
      setDisabledRelayUrls((prev) => {
        if (prev.includes(url)) {
          return prev.filter((u) => u !== url)
        }
        // Always keep at least one relay active for the feed
        if (relayUrls.length - prev.length <= 1) {
          return prev
        }
        return [...prev, url]
      })
    },
    [relayUrls]
  )

  useEffect(() => {
    const init = async () => {
      if (!isInitialized) {
        return
      }

      const currentFeedInfo = feedInfoRef.current
      if (currentFeedInfo) {
        if (
          currentFeedInfo.feedType !== 'following' &&
          currentFeedInfo.feedType !== 'pinned' &&
          currentFeedInfo.feedType !== 'global'
        ) {
          return
        }
        return pubkey
          ? await switchFeed(currentFeedInfo.feedType, { pubkey })
          : await switchFeed(null)
      }

      let feedInfo: TFeedInfo = null
      if (pubkey) {
        const storedFeedInfo = storage.getFeedInfo(pubkey)
        if (storedFeedInfo) {
          feedInfo = storedFeedInfo
        } else {
          if (!IS_COMMUNITY_MODE) {
            feedInfo = { feedType: 'following' }
          }
        }
      }
      if (!feedInfo && IS_COMMUNITY_MODE) {
        feedInfo =
          COMMUNITY_RELAY_SETS.length > 0
            ? {
                feedType: 'relays',
                id: COMMUNITY_RELAY_SETS[0].id,
                name: COMMUNITY_RELAY_SETS[0].name
              }
            : { feedType: 'relay', id: COMMUNITY_RELAYS[0] }
      }

      if (feedInfo?.feedType === 'relays') {
        return await switchFeed('relays', { activeRelaySetId: feedInfo.id })
      }

      if (feedInfo?.feedType === 'relay') {
        return await switchFeed('relay', { relay: feedInfo.id })
      }

      // update following feed if pubkey changes
      if (feedInfo?.feedType === 'following' && pubkey) {
        return await switchFeed('following', { pubkey })
      }

      // update pinned feed if pubkey changes
      if (feedInfo?.feedType === 'pinned' && pubkey) {
        return await switchFeed('pinned', { pubkey })
      }

      if (feedInfo?.feedType === 'global' && pubkey) {
        return await switchFeed('global')
      }

      setIsReady(true)
    }

    init()
  }, [pubkey, isInitialized])

  const switchFeed = async (
    feedType: TFeedType | null,
    options: {
      activeRelaySetId?: string | null
      pubkey?: string | null
      relay?: string | null
    } = {}
  ) => {
    if (!feedType) {
      setFeedInfo(null)
      feedInfoRef.current = null
      setRelayUrls([])
      return
    }

    setIsReady(false)
    if (feedType === 'relay') {
      const normalizedUrl = normalizeUrl(options.relay ?? '')
      if (!normalizedUrl || !isWebsocketUrl(normalizedUrl)) {
        setIsReady(true)
        return
      }

      const newFeedInfo = { feedType, id: normalizedUrl }
      setFeedInfo(newFeedInfo)
      feedInfoRef.current = newFeedInfo
      setRelayUrls([normalizedUrl])
      storage.setFeedInfo(newFeedInfo, pubkey)
      setIsReady(true)
      return
    }
    if (feedType === 'relays') {
      const relaySetId = options.activeRelaySetId ?? (relaySets.length > 0 ? relaySets[0].id : null)
      let relaySet: TRelaySet | null = null
      if (IS_COMMUNITY_MODE) {
        relaySet =
          COMMUNITY_RELAY_SETS.find((set) => set.id === relaySetId) ??
          (COMMUNITY_RELAY_SETS.length > 0 ? COMMUNITY_RELAY_SETS[0] : null)
      } else {
        if (!relaySetId || !pubkey) {
          setIsReady(true)
          return
        }

        relaySet =
          relaySets.find((set) => set.id === relaySetId) ??
          (relaySets.length > 0 ? relaySets[0] : null)

        if (!relaySet) {
          const storedRelaySetEvent = await indexedDb.getReplaceableEvent(
            pubkey,
            kinds.Relaysets,
            relaySetId
          )
          if (storedRelaySetEvent) {
            relaySet = getRelaySetFromEvent(storedRelaySetEvent)
          }
        }
      }

      if (relaySet) {
        const newFeedInfo = { feedType, id: relaySet.id }
        setFeedInfo(newFeedInfo)
        feedInfoRef.current = newFeedInfo
        setRelayUrls(relaySet.relayUrls)
        storage.setFeedInfo(newFeedInfo, pubkey)
        setIsReady(true)
      }
      setIsReady(true)
      return
    }
    if (feedType === 'following') {
      if (!options.pubkey) {
        setIsReady(true)
        return
      }
      const newFeedInfo = { feedType }
      setFeedInfo(newFeedInfo)
      feedInfoRef.current = newFeedInfo
      storage.setFeedInfo(newFeedInfo, pubkey)

      setRelayUrls([])
      setIsReady(true)
      return
    }
    if (feedType === 'pinned') {
      if (!options.pubkey) {
        setIsReady(true)
        return
      }
      const newFeedInfo = { feedType }
      setFeedInfo(newFeedInfo)
      feedInfoRef.current = newFeedInfo
      storage.setFeedInfo(newFeedInfo, pubkey)

      setRelayUrls([])
      setIsReady(true)
      return
    }
    if (feedType === 'global') {
      const newFeedInfo = { feedType }
      setFeedInfo(newFeedInfo)
      feedInfoRef.current = newFeedInfo
      storage.setFeedInfo(newFeedInfo, pubkey)
      setRelayUrls(BIG_RELAY_URLS)
      setIsReady(true)
      return
    }
    setIsReady(true)
  }

  return (
    <FeedContext.Provider
      value={{
        feedInfo,
        relayUrls,
        activeRelayUrls,
        disabledRelayUrls,
        toggleRelayUrl,
        isReady,
        switchFeed,
        noteEvaluationFlashCount,
        triggerNoteEvaluationFlash
      }}
    >
      {children}
    </FeedContext.Provider>
  )
}
