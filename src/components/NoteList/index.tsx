import NewNotesButton from '@/components/NewNotesButton'
import { Button } from '@/components/ui/button'
import { BIG_RELAY_URLS, ExtendedKind } from '@/constants'
import { isReplyNoteEvent } from '@/lib/event'
import { checkAlgoRelay } from '@/lib/relay'
import { isSafari } from '@/lib/utils'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import client from '@/services/client.service'
import storage from '@/services/local-storage.service'
import relayInfoService from '@/services/relay-info.service'
import { TNoteListMode } from '@/types'
import dayjs from 'dayjs'
import { Event, Filter, kinds } from 'nostr-tools'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PullToRefresh from 'react-simple-pull-to-refresh'
import NoteCard, { NoteCardLoadingSkeleton } from '../NoteCard'
import { PictureNoteCardMasonry } from '../PictureNoteCardMasonry'
import Tabs from '../Tabs'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { useFeed } from '@/providers/FeedProvider'
import { useFeedAlgorithms } from '@/providers/FeedAlgorithmsProvider'
import { set } from 'zod'

const LIMIT = 100
const ALGO_LIMIT = 500
const SHOW_COUNT = 10
const KINDS = [
  kinds.ShortTextNote,
  kinds.Highlights,
  kinds.LongFormArticle,
  ExtendedKind.COMMENT,
  ExtendedKind.POLL
]

