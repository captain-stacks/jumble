import { ExtendedKind, SPECIAL_TRUST_SCORE_FILTER_ID } from '@/constants'
import client from '@/services/client.service'
import storage from '@/services/local-storage.service'
import bootstrapCache from '@/services/bootstrap-cache.service'
import { getDefaultRelayUrls } from '@/lib/relay'
import { getPubkeysFromPTags } from '@/lib/tag'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useFollowList } from './FollowListProvider'
import { useNostr } from './NostrProvider'
import { Event, kinds, SimplePool } from 'nostr-tools'

const FOLLOW_SOURCE_PUBKEY = import.meta.env.VITE_EASY_LOGIN_FOLLOW_SOURCE_PUBKEY as string | undefined
const BATCH_SIZE = 20
const BATCH_DELAY_MS = 500
const DEMAND_CONCURRENCY = 3

let demandActive = 0
const demandQueue: Array<() => void> = []
function acquireDemandSlot(priority = false): Promise<void> {
  if (demandActive < DEMAND_CONCURRENCY) { demandActive++; return Promise.resolve() }
  return new Promise((resolve) => {
    if (priority) {
      demandQueue.unshift(resolve)
    } else {
      demandQueue.push(resolve)
    }
  })
}
function releaseDemandSlot() {
  const next = demandQueue.shift()
  if (next) { next() } else { demandActive-- }
}

type TMuteRatio = {
  follows: number
  mutes: number
  ratio: number
}

export type TDownvotedFollowPack = {
  addr: string
  title: string
  pubkeys: string[]
}

export type TQueryLogEntry = {
  pubkey: string
  source: 'wot' | 'demand'
  eventCount: number
  error?: string
  relays?: string[]
  filter?: object
}

type TUserTrustContext = {
  minTrustScore: number
  minTrustScoreMap: Record<string, number>
  getMinTrustScore: (id: string) => number
  updateMinTrustScore: (id: string, score: number) => void
  muteWeight: number
  updateMuteWeight: (weight: number) => void
  isUserTrusted: (pubkey: string) => boolean
  isSpammer: (pubkey: string) => Promise<boolean>
  meetsMinTrustScore: (pubkey: string, minScore: number) => Promise<boolean>
  getMuteRatio: (pubkey: string) => TMuteRatio
  getTrustScore: (pubkey: string) => number
  isWotReady: boolean
  wotStep: number
  muteVersion: number
  demandFetchCount: number
  fetchScoreForPubkey: (pubkey: string, priority?: boolean) => Promise<void>
  refetchScoreForPubkey: (pubkey: string, priority?: boolean) => Promise<void>
  isScoreFetched: (pubkey: string) => boolean
  getWotFollowers: (pubkey: string) => string[]
  getWotMuters: (pubkey: string) => string[]
  getWotInLists: (pubkey: string) => string[]
  getWotInListEvents: (pubkey: string) => Event[]
  inspectedPubkey: string | null
  setInspectedPubkey: (pubkey: string | null) => void
  downvotedFollowPacks: TDownvotedFollowPack[]
  reloadWot: () => void
  queryLog: TQueryLogEntry[]
  queryLogVersion: number
}

export const useUserTrustReady = () => {
  const context = useContext(UserTrustContext)
  if (!context) {
    throw new Error('useUserTrustReady must be used within UserTrustProvider')
  }
  return context.isWotReady
}

const UserTrustContext = createContext<TUserTrustContext | undefined>(undefined)

export const useUserTrust = () => {
  const context = useContext(UserTrustContext)
  if (!context) {
    throw new Error('useUserTrust must be used within a UserTrustProvider')
  }
  return context
}

const wotSet = new Set<string>()
const followCountMap = new Map<string, number>()
const followersMap = new Map<string, Set<string>>()
const muteCountMap = new Map<string, number>()
const mutersMap = new Map<string, Set<string>>()
const inListsMap = new Map<string, Set<string>>()
const inListsEventsMap = new Map<string, Map<string, Event>>()
const countedFollowSet = new Set<string>()
const countedMuteSet = new Set<string>()
const scorePromiseMap = new Map<string, Promise<void>>()
const scoreDoneSet = new Set<string>()
let myFollowSetSize = 0

