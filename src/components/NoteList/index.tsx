import NewNotesButton from '@/components/NewNotesButton'
import { Button } from '@/components/ui/button'
import { ALLOWED_FILTER_KINDS, SPAMMER_PERCENTILE_THRESHOLD } from '@/constants'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import {
  compareEvents,
  getEventAuthorPubkey,
  getEventFeedTimestamp,
  getEventKey,
  getSafeFeedItemCount,
  getKeyFromTag,
  getParentKind,
  getRootAuthorPubkeyFromTags,
  getRootTag,
  isMentioningMutedUsers,
  isReplyNoteEvent,
  partitionIncomingFeedEvents,
  sortRevisionOrderedFeedEventsDesc,
  sortRevisionOrderedFeedItemsDesc
} from '@/lib/event'
import { isRelayDisconnectReason } from '@/lib/relay'
import { tagNameEquals } from '@/lib/tag'
import { mergeTimelines } from '@/lib/timeline'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { usePageActive } from '@/providers/PageActiveProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import client from '@/services/client.service'
import threadService from '@/services/thread.service'
import { TFeedSubRequest } from '@/types'
import dayjs from 'dayjs'
import { Event, kinds } from 'nostr-tools'
import { Loader } from 'lucide-react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import PullToRefresh from '../PullToRefresh'
import { toast } from 'sonner'
import { LoadingBar } from '../LoadingBar'
import NoteCard, { NoteCardLoadingSkeleton } from '../NoteCard'

const LIMIT = 200
const ALGO_LIMIT = 500
const SHOW_COUNT = 10

export type TNoteListRef = {
  scrollToTop: (behavior?: ScrollBehavior) => void
  refresh: () => void
}

const NoteList = forwardRef<
  TNoteListRef,
  {
    subRequests: TFeedSubRequest[]
    showKinds?: number[]
    filterMutedNotes?: boolean
    hideReplies?: boolean
    hideSpam?: boolean
    trustScoreThreshold?: number
    maxTrustScoreThreshold?: number
    showUnknownReplies?: boolean
    areAlgoRelays?: boolean
    showRelayCloseReason?: boolean
    filterFn?: (event: Event) => boolean
    showNewNotesDirectly?: boolean
    isPubkeyFeed?: boolean
    onFilteredCountChange?: (count: number) => void
    onNoteEvaluated?: () => void
  }