export default function NoteList({
  relayUrls = [],
  filter = {},
  author,
  className,
  filterMutedNotes = true,
  needCheckAlgoRelay = false,
  isMainFeed = false,
  topSpace = 0,
  skipTrustCheck = false
}: {
  relayUrls?: string[]
  filter?: Filter
  author?: string
  className?: string
  filterMutedNotes?: boolean
  needCheckAlgoRelay?: boolean
  isMainFeed?: boolean
  topSpace?: number
  skipTrustCheck?: boolean
}) {
  const { t } = useTranslation()
  const { isLargeScreen } = useScreenSize()
  const { pubkey, startLogin, eventList, setEventList, eventLastPostTimes } = useNostr()
  const { events: algoEvents } = useFeedAlgorithms()
  const { mutePubkeys } = useMuteList()
  const [refreshCount, setRefreshCount] = useState(0)
  const [timelineKey, setTimelineKey] = useState<string | undefined>(undefined)
  const [events, setEvents] = useState<Event[]>([])
  const [newEvents, setNewEvents] = useState<Event[]>([])
  const [showCount, setShowCount] = useState(SHOW_COUNT)
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [loading, setLoading] = useState(true)
  const [listMode, setListMode] = useState<TNoteListMode>(() =>
    isMainFeed ? storage.getNoteListMode() : 'posts'
  )
  const [filterType, setFilterType] = useState<Exclude<TNoteListMode, 'postsAndReplies'>>('posts')
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const topRef = useRef<HTMLDivElement | null>(null)
  const { isUserTrusted, hideUntrustedNotes } = useUserTrust()
  const filteredNewEvents = useMemo(() => {
    return newEvents.filter((event: Event) => {
      return (
        (!filterMutedNotes || !mutePubkeys.includes(event.pubkey)) &&
        (listMode !== 'posts' || !isReplyNoteEvent(event)) &&
        (skipTrustCheck || !hideUntrustedNotes || isUserTrusted(event.pubkey))
      )
    })
  }, [newEvents, listMode, filterMutedNotes, mutePubkeys, hideUntrustedNotes])

  useEffect(() => {
    switch (listMode) {
      case 'posts':
      case 'postsAndReplies':
        setFilterType('posts')
        break
      case 'pictures':
        setFilterType('pictures')
        break
      case 'you':
        if (!pubkey || pubkey === author) {
          setFilterType('posts')
        } else {
          setFilterType('you')
        }
        break
    }
  }, [listMode, pubkey])

  useEffect(() => {
    if (loading) return
    const newAlgoEvents = algoEvents.filter((event) => !events.some((e) => e.id === event.id))
    if (newAlgoEvents.length > 0) {
      setNewEvents((prev) => [...newAlgoEvents, ...prev])
    }
  }, [algoEvents])

  useEffect(() => {
    if (relayUrls.length === 0 && !filter.authors?.length && !author) return

    async function init() {
      setLoading(true)
      setEvents([])
      setNewEvents([])
      setHasMore(true)

      let areAlgoRelays = false
      const subRequests: {
        urls: string[]
        filter: Omit<Filter, 'since' | 'until'> & { limit: number }
      }[] = []
      if (feedInfo.feedType === 'notstr') {
        setEvents(algoEvents)
        setLoading(false)
        setHasMore(false)
        return () => {}
      }
      if (filterType === 'you' && author && pubkey && pubkey !== author) {
        const [myRelayList, targetRelayList] = await Promise.all([
          client.fetchRelayList(pubkey),
          client.fetchRelayList(author)
        ])
        subRequests.push({
          urls: myRelayList.write.concat(BIG_RELAY_URLS).slice(0, 5),
          filter: {
            kinds: KINDS,
            authors: [pubkey],
            '#p': [author],
            limit: LIMIT
          }
        })
        subRequests.push({
          urls: targetRelayList.write.concat(BIG_RELAY_URLS).slice(0, 5),
          filter: {
            kinds: KINDS,
            authors: [author],
            '#p': [pubkey],
            limit: LIMIT
          }
        })
      } else {
        if (needCheckAlgoRelay) {
          const relayInfos = await relayInfoService.getRelayInfos(relayUrls)
          areAlgoRelays = relayInfos.every((relayInfo) => checkAlgoRelay(relayInfo))
        }
        const _filter = {
          ...filter,
          kinds: filterType === 'pictures' ? [ExtendedKind.PICTURE] : KINDS,
          limit: areAlgoRelays ? ALGO_LIMIT : LIMIT
        }
        if (relayUrls.length === 0 && (_filter.authors?.length || author)) {
          if (!_filter.authors?.length) {
            _filter.authors = [author!]
          }

          // If many websocket connections are initiated simultaneously, it will be
          // very slow on Safari (for unknown reason)
          if ((_filter.authors?.length ?? 0) > 5 && isSafari()) {
            if (!pubkey) {
              subRequests.push({ urls: BIG_RELAY_URLS, filter: _filter })
            } else {
              const relayList = await client.fetchRelayList(pubkey)
              const urls = relayList.read.concat(BIG_RELAY_URLS).slice(0, 5)
              subRequests.push({ urls, filter: _filter })
            }
          } else {
            const relayLists = await client.fetchRelayLists(_filter.authors)
            const group: Record<string, Set<string>> = {}
            relayLists.forEach((relayList, index) => {
              relayList.write.slice(0, 4).forEach((url) => {
                if (!group[url]) {
                  group[url] = new Set()
                }
                group[url].add(_filter.authors![index])
              })
            })

            const relayCount = Object.keys(group).length
            const coveredCount = new Map<string, number>()
            Object.entries(group)
              .sort(([, a], [, b]) => b.size - a.size)
              .forEach(([url, pubkeys]) => {
                if (
                  relayCount > 10 &&
                  pubkeys.size < 10 &&
                  Array.from(pubkeys).every((pubkey) => (coveredCount.get(pubkey) ?? 0) >= 2)
                ) {
                  delete group[url]
                } else {
                  pubkeys.forEach((pubkey) => {
                    coveredCount.set(pubkey, (coveredCount.get(pubkey) ?? 0) + 1)
                  })
                }
              })

            subRequests.push(
              ...Object.entries(group).map(([url, authors]) => ({
                urls: [url],
                filter: { ..._filter, authors: Array.from(authors) }
              }))
            )
          }
        } else {
          subRequests.push({ urls: relayUrls, filter: _filter })
        }
      }

      const { closer, timelineKey } = await client.subscribeTimeline(
        subRequests,
        {
          onEvents: (events, eosed) => {
            if (events.length > 0) {
              setEvents(events)
            }
            if (areAlgoRelays) {
              setHasMore(false)
            }
            if (eosed) {
              setLoading(false)
              setHasMore(events.length > 0)
            }
          },
          onNew: (event) => {
            setNewEvents((oldEvents) =>
              [event, ...oldEvents].sort((a, b) => b.created_at - a.created_at)
            )
          }
        },
        {
          startLogin,
          needSort: !areAlgoRelays
        }
      )
      setTimelineKey(timelineKey)
      return closer
    }

    const promise = init()
    return () => {
      promise.then((closer) => closer())
    }
  }, [JSON.stringify(relayUrls), filterType, refreshCount, JSON.stringify(filter)])

  useEffect(() => {
    const options = {
      root: null,
      rootMargin: '10px',
      threshold: 0.1
    }

    const loadMore = async () => {
      if (showCount < events.length) {
        setShowCount((prev) => prev + SHOW_COUNT)
        // preload more
        if (events.length - showCount > LIMIT / 2) {
          return
        }
      }

      if (!timelineKey || loading || !hasMore) return
      setLoading(true)
      const newEvents = await client.loadMoreTimeline(
        timelineKey,
        events.length ? events[events.length - 1].created_at - 1 : dayjs().unix(),
        LIMIT
      )
      setLoading(false)
      if (newEvents.length === 0) {
        setHasMore(false)
        return
      }
      setEvents((oldEvents) => [...oldEvents, ...newEvents])
    }

    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore) {
        loadMore()
      }
    }, options)

    const currentBottomRef = bottomRef.current

    if (currentBottomRef) {
      observerInstance.observe(currentBottomRef)
    }

    return () => {
      if (observerInstance && currentBottomRef) {
        observerInstance.unobserve(currentBottomRef)
      }
    }
  }, [timelineKey, loading, hasMore, events, filterType, showCount])

  const showNewEvents = () => {
    setEvents((oldEvents) => [...newEvents, ...oldEvents])
    setNewEvents([])
    setTimeout(() => {
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
  }

  return (
    <div className={className}>
      <Tabs
        value={listMode}
        tabs={
          pubkey && author && pubkey !== author
            ? [
                { value: 'posts', label: 'Notes' },
                { value: 'postsAndReplies', label: 'Replies' },
                { value: 'pictures', label: 'Pictures' },
                { value: 'you', label: 'YouTabName' }
              ]
            : isMainFeed && feedInfo.feedType === 'notstr'
              ? [
                  { value: 'posts', label: 'Notes' },
                  { value: 'postsAndReplies', label: 'Replies' },
                ]
              : [
                  { value: 'posts', label: 'Notes' },
                  { value: 'postsAndReplies', label: 'Replies' },
                  { value: 'pictures', label: 'Pictures' }
                ]
        }
        onTabChange={(listMode) => {
          setListMode(listMode as TNoteListMode)
          setShowCount(SHOW_COUNT)
          if (isMainFeed) {
            storage.setNoteListMode(listMode as TNoteListMode)
          }
          if (!isMainFeed || feedInfo.feedType !== 'notstr') {
            setTimeout(() => {
              topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }, 0)
          }
        }}
        threshold={Math.max(800, topSpace)}
      />
      {filteredNewEvents.length > 0 && (
        <NewNotesButton newEvents={filteredNewEvents} onClick={showNewEvents} />
      )}
      <div ref={topRef} className="scroll-mt-24" />
      <PullToRefresh
        onRefresh={async () => {
          setRefreshCount((count) => count + 1)
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }}
        pullingContent=""
      >
        <div className="min-h-screen">
          {listMode === 'pictures' ? (
            <PictureNoteCardMasonry
              className="px-2 sm:px-4 mt-2"
              columnCount={isLargeScreen ? 3 : 2}
              events={events.slice(0, showCount)}
            />
          ) : (
            <div>
              {events
                .slice(0, showCount)
                .filter(
                  (event: Event) =>
                    (listMode !== 'posts' || !isReplyNoteEvent(event)) &&
                    (skipTrustCheck || !hideUntrustedNotes || isUserTrusted(event.pubkey))
                )
                .map((event) => (
                  <NoteCard
                    key={event.id}
                    className="w-full"
                    event={event}
                    filterMutedNotes={filterMutedNotes}
                  />
                ))}
            </div>
          )}
          {hasMore || loading ? (
            <div ref={bottomRef}>
              <NoteCardLoadingSkeleton isPictures={listMode === 'pictures'} />
            </div>
          ) : events.length ? (
            <div className="text-center text-sm text-muted-foreground mt-2">
              {t('no more notes')}
            </div>
          ) : (
            <div className="flex justify-center w-full mt-2">
              <Button size="lg" onClick={() => setRefreshCount((pre) => pre + 1)}>
                {t('reload notes')}
              </Button>
            </div>
          )}
        </div>
      </PullToRefresh>
      <div className="h-40" />
    </div>
  )
}