// Bayesian-smoothed exponential decay operating in rate space:
//   followRate = follows / myFollowSetSize    (fraction of my follow set who follow this person)
//   muteRate   = mutes / wotSize              (fraction of full WoT who mute this person)
//   priorRate  = 1 / PRIOR_SCALE              (fixed prior, pool-size-independent)
//   smoothedRatio = (muteRate + priorRate * PRIOR_MUTE_RATE) / (followRate + priorRate)
//   score = round(100 * exp(-DECAY * smoothedRatio))
// Examples (myFollowSetSize=200, wotSize=2000):
//   unknown (0/0) → ~61;  10 follows, 0 mutes → ~87;  0 follows, 10 mutes → ~17
const TRUST_PRIOR_MUTE_RATE = 0.1
const TRUST_PRIOR_SCALE = 50   // priorRate = 1/50 = 2%
let trustDecay = storage.getMuteWeight()

function computeTrustScore(pubkey: string): number {
  const wotSize = wotSet.size
  if (wotSize === 0 || myFollowSetSize === 0) return 0
  const follows = followCountMap.get(pubkey) ?? 0
  const mutes = muteCountMap.get(pubkey) ?? 0
  if (follows === 0 && mutes === 0 && !inListsMap.has(pubkey)) return 1
  const followRate = follows / myFollowSetSize
  const muteRate = mutes / wotSize
  const priorRate = 1 / TRUST_PRIOR_SCALE
  const smoothedRatio =
    (muteRate + priorRate * TRUST_PRIOR_MUTE_RATE) / (followRate + priorRate)
  return Math.max(0, Math.round(100 * Math.exp(-trustDecay * smoothedRatio)))
}