>(
  (
    {
      subRequests,
      showKinds,
      filterMutedNotes = true,
      hideReplies = false,
      hideSpam = false,
      trustScoreThreshold,
      maxTrustScoreThreshold,
      showUnknownReplies = false,
      areAlgoRelays = false,
      showRelayCloseReason = false,
      filterFn,
      showNewNotesDirectly = false,
      isPubkeyFeed = false,
      onFilteredCountChange,
      onNoteEvaluated
    },
    ref
  ) => {
    const { t } = useTranslation()
    const active = usePageActive()
    const { startLogin } = useNostr()
    const { isSpammer, meetsMinTrustScore, computeTrustScore, isUnknownProfile, wotReady } =
      useUserTrust()
    const { showRepliesToUnsupportedKinds } = useUserPreferences()
    const { mutePubkeySet } = useMuteList()
    const { hideContentMentioningMutedUsers, mutedWords } = useContentPolicy()
    const { isEventDeleted } = useDeletedEvent()
    const [storedEvents, setStoredEvents] = useState<Event[]>([])
    const [events, setEvents] = useState<Event[]>([])
    const [newEvents, setNewEvents] = useState<Event[]>([])
    const [initialLoading, setInitialLoading] = useState(true)
    const [filtering, setFiltering] = useState(false)
    const [timelineKey, setTimelineKey] = useState<string | undefined>(undefined)
    const [filteredNotes, setFilteredNotes] = useState<
      { key: string; event: Event; reposters: string[] }[]
    >([])
    const [filteredNewEvents, setFilteredNewEvents] = useState<Event[]>([])
    const [refreshCount, setRefreshCount] = useState(0)
    const [reachedTimelineEnd, setReachedTimelineEnd] = useState(false)
    const [wotFilteringDone, setWotFilteringDone] = useState(false)
    const wotReadyRef = useRef(wotReady)
    wotReadyRef.current = wotReady
    const topRef = useRef<HTMLDivElement | null>(null)
    const eventsRef = useRef(events)
    eventsRef.current = events
    const filteredNotesRef = useRef(filteredNotes)
    filteredNotesRef.current = filteredNotes
    const sinceRef = useRef<number | undefined>(undefined)
    sinceRef.current = newEvents.length
      ? newEvents[0].created_at + 1
      : events.length
        ? events[0].created_at + 1
        : undefined
    const showNewNotesDirectlyRef = useRef(showNewNotesDirectly)
    showNewNotesDirectlyRef.current = showNewNotesDirectly

    const shouldHideEvent = useCallback(
      (evt: Event) => {
        if (isEventDeleted(evt)) return true
        const authorPubkey = getEventAuthorPubkey(evt)
        if (filterMutedNotes && mutePubkeySet.has(authorPubkey)) return true
        if (
          filterMutedNotes &&
          hideContentMentioningMutedUsers &&
          isMentioningMutedUsers(evt, mutePubkeySet)
        ) {
          return true
        }
        if (filterFn && !filterFn(evt)) {
          return true
        }
        if (mutedWords.length > 0) {
          const contentLower = evt.content.toLowerCase()
          for (const word of mutedWords) {
            if (contentLower.includes(word)) {
              return true
            }
          }
        }

        return false
      },
      [mutePubkeySet, isEventDeleted, filterFn, mutedWords]
    )

    // Whether an unknown-author reply may skip the trust check: only if its thread's root
    // post was itself authored by someone within the current trust threshold and not muted.
    const isReplyRootAuthorTrusted = useCallback(
      async (evt: Event, minScore: number, maxScore: number | undefined) => {
        const rootTag = getRootTag(evt)
        if (!rootTag) return false

        let rootAuthorPubkey = getRootAuthorPubkeyFromTags(evt)
        if (!rootAuthorPubkey && rootTag.type === 'e') {
          const rootEvent = await client.fetchEvent(rootTag.tag[1])
          rootAuthorPubkey = rootEvent?.pubkey
        }
        if (!rootAuthorPubkey) return false
        if (mutePubkeySet.has(rootAuthorPubkey)) return false

        if (!(await meetsMinTrustScore(rootAuthorPubkey, minScore))) return false
        if (maxScore !== undefined && maxScore < 100) {
          if (computeTrustScore(rootAuthorPubkey) > maxScore) return false
        }
        return true
      },
      [meetsMinTrustScore, computeTrustScore, mutePubkeySet]
    )

    useEffect(() => {
      let cancelled = false
      const _trustScoreThreshold = hideSpam
        ? SPAMMER_PERCENTILE_THRESHOLD
        : (trustScoreThreshold ?? 0)
      // Capture wotReady at effect start — not in .finally(), where it may already be true
      // even though this run used the pre-WoT meetsMinTrustScore.
      const _wotReadyAtStart = wotReadyRef.current

      const processEvents = async () => {
        // Store processed event keys to avoid duplicates
        const keySet = new Set<string>()
        // Map to track reposters for each event key
        const repostersMap = new Map<string, Set<string>>()
        // Final list of filtered events
        const filteredEvents: Event[] = []
        const keys: string[] = []

        let mergedEvents: Event[] = events
        if (
          storedEvents.length &&
          (!events.length || storedEvents[0].created_at >= events[events.length - 1].created_at)
        ) {
          mergedEvents = mergeTimelines([storedEvents, events])
        }
        mergedEvents.forEach((evt) => {
          const key = getEventKey(evt)
          if (keySet.has(key)) return
          keySet.add(key)

          if (shouldHideEvent(evt)) return
          if (hideReplies && isReplyNoteEvent(evt)) {
            if (!showRepliesToUnsupportedKinds) return
            const parentKind = getParentKind(evt)
            if (parentKind === undefined || ALLOWED_FILTER_KINDS.includes(parentKind)) return
          }
          if (evt.kind !== kinds.Repost && evt.kind !== kinds.GenericRepost) {
            filteredEvents.push(evt)
            keys.push(key)
            return
          }

          let targetEventKey: string | undefined
          let eventFromContent: Event | null = null
          const targetTag = evt.tags.find(tagNameEquals('a')) ?? evt.tags.find(tagNameEquals('e'))
          if (targetTag) {
            targetEventKey = getKeyFromTag(targetTag)
          } else {
            // Attempt to extract the target event from the repost content
            if (evt.content) {
              try {
                eventFromContent = JSON.parse(evt.content) as Event
              } catch {
                eventFromContent = null
              }
            }
            if (eventFromContent) {
              if (
                eventFromContent.kind === kinds.Repost ||
                eventFromContent.kind === kinds.GenericRepost
              ) {
                return
              }
              if (shouldHideEvent(evt)) return

              targetEventKey = getEventKey(eventFromContent)
            }
          }

          if (targetEventKey) {
            // Add to reposters map
            const reposters = repostersMap.get(targetEventKey)
            if (reposters) {
              reposters.add(evt.pubkey)
            } else {
              repostersMap.set(targetEventKey, new Set([evt.pubkey]))
            }

            // If the target event is not already included, add it now
            if (!keySet.has(targetEventKey)) {
              filteredEvents.push(evt)
              keys.push(targetEventKey)
              keySet.add(targetEventKey)
            }
          }
        })

        if (!_trustScoreThreshold || _trustScoreThreshold <= 0) {
          const notes = filteredEvents.map((evt, i) => {
            const key = keys[i]
            return { key, event: evt, reposters: Array.from(repostersMap.get(key) ?? []) }
          })
          if (!cancelled) {
            setFilteredNotes(
              areAlgoRelays ? notes : sortRevisionOrderedFeedItemsDesc(notes, ({ event }) => event)
            )
          }
          return
        }

        const _filteredNotes = (
          await Promise.all(
            filteredEvents.map(async (evt, i) => {
              if (cancelled) return null
              const authorPubkey = getEventAuthorPubkey(evt)
              let skipTrustCheck = false
              if (showUnknownReplies && isReplyNoteEvent(evt) && isUnknownProfile(authorPubkey)) {
                skipTrustCheck = await isReplyRootAuthorTrusted(
                  evt,
                  _trustScoreThreshold,
                  maxTrustScoreThreshold
                )
              }
              if (!skipTrustCheck) {
                // Check trust score filter
                if (!(await meetsMinTrustScore(authorPubkey, _trustScoreThreshold))) {
                  return null
                }
                if (maxTrustScoreThreshold !== undefined && maxTrustScoreThreshold < 100) {
                  if (computeTrustScore(evt.pubkey) > maxTrustScoreThreshold) return null
                }
              }
              if (cancelled) return null
              const key = keys[i]
              return { key, event: evt, reposters: Array.from(repostersMap.get(key) ?? []) }
            })
          )
        ).filter(Boolean) as {
          key: string
          event: Event
          reposters: string[]
        }[]

        if (!cancelled) {
          setFilteredNotes(
            areAlgoRelays
              ? _filteredNotes
              : sortRevisionOrderedFeedItemsDesc(_filteredNotes, ({ event }) => event)
          )
        }
      }

      setFiltering(true)
      processEvents().finally(() => {
        if (!cancelled) {
          setFiltering(false)
          if (_wotReadyAtStart || !_trustScoreThreshold || _trustScoreThreshold <= 0) {
            setWotFilteringDone(true)
          }
        }
      })

      return () => {
        cancelled = true
      }
    }, [
      events,
      storedEvents,
      shouldHideEvent,
      hideReplies,
      hideSpam,
      meetsMinTrustScore,
      computeTrustScore,
      isUnknownProfile,
      isReplyRootAuthorTrusted,
      trustScoreThreshold,
      maxTrustScoreThreshold,
      showUnknownReplies,
      showRepliesToUnsupportedKinds,
      areAlgoRelays
    ])

    useEffect(() => {
      onFilteredCountChange?.(filteredNotes.length)
    }, [filteredNotes.length, onFilteredCountChange])

    useEffect(() => {
      const processNewEvents = async () => {
        const keySet = new Set<string>()
        const filteredEvents: Event[] = []

        newEvents.forEach((event) => {
          if (shouldHideEvent(event)) return
          if (hideReplies && isReplyNoteEvent(event)) {
            if (!showRepliesToUnsupportedKinds) return
            const parentKind = getParentKind(event)
            if (parentKind === undefined || ALLOWED_FILTER_KINDS.includes(parentKind)) return
          }

          const key = getEventKey(event)
          if (keySet.has(key)) {
            return
          }
          keySet.add(key)
          filteredEvents.push(event)
        })

        const _trustScoreThreshold = hideSpam
          ? SPAMMER_PERCENTILE_THRESHOLD
          : (trustScoreThreshold ?? 0)
        if (!_trustScoreThreshold || _trustScoreThreshold <= 0) {
          setFilteredNewEvents(
            areAlgoRelays ? filteredEvents : sortRevisionOrderedFeedEventsDesc(filteredEvents)
          )
          return
        }

        const _filteredNotes = (
          await Promise.all(
            filteredEvents.map(async (evt) => {
              const authorPubkey = getEventAuthorPubkey(evt)
              if (hideSpam && (await isSpammer(authorPubkey))) {
                return null
              }
              let skipTrustCheck = false
              if (showUnknownReplies && isReplyNoteEvent(evt) && isUnknownProfile(authorPubkey)) {
                skipTrustCheck = await isReplyRootAuthorTrusted(
                  evt,
                  _trustScoreThreshold,
                  maxTrustScoreThreshold
                )
              }
              if (!skipTrustCheck) {
                // Check trust score filter
                if (!(await meetsMinTrustScore(authorPubkey, _trustScoreThreshold))) {
                  return null
                }
                if (maxTrustScoreThreshold !== undefined && maxTrustScoreThreshold < 100) {
                  if (computeTrustScore(evt.pubkey) > maxTrustScoreThreshold) return null
                }
              }
              return evt
            })
          )
        ).filter(Boolean) as Event[]
        setFilteredNewEvents(
          areAlgoRelays ? _filteredNotes : sortRevisionOrderedFeedEventsDesc(_filteredNotes)
        )
      }
      processNewEvents()
    }, [
      newEvents,
      shouldHideEvent,
      isSpammer,
      hideSpam,
      meetsMinTrustScore,
      computeTrustScore,
      isUnknownProfile,
      isReplyRootAuthorTrusted,
      trustScoreThreshold,
      maxTrustScoreThreshold,
      showUnknownReplies,
      showRepliesToUnsupportedKinds,
      areAlgoRelays
    ])

    useEffect(() => {
      if (!wotReady) {
        setWotFilteringDone(false)
      }
    }, [wotReady])

    const scrollToTop = (behavior: ScrollBehavior = 'instant') => {
      setTimeout(() => {
        topRef.current?.scrollIntoView({ behavior, block: 'start' })
      }, 20)
    }

    const refresh = () => {
      scrollToTop()
      setTimeout(() => {
        setRefreshCount((count) => count + 1)
      }, 500)
    }

    useImperativeHandle(ref, () => ({ scrollToTop, refresh }), [])

    useEffect(() => {
      if (!subRequests.length) return

      sinceRef.current = undefined
      setEvents([])
      setStoredEvents([])
      setNewEvents([])
      setReachedTimelineEnd(false)
    }, [JSON.stringify(subRequests), refreshCount, JSON.stringify(showKinds)])

    useEffect(() => {
      if (!subRequests.length || !active) return

      async function init() {
        setInitialLoading(true)

        if (showKinds?.length === 0 && subRequests.every(({ filter }) => !filter.kinds)) {
          return () => {}
        }

        const since = sinceRef.current

        if (isPubkeyFeed) {
          const storedEvents = await client.getEventsFromIndexed({
            authors: subRequests.flatMap(({ filter }) => filter.authors ?? []),
            kinds: showKinds,
            limit: LIMIT
          })
          setStoredEvents(storedEvents)
        }

        const preprocessedSubRequests = await Promise.all(
          subRequests.map(async ({ urls, filter }) => {
            const relays = urls.length ? urls : await client.determineRelaysByFilter(filter)
            return {
              urls: relays,
              filter: {
                kinds: showKinds ?? [],
                ...filter,
                limit: areAlgoRelays ? ALGO_LIMIT : LIMIT
              }
            }
          })
        )

        const handleNewEvents = (incomingEvents: Event[]) => {
          incomingEvents.forEach(() => onNoteEvaluated?.())

          let recentEvents = incomingEvents
          if (!areAlgoRelays) {
            const visibleHeadEvent = filteredNotesRef.current[0]?.event
            let feedHeadTimestamp = visibleHeadEvent
              ? getEventFeedTimestamp(visibleHeadEvent)
              : undefined
            if (feedHeadTimestamp === undefined) {
              const fallbackHeadEvent = sortRevisionOrderedFeedEventsDesc(eventsRef.current)[0]
              feedHeadTimestamp = fallbackHeadEvent
                ? getEventFeedTimestamp(fallbackHeadEvent)
                : undefined
            }
            const partitioned = partitionIncomingFeedEvents(incomingEvents, feedHeadTimestamp)
            recentEvents = partitioned.recentEvents

            if (partitioned.historicalEvents.length) {
              const historicalEventsByKey = new Map<string, Event>()
              partitioned.historicalEvents.forEach((event) => {
                const key = getEventKey(event)
                const current = historicalEventsByKey.get(key)
                if (!current || compareEvents(event, current) > 0) {
                  historicalEventsByKey.set(key, event)
                }
              })
              setEvents((oldEvents) => mergeTimelines([partitioned.historicalEvents, oldEvents]))
              setNewEvents((oldEvents) =>
                oldEvents.filter((event) => {
                  const historicalEvent = historicalEventsByKey.get(getEventKey(event))
                  return !historicalEvent || compareEvents(event, historicalEvent) > 0
                })
              )
            }
          }

          if (!recentEvents.length) return

          if (showNewNotesDirectlyRef.current) {
            setEvents((oldEvents) => mergeTimelines([recentEvents, oldEvents]))
          } else {
            const isAtTop = (() => {
              if (!topRef.current) return true
              const rect = topRef.current.getBoundingClientRect()
              return rect.top >= 50
            })()

            if (isAtTop) {
              setEvents((oldEvents) => mergeTimelines([recentEvents, oldEvents]))
            } else {
              setNewEvents((oldEvents) => mergeTimelines([recentEvents, oldEvents]))
            }
          }
        }

        const { closer, timelineKey } = await client.subscribeTimeline(
          preprocessedSubRequests,
          {
            onEvents: (events, eosed) => {
              if (events.length > 0) {
                if (!since) {
                  setEvents(events)
                } else {
                  const newEvents = events.filter((evt) => evt.created_at >= since)
                  handleNewEvents(newEvents)
                }
              }
              if (eosed) {
                threadService.addRepliesToThread(events)
                setInitialLoading(false)
              }
            },
            onNew: (event) => {
              handleNewEvents([event])
              threadService.addRepliesToThread([event])
            },
            onClose: (url, reason) => {
              if (!showRelayCloseReason) return
              if (isRelayDisconnectReason(reason)) return

              toast.error(`${url}: ${reason}`)
            }
          },
          {
            startLogin,
            needSort: !areAlgoRelays,
            needSaveToDb: isPubkeyFeed
          }
        )
        setTimelineKey(timelineKey)
        return closer
      }

      const promise = init()
      return () => {
        promise.then((closer) => closer())
      }
    }, [JSON.stringify(subRequests), refreshCount, JSON.stringify(showKinds), active])

    const handleLoadMore = useCallback(async () => {
      if (!timelineKey || areAlgoRelays) return false
      const newEvents = await client.loadMoreTimeline(
        timelineKey,
        events.length ? events[events.length - 1].created_at - 1 : dayjs().unix(),
        LIMIT
      )
      if (newEvents.length === 0) {
        setReachedTimelineEnd(true)
        return false
      }
      setReachedTimelineEnd(false)
      setEvents((oldEvents) => [...oldEvents, ...newEvents])
      return true
    }, [timelineKey, events, areAlgoRelays])

    const relayCreatedAtCursor = events.length ? events[events.length - 1].created_at : undefined
    const displayableNoteCount = useMemo(
      () =>
        areAlgoRelays || reachedTimelineEnd
          ? filteredNotes.length
          : getSafeFeedItemCount(filteredNotes, relayCreatedAtCursor, ({ event }) => event),
      [filteredNotes, relayCreatedAtCursor, areAlgoRelays, reachedTimelineEnd]
    )

    const {
      visibleItems,
      shouldShowLoadingIndicator,
      bottomRef,
      retryLoadMore,
      setHasMore,
      setShowCount
    } = useInfiniteScroll({
      items: filteredNotes,
      itemCount: displayableNoteCount,
      showCount: SHOW_COUNT,
      onLoadMore: handleLoadMore,
      initialLoading
    })

    useEffect(() => {
      setHasMore(true)
      setShowCount(SHOW_COUNT)
    }, [JSON.stringify(subRequests), refreshCount, JSON.stringify(showKinds)])

    const showNewEvents = () => {
      setEvents((oldEvents) => mergeTimelines([newEvents, oldEvents]))
      setNewEvents([])
      setTimeout(() => {
        scrollToTop('smooth')
      }, 0)
    }

    const list = (
      <div className="min-h-screen">
        {(wotFilteringDone || (trustScoreThreshold ?? 0) <= 0) &&
          visibleItems.map(({ key, event, reposters }) => (
            <NoteCard
              key={key}
              className="w-full"
              event={event}
              filterMutedNotes={filterMutedNotes}
              reposters={reposters}
            />
          ))}
        <div ref={bottomRef} />
        {(!wotReady || !wotFilteringDone) && (trustScoreThreshold ?? 0) > 0 ? (
          <div className="text-muted-foreground mt-8 flex flex-col items-center justify-center gap-3">
            <Loader className="animate-spin" size={24} />
            <span className="text-sm">{t('Loading web of trust…')}</span>
          </div>
        ) : shouldShowLoadingIndicator || filtering || initialLoading ? (
          <NoteCardLoadingSkeleton />
        ) : events.length ? (
          <div className="mt-2 flex flex-col items-center gap-3">
            <div className="text-muted-foreground text-center text-sm">{t('no more notes')}</div>
            {!areAlgoRelays && (
              <Button variant="outline" size="sm" onClick={retryLoadMore}>
                {t('Try loading more')}
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-8 flex w-full flex-col items-center justify-center gap-4">
            <div className="text-muted-foreground text-center">
              <div className="text-lg font-medium">{t('No notes found')}</div>
              <div className="mt-1 text-sm">{t('Try again later or check your connection')}</div>
            </div>
            <Button size="lg" onClick={() => setRefreshCount((count) => count + 1)}>
              {t('Reload')}
            </Button>
          </div>
        )}
      </div>
    )

    return (
      <div>
        <div ref={topRef} className="scroll-mt-24.25" />
        {initialLoading && shouldShowLoadingIndicator && <LoadingBar />}
        <PullToRefresh
          onRefresh={async () => {
            refresh()
            await new Promise((resolve) => setTimeout(resolve, 1000))
          }}
        >
          {list}
        </PullToRefresh>
        <div className="h-20" />
        {filteredNewEvents.length > 0 && (
          <NewNotesButton newEvents={filteredNewEvents} onClick={showNewEvents} />
        )}
      </div>
    )
  }
)
NoteList.displayName = 'NoteList'
export default NoteList
