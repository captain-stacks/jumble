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
  packAuthor: string
  pubkeys: string[]
}

export type TUpvotedFollowPack = {
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
  getWotNonScoringFollowers: (pubkey: string) => string[]
  getWotMuters: (pubkey: string) => string[]
  getWotNonScoringMuters: (pubkey: string) => string[]
  getWotInLists: (pubkey: string) => string[]
  getWotInListEvents: (pubkey: string) => Event[]
  inspectedPubkey: string | null
  setInspectedPubkey: (pubkey: string | null) => void
  wotSize: number
  muteSetSize: number
  ignoreThumbsdownLists: boolean
  updateIgnoreThumbsdownLists: (value: boolean) => void
  downvotedFollowPacks: TDownvotedFollowPack[]
  downvotedReactionEvents: Event[]
  upvotedFollowPacks: TUpvotedFollowPack[]
  processDownvotedPack: (event: Event) => void
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
let myFollowSet = new Set<string>()
const followCountMap = new Map<string, number>()
const followersMap = new Map<string, Set<string>>()
const muteCountMap = new Map<string, number>() // direct-follow mutes + current user's pack thumbs-downs
const mutersMap = new Map<string, Set<string>>()
const wotNonScoringMutersMap = new Map<string, Set<string>>() // WoT members who muted but aren't direct follows
const wotNonScoringFollowersMap = new Map<string, Set<string>>() // WoT members who follow but aren't direct follows
const inListsMap = new Map<string, Set<string>>()
const inListsEventsMap = new Map<string, Map<string, Event>>()
const countedFollowSet = new Set<string>()
const countedMuteSet = new Set<string>()
const countedPackMuteSet = new Set<string>() // "${packAddr}:${pubkey}" — isolated from countedMuteSet so pack 👎s always count
const packMuteCountMap = new Map<string, number>() // mute counts contributed solely by 👎 packs
const downvotedPackAddrSet = new Set<string>() // naddrs of all 👎'd lists, used by demand fetch to count mutes from all three list kinds
const scorePromiseMap = new Map<string, Promise<void>>()
const scoreDoneSet = new Set<string>()
let myFollowSetSize = 0

// Bayesian-smoothed exponential decay operating in rate space:
//   followRate = follows / myFollowSetSize    (fraction of my follow set who follow this person)
//   muteRate   = mutes / myFollowSetSize      (fraction of my follow set who mute this person)
//   priorRate  = 1 / PRIOR_SCALE              (fixed prior, pool-size-independent)
//   smoothedRatio = (muteRate + priorRate * PRIOR_MUTE_RATE) / (followRate + priorRate)
//   score = round(100 * exp(-DECAY * smoothedRatio))
// Only mutes from direct follows count — pre-fetched during WoT build into distrustSet.
// PRIOR_SCALE is small (5) because the denominator is myFollowSetSize (~200) not wotSize (~2000),
// so we need a stronger prior to prevent single-follow mutes from dominating.
// Examples (myFollowSetSize=200, priorRate=0.2):
//   unknown (0/0) → ~61;  10 follows, 0 mutes → ~80;  2 mutes, 0 follows → ~47;  10 mutes, 0 follows → ~17
const TRUST_PRIOR_MUTE_RATE = 0.1
const TRUST_PRIOR_SCALE = 5   // priorRate = 1/5 = 20% — strong prior needed when denominator is ~200 not ~2000
let trustDecay = storage.getMuteWeight()
const ignoreThumbsdownLists = storage.getIgnoreThumbsdownLists()

function computeTrustScore(pubkey: string): number {
  if (myFollowSetSize === 0) return 0
  const follows = followCountMap.get(pubkey) ?? 0
  const totalMutes = muteCountMap.get(pubkey) ?? 0
  const mutes = ignoreThumbsdownLists
    ? totalMutes - (packMuteCountMap.get(pubkey) ?? 0)
    : totalMutes
  const inRelevantList = ignoreThumbsdownLists
    ? Array.from(inListsMap.get(pubkey) ?? []).some((pk) => myFollowSet.has(pk))
    : inListsMap.has(pubkey)
  if (follows === 0 && mutes === 0 && !inRelevantList) return 1
  const followRate = follows / myFollowSetSize
  const muteRate = mutes / myFollowSetSize
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
  const [ignoreThumbsdownListsState] = useState(() => storage.getIgnoreThumbsdownLists())
  const [isWotReady, setIsWotReady] = useState(false)
  const [wotStep, setWotStep] = useState(0)
  const [muteVersion, setMuteVersion] = useState(0)
  const [demandFetchCount, setDemandFetchCount] = useState(0)
  const [inspectedPubkey, setInspectedPubkey] = useState<string | null>(null)
  const [downvotedFollowPacks, setDownvotedFollowPacks] = useState<TDownvotedFollowPack[]>([])
  const [downvotedReactionEvents, setDownvotedReactionEvents] = useState<Event[]>([])
  const [upvotedFollowPacks, setUpvotedFollowPacks] = useState<TUpvotedFollowPack[]>([])
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

  const updateIgnoreThumbsdownLists = (value: boolean) => {
    storage.setIgnoreThumbsdownLists(value)
    window.location.reload()
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
        myFollowSet = new Set<string>()
        followCountMap.clear()
        countedPackMuteSet.clear()
        packMuteCountMap.clear()
        downvotedPackAddrSet.clear()
        followersMap.clear()
        muteCountMap.clear()
        mutersMap.clear()
        wotNonScoringMutersMap.clear()
        wotNonScoringFollowersMap.clear()
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
        myFollowSet = new Set(directFollows)
        myFollowSetSize = followingSet.size

        // Step 3: Fetch follows-of-follows + mute lists from direct follows in batches
        setWotStep(3)
        const relays = getDefaultRelayUrls()
        const pool = new SimplePool()
        try {
          for (let i = 0; i < directFollows.length; i += BATCH_SIZE) {
            if (cancelled) return
            const batch = directFollows.slice(i, i + BATCH_SIZE)
            const [contactResults, muteResults] = await Promise.all([
              pool.querySync(relays, { authors: batch, kinds: [kinds.Contacts] }),
              pool.querySync(relays, { authors: batch, kinds: [kinds.Mutelist] })
            ])
            const results = [...contactResults, ...muteResults]
            if (cancelled) return
            const contactCount = contactResults.length
            appendQueryLog({ pubkey: `batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length})`, source: 'wot', eventCount: contactCount, relays, filter: { authors: batch, kinds: [kinds.Contacts, kinds.Mutelist] } })
            results.forEach((event) => {
              if (event.kind === kinds.Contacts) {
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
              } else if (event.kind === kinds.Mutelist && myFollowSet.has(event.pubkey)) {
                getPubkeysFromPTags(event.tags).forEach((pubkey) => {
                  if (pubkey === event.pubkey) return
                  const muteKey = `${event.pubkey}:${pubkey}`
                  if (!countedMuteSet.has(muteKey)) {
                    countedMuteSet.add(muteKey)
                    muteCountMap.set(pubkey, (muteCountMap.get(pubkey) ?? 0) + 1)
                    const muters = mutersMap.get(pubkey)
                    if (muters) {
                      muters.add(event.pubkey)
                    } else {
                      mutersMap.set(pubkey, new Set([event.pubkey]))
                    }
                  }
                })
              }
            })
            setMuteVersion((v) => v + 1)
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS))
          }
        } catch {
          // Silently handle errors
        }

        // Apply cached downvoted pack data immediately so scores are ready when WoT is marked ready
        const cachedPacks = !ignoreThumbsdownLists ? storage.getDownvotedPackCache() : []
        if (cachedPacks.length > 0) {
          cachedPacks.forEach(({ addr, packAuthor, pubkeys }) => {
            pubkeys.forEach((pubkey) => {
              const followKey = `${packAuthor}:${pubkey}`
              if (countedFollowSet.has(followKey)) {
                const cur = followCountMap.get(pubkey) ?? 0
                if (cur > 1) followCountMap.set(pubkey, cur - 1)
                else followCountMap.delete(pubkey)
                followersMap.get(pubkey)?.delete(packAuthor)
              }
              const packMuteKey = `${addr}:${pubkey}`
              if (!countedPackMuteSet.has(packMuteKey)) {
                countedPackMuteSet.add(packMuteKey)
                muteCountMap.set(pubkey, (muteCountMap.get(pubkey) ?? 0) + 1)
                packMuteCountMap.set(pubkey, (packMuteCountMap.get(pubkey) ?? 0) + 1)
                const muters = mutersMap.get(pubkey)
                if (muters) muters.add(packAuthor)
                else mutersMap.set(pubkey, new Set([packAuthor]))
              }
            })
            downvotedPackAddrSet.add(addr)
          })
          setDownvotedFollowPacks(cachedPacks)
          setMuteVersion((v) => v + 1)
        }

        setWotStep(4)
        setIsWotReady(true)

        // Background: refresh downvoted pack data from network and update cache
        if (!ignoreThumbsdownLists) try {
          const listKinds = [ExtendedKind.FOLLOW_PACK, kinds.Followsets, kinds.Genericlists]
          const reactionEvents = await pool.querySync(relays, {
            authors: [currentPubkey],
            kinds: [kinds.Reaction],
            '#k': listKinds.map(String),
            '#t': ['👎'],
            limit: 500
          })
          if (!cancelled) {
            setDownvotedReactionEvents(reactionEvents)
            const downvotedAddrs = reactionEvents
              .flatMap((e) =>
                e.tags
                  .filter(([t, v]) => t === 'a' && listKinds.some((k) => v?.startsWith(`${k}:`)))
                  .map(([, v]) => v)
              )

            if (downvotedAddrs.length > 0) {
              // Populate downvotedPackAddrSet immediately from reaction tags so that any
              // demand fetches running concurrently can already match against this set.
              // We track whether new addrs were added so we can invalidate stale
              // demand-fetch cache entries that ran before this point.
              const prevDownvotedSize = downvotedPackAddrSet.size
              downvotedAddrs.forEach((addr) => downvotedPackAddrSet.add(addr))
              const gainedNewAddrs = downvotedPackAddrSet.size > prevDownvotedSize

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
                    const packMuteKey = `${downvotedAddrs[i]}:${pubkey}`
                    if (!countedPackMuteSet.has(packMuteKey)) {
                      countedPackMuteSet.add(packMuteKey)
                      muteCountMap.set(pubkey, (muteCountMap.get(pubkey) ?? 0) + 1)
                      packMuteCountMap.set(pubkey, (packMuteCountMap.get(pubkey) ?? 0) + 1)
                      const muters = mutersMap.get(pubkey)
                      if (muters) muters.add(packAuthor)
                      else mutersMap.set(pubkey, new Set([packAuthor]))
                    }
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
                  })
                  const title =
                    packEvent.tags.find(([t]) => t === 'title')?.[1] ||
                    packEvent.tags.find(([t]) => t === 'd')?.[1] ||
                    `Pack ${i + 1}`
                  downvotedPackAddrSet.add(downvotedAddrs[i])
                  packsData.push({ addr: downvotedAddrs[i], title, packAuthor, pubkeys })
                })
                // Merge in cached packs for addrs not refreshed this run so the
                // cache never shrinks when pack events are temporarily unreachable
                const freshAddrSet = new Set(packsData.map((p) => p.addr))
                for (const cached of cachedPacks) {
                  if (!freshAddrSet.has(cached.addr)) {
                    packsData.push(cached)
                    downvotedPackAddrSet.add(cached.addr)
                  }
                }
                // If we discovered new downvoted packs, demand-fetch results cached before
                // this point may have missed them. Clear the cache so the next profile
                // view re-runs with the complete downvotedPackAddrSet.
                if (gainedNewAddrs) {
                  scorePromiseMap.clear()
                  scoreDoneSet.clear()
                }
                setDownvotedFollowPacks(packsData)
                storage.setDownvotedPackCache(packsData)
                setMuteVersion((v) => v + 1)
              }
            }
          }
        } catch { /* ignore */ } // end ignoreThumbsdownLists guard

        // Treat follow packs the current user 👍'd as follow boosts
        try {
          const listKinds = [ExtendedKind.FOLLOW_PACK, kinds.Followsets, kinds.Genericlists]
          const upvoteReactionEvents = await pool.querySync(relays, {
            authors: [currentPubkey],
            kinds: [kinds.Reaction],
            '#k': listKinds.map(String),
            '#t': ['👍'],
            limit: 500
          })
          if (!cancelled) {
            const upvotedAddrs = upvoteReactionEvents
              .flatMap((e) =>
                e.tags
                  .filter(([t, v]) => t === 'a' && listKinds.some((k) => v?.startsWith(`${k}:`)))
                  .map(([, v]) => v)
              )

            if (upvotedAddrs.length > 0) {
              const packEvents = await Promise.all(
                upvotedAddrs.map((addr) => {
                  const [kindStr, author, dTag] = addr.split(':')
                  return pool.get(relays, {
                    authors: [author],
                    kinds: [Number(kindStr)],
                    '#d': [dTag]
                  })
                })
              )
              if (!cancelled) {
                const upvotedPacksData: TUpvotedFollowPack[] = []
                packEvents.forEach((packEvent, i) => {
                  if (!packEvent) return
                  const packAuthor = packEvent.pubkey
                  const pubkeys = getPubkeysFromPTags(packEvent.tags)
                  pubkeys.forEach((pubkey) => {
                    wotSet.add(pubkey)
                    const followKey = `${packAuthor}:${pubkey}`
                    if (!countedFollowSet.has(followKey)) {
                      countedFollowSet.add(followKey)
                      followCountMap.set(pubkey, (followCountMap.get(pubkey) ?? 0) + 1)
                      const followers = followersMap.get(pubkey)
                      if (followers) {
                        followers.add(packAuthor)
                      } else {
                        followersMap.set(pubkey, new Set([packAuthor]))
                      }
                    }
                  })
                  const title =
                    packEvent.tags.find(([t]) => t === 'title')?.[1] ||
                    packEvent.tags.find(([t]) => t === 'd')?.[1] ||
                    `Pack ${i + 1}`
                  upvotedPacksData.push({ addr: upvotedAddrs[i], title, pubkeys })
                })
                setUpvotedFollowPacks(upvotedPacksData)
                setMuteVersion((v) => v + 1)
              }
            }
          }
        } catch {
          // Silently handle errors
        }

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

        // Step 3: Fetch follows-of-follows + mute lists in parallel batches
        setWotStep(3)
        myFollowSet = new Set(followings)
        myFollowSetSize = followings.length
        for (let i = 0; i < followings.length; i += BATCH_SIZE) {
          const batch = followings.slice(i, i + BATCH_SIZE)
          const [contactResults, muteResults] = await Promise.all([
            pool.querySync(relays, { authors: batch, kinds: [kinds.Contacts] }),
            pool.querySync(relays, { authors: batch, kinds: [kinds.Mutelist] })
          ])
          const results = [...contactResults, ...muteResults]
          const contactCount = contactResults.length
          appendQueryLog({ pubkey: `batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length})`, source: 'wot', eventCount: contactCount, relays, filter: { authors: batch, kinds: [kinds.Contacts, kinds.Mutelist] } })
          results.forEach((event) => {
            if (event.kind === kinds.Contacts) {
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
            } else if (event.kind === kinds.Mutelist) {
              getPubkeysFromPTags(event.tags).forEach((pubkey) => {
                if (pubkey === event.pubkey) return
                const muteKey = `${event.pubkey}:${pubkey}`
                if (!countedMuteSet.has(muteKey)) {
                  countedMuteSet.add(muteKey)
                  muteCountMap.set(pubkey, (muteCountMap.get(pubkey) ?? 0) + 1)
                  const muters = mutersMap.get(pubkey)
                  if (muters) {
                    muters.add(event.pubkey)
                  } else {
                    mutersMap.set(pubkey, new Set([event.pubkey]))
                  }
                }
              })
            }
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

  const getWotNonScoringFollowers = useCallback((pubkey: string): string[] => {
    return Array.from(wotNonScoringFollowersMap.get(pubkey) ?? [])
  }, [])

  const getWotMuters = useCallback((pubkey: string): string[] => {
    const muterSet = new Set(mutersMap.get(pubkey) ?? [])
    if (!ignoreThumbsdownLists) {
      for (const pack of downvotedFollowPacks) {
        if (pack.pubkeys.includes(pubkey)) {
          muterSet.add(pack.packAuthor)
        }
      }
    }
    return Array.from(muterSet)
  }, [downvotedFollowPacks])

  const getWotNonScoringMuters = useCallback((pubkey: string): string[] => {
    return Array.from(wotNonScoringMutersMap.get(pubkey) ?? [])
  }, [])

  const getWotInLists = useCallback((pubkey: string): string[] => {
    const authors = Array.from(inListsMap.get(pubkey) ?? [])
    if (ignoreThumbsdownLists) return authors.filter((pk) => myFollowSet.has(pk))
    return authors
  }, [])

  const getWotInListEvents = useCallback((pubkey: string): Event[] => {
    const events = Array.from(inListsEventsMap.get(pubkey)?.values() ?? [])
    if (ignoreThumbsdownLists) return events.filter((e) => myFollowSet.has(e.pubkey))
    return events
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
          if (event.kind === kinds.Contacts) {
            if (!myFollowSet.has(event.pubkey) && wotSet.has(event.pubkey)) {
              const existing = wotNonScoringFollowersMap.get(pubkey)
              if (existing) existing.add(event.pubkey)
              else wotNonScoringFollowersMap.set(pubkey, new Set([event.pubkey]))
              added++
            }
            continue
          }
          if (event.kind === kinds.Mutelist && !myFollowSet.has(event.pubkey)) {
            if (wotSet.has(event.pubkey)) {
              const existing = wotNonScoringMutersMap.get(pubkey)
              if (existing) existing.add(event.pubkey)
              else wotNonScoringMutersMap.set(pubkey, new Set([event.pubkey]))
              added++
            }
            continue
          }
          const key = `${event.pubkey}:${pubkey}`
          if (event.kind === kinds.Mutelist) {
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
            // List event (FOLLOW_PACK, Followsets, Genericlists, etc.)
            // If it's a 👎'd pack, count as mute; always track list membership for display
            const dTag = event.tags.find(([t]) => t === 'd')?.[1] ?? ''
            const eventAddr = `${event.kind}:${event.pubkey}:${dTag}`
            if (downvotedPackAddrSet.has(eventAddr)) {
              const packMuteKey = `${eventAddr}:${pubkey}`
              if (!countedPackMuteSet.has(packMuteKey)) {
                countedPackMuteSet.add(packMuteKey)
                muteCountMap.set(pubkey, (muteCountMap.get(pubkey) ?? 0) + 1)
                packMuteCountMap.set(pubkey, (packMuteCountMap.get(pubkey) ?? 0) + 1)
                const muters = mutersMap.get(pubkey)
                if (muters) muters.add(event.pubkey)
                else mutersMap.set(pubkey, new Set([event.pubkey]))
                added++
              }
            }
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

  const processDownvotedPack = useCallback((event: Event) => {
    const dTag = event.tags.find(([t]) => t === 'd')?.[1] ?? ''
    const addr = `${event.kind}:${event.pubkey}:${dTag}`
    if (downvotedPackAddrSet.has(addr)) return
    const packAuthor = event.pubkey
    const pubkeys = getPubkeysFromPTags(event.tags)
    const title = event.tags.find(([t]) => t === 'title')?.[1] || dTag || 'Pack'
    pubkeys.forEach((pubkey) => {
      const followKey = `${packAuthor}:${pubkey}`
      if (countedFollowSet.has(followKey)) {
        const cur = followCountMap.get(pubkey) ?? 0
        if (cur > 1) followCountMap.set(pubkey, cur - 1)
        else followCountMap.delete(pubkey)
        followersMap.get(pubkey)?.delete(packAuthor)
      }
      const packMuteKey = `${addr}:${pubkey}`
      if (!countedPackMuteSet.has(packMuteKey)) {
        countedPackMuteSet.add(packMuteKey)
        muteCountMap.set(pubkey, (muteCountMap.get(pubkey) ?? 0) + 1)
        packMuteCountMap.set(pubkey, (packMuteCountMap.get(pubkey) ?? 0) + 1)
        const muters = mutersMap.get(pubkey)
        if (muters) muters.add(packAuthor)
        else mutersMap.set(pubkey, new Set([packAuthor]))
      }
      const inLists = inListsMap.get(pubkey)
      if (inLists) inLists.add(packAuthor)
      else inListsMap.set(pubkey, new Set([packAuthor]))
      const evts = inListsEventsMap.get(pubkey)
      if (evts) evts.set(event.id, event)
      else inListsEventsMap.set(pubkey, new Map([[event.id, event]]))
    })
    downvotedPackAddrSet.add(addr)
    const newPack: TDownvotedFollowPack = { addr, title, packAuthor, pubkeys }
    const existingCache = storage.getDownvotedPackCache()
    if (!existingCache.some((p) => p.addr === addr)) {
      storage.setDownvotedPackCache([...existingCache, newPack])
    }
    setDownvotedFollowPacks((prev) => [...prev, newPack])
    scorePromiseMap.clear()
    scoreDoneSet.clear()
    setMuteVersion((v) => v + 1)
  }, [])

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
        getWotNonScoringFollowers,
        getWotMuters,
        getWotNonScoringMuters,
        getWotInLists,
        getWotInListEvents,
        inspectedPubkey,
        setInspectedPubkey,
        wotSize: wotSet.size,
        muteSetSize: muteCountMap.size,
        ignoreThumbsdownLists: ignoreThumbsdownListsState,
        updateIgnoreThumbsdownLists,
        downvotedFollowPacks,
        downvotedReactionEvents,
        upvotedFollowPacks,
        processDownvotedPack,
        reloadWot,
        queryLog: queryLogRef.current,
        queryLogVersion
      }}
    >
      {children}
    </UserTrustContext.Provider>
  )
}