export function UserTrustProvider({ children }: { children: React.ReactNode }) {
  const { pubkey: currentPubkey, isInitialized } = useNostr()
  const { followingSet } = useFollowList()
  const [minTrustScore, setMinTrustScore] = useState(() => storage.getMinTrustScore())
  const [minTrustScoreMap, setMinTrustScoreMap] = useState<Record<string, number>>(() =>
    storage.getMinTrustScoreMap()
  )
  const [muteWeight, setMuteWeight] = useState(() => storage.getMuteWeight())
  const [isWotReady, setIsWotReady] = useState(false)
  const [wotStep, setWotStep] = useState(0)
  const [muteVersion, setMuteVersion] = useState(0)
  const [demandFetchCount, setDemandFetchCount] = useState(0)
  const [inspectedPubkey, setInspectedPubkey] = useState<string | null>(null)
  const [downvotedFollowPacks, setDownvotedFollowPacks] = useState<TDownvotedFollowPack[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const queryLogRef = useRef<TQueryLogEntry[]>([])
  const [queryLogVersion, setQueryLogVersion] = useState(0)

  const reloadWot = useCallback(() => setReloadKey((k) => k + 1), [])

  const appendQueryLog = useCallback((entry: TQueryLogEntry) => {
    queryLogRef.current = [entry, ...queryLogRef.current].slice(0, 500)
    setQueryLogVersion((v) => v + 1)
  }, [])

  const updateMuteWeight = (weight: number) => {
    if (weight < 1 || weight > 10) return
    trustDecay = weight
    setMuteWeight(weight)
    storage.setMuteWeight(weight)
    setMuteVersion((v) => v + 1)
  }

  useEffect(() => {
    let cancelled = false
    const initWoT = async () => {
      // WAIT: Don't run any bootstrap logic until account initialization is complete
      if (!isInitialized) {
        setIsWotReady(false)
        return
      }

      // IMMEDIATE CHECK: If user is logged in, handle it and return - no bootstrap
      if (currentPubkey) {
        bootstrapCache.clear()
        
        // Ensure WoT doesn't persist state from bootstrap
        wotSet.clear()
        followCountMap.clear()
        followersMap.clear()
        muteCountMap.clear()
        mutersMap.clear()
        inListsMap.clear()
        inListsEventsMap.clear()
        countedFollowSet.clear()
        countedMuteSet.clear()
        scorePromiseMap.clear()
        scoreDoneSet.clear()
        myFollowSetSize = 0
        queryLogRef.current = []
        
        // Wait for followingSet to be populated before building WoT
        if (followingSet.size === 0) {
          setIsWotReady(false)
          return
        }
        
        setIsWotReady(false)
        setWotStep(0)
        
        // Step 1: Add current user
        wotSet.add(currentPubkey)
        setWotStep(1)
        
        // Step 2: Add direct follows (already fetched from their account)
        setWotStep(2)
        const directFollows = Array.from(followingSet)
        directFollows.forEach((pubkey) => wotSet.add(pubkey))
        myFollowSetSize = followingSet.size
        
        // Step 3: Fetch follows-of-follows and mute lists in batches
        setWotStep(3)
        const relays = getDefaultRelayUrls()
        const pool = new SimplePool()
        try {
          for (let i = 0; i < directFollows.length; i += BATCH_SIZE) {
            if (cancelled) return
            const batch = directFollows.slice(i, i + BATCH_SIZE)
            const results = await Promise.all(
              batch.map((pubkey) => pool.get(relays, { authors: [pubkey], kinds: [kinds.Contacts] }))
            )
            if (cancelled) return
            appendQueryLog({ pubkey: `batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length})`, source: 'wot', eventCount: results.filter(Boolean).length, relays, filter: { authors: batch, kinds: [kinds.Contacts] } })
            results.forEach((event) => {
              if (!event) return
              getPubkeysFromPTags(event.tags).forEach((pubkey) => {
                wotSet.add(pubkey)
                if (pubkey === event.pubkey) return
                const followKey = `${event.pubkey}:${pubkey}`
                if (!countedFollowSet.has(followKey)) {
                  countedFollowSet.add(followKey)
                  followCountMap.set(pubkey, (followCountMap.get(pubkey) ?? 0) + 1)
                  const followers = followersMap.get(pubkey)
                  if (followers) {
                    followers.add(event.pubkey)
                  } else {
                    followersMap.set(pubkey, new Set([event.pubkey]))
                  }
                }
              })
            })
            setMuteVersion((v) => v + 1)
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS))
          }
        } catch {
          // Silently handle errors
        }

        // Treat follow packs the current user 👎'd as personal mute lists
        try {
          const listKinds = [ExtendedKind.FOLLOW_PACK, kinds.Followsets, kinds.Genericlists]
          const reactionEvents = await pool.querySync(relays, {
            authors: [currentPubkey],
            kinds: [kinds.Reaction],
            '#k': listKinds.map(String),
            '#t': ['👎'],
            limit: 500
          })
          if (!cancelled) {
            const downvotedAddrs = reactionEvents
              .flatMap((e) =>
                e.tags
                  .filter(([t, v]) => t === 'a' && listKinds.some((k) => v?.startsWith(`${k}:`)))
                  .map(([, v]) => v)
              )

            if (downvotedAddrs.length > 0) {
              const packEvents = await Promise.all(
                downvotedAddrs.map((addr) => {
                  const [kindStr, author, dTag] = addr.split(':')
                  return pool.get(relays, {
                    authors: [author],
                    kinds: [Number(kindStr)],
                    '#d': [dTag]
                  })
                })
              )
              if (!cancelled) {
                const packsData: TDownvotedFollowPack[] = []
                packEvents.forEach((packEvent, i) => {
                  if (!packEvent) return
                  const packAuthor = packEvent.pubkey
                  const pubkeys = getPubkeysFromPTags(packEvent.tags)
                  pubkeys.forEach((pubkey) => {
                    // Strip any follow credit the pack author gave this pubkey and flip it to a mute
                    const followKey = `${packAuthor}:${pubkey}`
                    if (countedFollowSet.has(followKey)) {
                      const cur = followCountMap.get(pubkey) ?? 0
                      if (cur > 1) {
                        followCountMap.set(pubkey, cur - 1)
                      } else {
                        followCountMap.delete(pubkey)
                      }
                      followersMap.get(pubkey)?.delete(packAuthor)
                      // Leave followKey in countedFollowSet so it isn't re-added on future passes
                    }
                    const muteKeyAuthor = `${packAuthor}:${pubkey}`
                    if (!countedMuteSet.has(muteKeyAuthor)) {
                      countedMuteSet.add(muteKeyAuthor)
                      muteCountMap.set(pubkey, (muteCountMap.get(pubkey) ?? 0) + 1)
                      const inLists = inListsMap.get(pubkey)
                      if (inLists) {
                        inLists.add(packAuthor)
                      } else {
                        inListsMap.set(pubkey, new Set([packAuthor]))
                      }
                      const evts = inListsEventsMap.get(pubkey)
                      if (evts) {
                        evts.set(packEvent.id, packEvent)
                      } else {
                        inListsEventsMap.set(pubkey, new Map([[packEvent.id, packEvent]]))
                      }
                    }
                  })
                  const title =
                    packEvent.tags.find(([t]) => t === 'title')?.[1] ||
                    packEvent.tags.find(([t]) => t === 'd')?.[1] ||
                    `Pack ${i + 1}`
                  packsData.push({ addr: downvotedAddrs[i], title, pubkeys })
                })
                setDownvotedFollowPacks(packsData)
                setMuteVersion((v) => v + 1)
              }
            }
          }
        } catch {
          // Silently handle errors
        }

        setWotStep(4)
        setIsWotReady(true)
        return
      }

      // For non-logged-in users: bootstrap from FOLLOW_SOURCE_PUBKEY
      myFollowSetSize = 0
      if (!FOLLOW_SOURCE_PUBKEY) {
        setIsWotReady(true)
        return
      }

      const sourcePubkey = FOLLOW_SOURCE_PUBKEY

      // Build bootstrap WoT using standard relays
      const relays = getDefaultRelayUrls()

      try {
        const pool = new SimplePool()

        // Step 1: Add source pubkey
        wotSet.add(sourcePubkey)
        setWotStep(1)

        // Step 2: Fetch direct follows
        setWotStep(2)
        const followListFilter = {
          authors: [sourcePubkey],
          kinds: [kinds.Contacts],
          limit: 1
        }
        const followListEvent = await pool.get(relays, followListFilter)
        const followings = followListEvent ? getPubkeysFromPTags(followListEvent.tags) : []
        followings.forEach((pubkey) => wotSet.add(pubkey))

        // Step 3: Fetch follows-of-follows in parallel batches (contacts only)
        setWotStep(3)
        myFollowSetSize = followings.length
        for (let i = 0; i < followings.length; i += BATCH_SIZE) {
          const batch = followings.slice(i, i + BATCH_SIZE)
          const results = await Promise.all(
            batch.map((pubkey) => pool.get(relays, { authors: [pubkey], kinds: [kinds.Contacts] }))
          )
          appendQueryLog({ pubkey: `batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length})`, source: 'wot', eventCount: results.filter(Boolean).length, relays, filter: { authors: batch, kinds: [kinds.Contacts] } })
          results.forEach((event) => {
            if (!event) return
            getPubkeysFromPTags(event.tags).forEach((pubkey) => {
              wotSet.add(pubkey)
              if (pubkey === event.pubkey) return
              const followKey = `${event.pubkey}:${pubkey}`
              if (!countedFollowSet.has(followKey)) {
                countedFollowSet.add(followKey)
                followCountMap.set(pubkey, (followCountMap.get(pubkey) ?? 0) + 1)
                const followers = followersMap.get(pubkey)
                if (followers) {
                  followers.add(event.pubkey)
                } else {
                  followersMap.set(pubkey, new Set([event.pubkey]))
                }
              }
            })
          })
          setMuteVersion((v) => v + 1)
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS))
        }

        // Step 4: Done
        setWotStep(4)

        bootstrapCache.setWoT(Array.from(wotSet))

        // Also cache mute list for bootstrap - but only if user hasn't logged in
        if (!currentPubkey) {
          const spicyListEvent = await client.fetchParameterizedReplaceableEvent(sourcePubkey, 30001, 'spicy')
          if (spicyListEvent) {
            const spicyPubkeys = spicyListEvent.tags.filter(([t]) => t === 'p').map(([, pubkey]) => pubkey)
            bootstrapCache.setMuteList(spicyPubkeys)
          }
        }

        // Now mark WoT as ready, after cache is populated
        setIsWotReady(true)
      } catch {
        // Silently handle errors
        setIsWotReady(true)
      }
    }
    initWoT()
    return () => { cancelled = true }
  }, [currentPubkey, followingSet, isInitialized, reloadKey])

  const isUserTrusted = useCallback(
    (pubkey: string) => {
      if (pubkey === currentPubkey) return true
      if (!currentPubkey && !FOLLOW_SOURCE_PUBKEY) return true
      return wotSet.has(pubkey)
    },
    [currentPubkey]
  )

  const isSpammer = useCallback(
    async (pubkey: string) => {
      if (pubkey === currentPubkey) return false
      return computeTrustScore(pubkey) < 60
    },
    [currentPubkey]
  )

  const getMinTrustScore = useCallback(
    (id: string) => {
      return id === SPECIAL_TRUST_SCORE_FILTER_ID.DEFAULT
        ? minTrustScore
        : (minTrustScoreMap[id] ?? minTrustScore)
    },
    [minTrustScore, minTrustScoreMap]
  )

  const updateMinTrustScore = (id: string, score: number) => {
    if (score < 0 || score > 100) return

    if (id === SPECIAL_TRUST_SCORE_FILTER_ID.DEFAULT) {
      setMinTrustScore(score)
      storage.setMinTrustScore(score)
    } else {
      const newMap = { ...minTrustScoreMap, [id]: score }
      setMinTrustScoreMap(newMap)
      storage.setMinTrustScoreMap(newMap)
    }
  }

  const getMuteRatio = useCallback((pubkey: string): TMuteRatio => {
    const follows = followCountMap.get(pubkey) ?? 0
    const mutes = muteCountMap.get(pubkey) ?? 0
    return { follows, mutes, ratio: follows > 0 ? mutes / follows : 0 }
  }, [])

  const getTrustScore = useCallback((pubkey: string): number => {
    return computeTrustScore(pubkey)
  }, [])

  const getWotFollowers = useCallback((pubkey: string): string[] => {
    return Array.from(followersMap.get(pubkey) ?? [])
  }, [])

  const getWotMuters = useCallback((pubkey: string): string[] => {
    return Array.from(mutersMap.get(pubkey) ?? [])
  }, [])

  const getWotInLists = useCallback((pubkey: string): string[] => {
    return Array.from(inListsMap.get(pubkey) ?? [])
  }, [])

  const getWotInListEvents = useCallback((pubkey: string): Event[] => {
    return Array.from(inListsEventsMap.get(pubkey)?.values() ?? [])
  }, [])

  const fetchScoreForPubkey = useCallback((pubkey: string, priority = false): Promise<void> => {
    if (!currentPubkey || !isWotReady) return Promise.resolve()

    const cached = scorePromiseMap.get(pubkey)
    if (cached) return cached

    const promise = (async () => {
      let succeeded = false
      await acquireDemandSlot(priority)
      try {
        let added = 0
        const { events, relays: demandRelays } = await client.fetchInListsEvents(pubkey)
        const muteCount = events.filter((e) => e.kind === kinds.Mutelist).length
        const listCount = events.length - muteCount
        appendQueryLog({ pubkey, source: 'demand', eventCount: muteCount, relays: demandRelays, filter: { kinds: [kinds.Mutelist], '#p': [pubkey] } })
        appendQueryLog({ pubkey, source: 'demand', eventCount: listCount, relays: demandRelays, filter: { kinds: [kinds.Followsets, kinds.Genericlists, ExtendedKind.FOLLOW_PACK], '#p': [pubkey] } })
        for (const event of events) {
          if (event.pubkey === pubkey) continue
          if (event.kind === kinds.Mutelist && !wotSet.has(event.pubkey)) continue
          const key = `${event.pubkey}:${pubkey}`
          if (event.kind === ExtendedKind.FOLLOW_PACK) {
            // Already counted as a follow during WoT build; only add to display map
            const evts = inListsEventsMap.get(pubkey)
            if (!evts?.has(event.id)) {
              const inLists = inListsMap.get(pubkey)
              if (inLists) {
                inLists.add(event.pubkey)
              } else {
                inListsMap.set(pubkey, new Set([event.pubkey]))
              }
              if (evts) {
                evts.set(event.id, event)
              } else {
                inListsEventsMap.set(pubkey, new Map([[event.id, event]]))
              }
              added++
            }
          } else if (event.kind === kinds.Mutelist) {
            if (!countedMuteSet.has(key)) {
              countedMuteSet.add(key)
              muteCountMap.set(pubkey, (muteCountMap.get(pubkey) ?? 0) + 1)
              const existing = mutersMap.get(pubkey)
              if (existing) {
                existing.add(event.pubkey)
              } else {
                mutersMap.set(pubkey, new Set([event.pubkey]))
              }
              added++
            }
          } else {
            // Non-mute list (Followsets, Genericlists, etc.) — list membership knocks
            // the user out of "unknown" status without contributing to follow or mute counts
            const evts = inListsEventsMap.get(pubkey)
            if (!evts?.has(event.id)) {
              const inLists = inListsMap.get(pubkey)
              if (inLists) {
                inLists.add(event.pubkey)
              } else {
                inListsMap.set(pubkey, new Set([event.pubkey]))
              }
              if (evts) {
                evts.set(event.id, event)
              } else {
                inListsEventsMap.set(pubkey, new Map([[event.id, event]]))
              }
              added++
            }
          }
        }
        if (added > 0) setMuteVersion((v) => v + 1)
        succeeded = true
      } catch (e) {
        appendQueryLog({ pubkey, source: 'demand', eventCount: 0, error: String(e) })
        scorePromiseMap.delete(pubkey)
      } finally {
        releaseDemandSlot()
        if (succeeded) scoreDoneSet.add(pubkey)
        setDemandFetchCount((v) => v + 1)
      }
    })()

    scorePromiseMap.set(pubkey, promise)
    return promise
  }, [currentPubkey, isWotReady])

  const meetsMinTrustScore = useCallback(
    async (pubkey: string, minScore: number) => {
      if (minScore === 0) return true
      if (pubkey === currentPubkey) return true

      return computeTrustScore(pubkey) >= minScore
    },
    [currentPubkey]
  )

  const refetchScoreForPubkey = useCallback((pubkey: string, priority = false): Promise<void> => {
    scorePromiseMap.delete(pubkey)
    scoreDoneSet.delete(pubkey)
    return fetchScoreForPubkey(pubkey, priority)
  }, [fetchScoreForPubkey])

  const isScoreFetched = useCallback((pubkey: string) => scoreDoneSet.has(pubkey), [])

  return (
    <UserTrustContext.Provider
      value={{
        minTrustScore,
        minTrustScoreMap,
        getMinTrustScore,
        updateMinTrustScore,
        muteWeight,
        updateMuteWeight,
        isUserTrusted,
        isSpammer,
        meetsMinTrustScore,
        getMuteRatio,
        getTrustScore,
        isWotReady,
        wotStep,
        muteVersion,
        demandFetchCount,
        fetchScoreForPubkey,
        refetchScoreForPubkey,
        isScoreFetched,
        getWotFollowers,
        getWotMuters,
        getWotInLists,
        getWotInListEvents,
        inspectedPubkey,
        setInspectedPubkey,
        downvotedFollowPacks,
        reloadWot,
        queryLog: queryLogRef.current,
        queryLogVersion
      }}
    >
      {children}
    </UserTrustContext.Provider>
  )
}
