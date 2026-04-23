import { ExtendedKind, SPECIAL_TRUST_SCORE_FILTER_ID } from '@/constants'
import client from '@/services/client.service'
import storage from '@/services/local-storage.service'
import bootstrapCache from '@/services/bootstrap-cache.service'
import { getDefaultRelayUrls } from '@/lib/relay'
import { getPubkeysFromPTags } from '@/lib/tag'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useFollowList } from './FollowListProvider'
import { useNostr } from './NostrProvider'
import { kinds, SimplePool } from 'nostr-tools'

const FOLLOW_SOURCE_PUBKEY = import.meta.env.VITE_EASY_LOGIN_FOLLOW_SOURCE_PUBKEY as string | undefined
const BATCH_SIZE = 20
const BATCH_DELAY_MS = 200

type TMuteRatio = {
  follows: number
  mutes: number
  ratio: number
}

type TUserTrustContext = {
  minTrustScore: number
  minTrustScoreMap: Record<string, number>
  getMinTrustScore: (id: string) => number
  updateMinTrustScore: (id: string, score: number) => void
  isUserTrusted: (pubkey: string) => boolean
  isSpammer: (pubkey: string) => Promise<boolean>
  meetsMinTrustScore: (pubkey: string, minScore: number) => Promise<boolean>
  getMuteRatio: (pubkey: string) => TMuteRatio
  getTrustScore: (pubkey: string) => number
  isWotReady: boolean
  wotStep: number
  muteVersion: number
  demandFetchCount: number
  fetchScoreForPubkey: (pubkey: string) => void
  inspectedPubkey: string | null
  setInspectedPubkey: (pubkey: string | null) => void
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
const muteCountMap = new Map<string, number>()
const countedMuteSet = new Set<string>()
const scoreFetchedSet = new Set<string>()
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
const TRUST_DECAY = 5

function computeTrustScore(pubkey: string): number {
  const follows = followCountMap.get(pubkey) ?? 0
  const mutes = muteCountMap.get(pubkey) ?? 0
  if (follows === 0 && mutes === 0) return 1
  const wotSize = wotSet.size
  if (wotSize === 0 || myFollowSetSize === 0) return 1
  const followRate = follows / myFollowSetSize
  const muteRate = mutes / wotSize
  const priorRate = 1 / TRUST_PRIOR_SCALE
  const smoothedRatio =
    (muteRate + priorRate * TRUST_PRIOR_MUTE_RATE) / (followRate + priorRate)
  return Math.max(0, Math.round(100 * Math.exp(-TRUST_DECAY * smoothedRatio)))
}

export function UserTrustProvider({ children }: { children: React.ReactNode }) {
  const { pubkey: currentPubkey, isInitialized } = useNostr()
  const { followingSet } = useFollowList()
  const [minTrustScore, setMinTrustScore] = useState(() => storage.getMinTrustScore())
  const [minTrustScoreMap, setMinTrustScoreMap] = useState<Record<string, number>>(() =>
    storage.getMinTrustScoreMap()
  )
  const [isWotReady, setIsWotReady] = useState(false)
  const [wotStep, setWotStep] = useState(0)
  const [muteVersion, setMuteVersion] = useState(0)
  const [demandFetchCount, setDemandFetchCount] = useState(0)
  const [inspectedPubkey, setInspectedPubkey] = useState<string | null>(null)

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
        muteCountMap.clear()
        countedMuteSet.clear()
        scoreFetchedSet.clear()
        myFollowSetSize = 0
        
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
              batch.map((pubkey) =>
                pool.querySync(relays, { authors: [pubkey], kinds: [kinds.Contacts, kinds.Mutelist], limit: 2 })
              )
            )
            if (cancelled) return
            results.forEach((events) => {
              events.forEach((event) => {
                if (event.kind === kinds.Contacts) {
                  getPubkeysFromPTags(event.tags).forEach((pubkey) => {
                    wotSet.add(pubkey)
                    followCountMap.set(pubkey, (followCountMap.get(pubkey) ?? 0) + 1)
                  })
                } else if (event.kind === kinds.Mutelist) {
                  getPubkeysFromPTags(event.tags).forEach((pubkey) => {
                    const key = `${event.pubkey}:${pubkey}`
                    if (!countedMuteSet.has(key)) {
                      countedMuteSet.add(key)
                      muteCountMap.set(pubkey, (muteCountMap.get(pubkey) ?? 0) + 1)
                    }
                  })
                }
              })
            })
            setMuteVersion((v) => v + 1)
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS))
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

        // Step 3: Fetch follows of follows in batches
        setWotStep(3)
        for (let i = 0; i < followings.length; i += BATCH_SIZE) {
          const batch = followings.slice(i, i + BATCH_SIZE)
          const results = await Promise.all(
            batch.map((pubkey) =>
              pool.get(relays, { authors: [pubkey], kinds: [kinds.Contacts], limit: 1 })
            )
          )
          results.forEach((event) => {
            if (event) {
              getPubkeysFromPTags(event.tags).forEach((pubkey) => wotSet.add(pubkey))
            }
          })
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
  }, [currentPubkey, followingSet, isInitialized])

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

  const fetchScoreForPubkey = useCallback((pubkey: string) => {
    if (!currentPubkey) return
    if (!isWotReady) return
    if (scoreFetchedSet.has(pubkey)) return
    scoreFetchedSet.add(pubkey)

    ;(async () => {
      try {
        let added = 0
        const events = await client.fetchInListsEvents(pubkey)
        for (const event of events) {
          const isMute = event.kind === kinds.Mutelist ||
            (event.kind === ExtendedKind.FOLLOW_SET && event.tags.some(([t, v]) => t === 'l' && v === 'community-pack'))
          if (!isMute) continue
          if (!wotSet.has(event.pubkey)) continue
          const key = `${event.pubkey}:${pubkey}`
          if (!countedMuteSet.has(key)) {
            countedMuteSet.add(key)
            muteCountMap.set(pubkey, (muteCountMap.get(pubkey) ?? 0) + 1)
            added++
          }
        }
        if (added > 0) setMuteVersion((v) => v + 1)
      } catch {
        // Silently handle errors
      } finally {
        setDemandFetchCount((v) => v + 1)
      }
    })()
  }, [currentPubkey, followingSet, isWotReady])

  const meetsMinTrustScore = useCallback(
    async (pubkey: string, minScore: number) => {
      if (minScore === 0) return true
      if (pubkey === currentPubkey) return true

      return computeTrustScore(pubkey) >= minScore
    },
    [currentPubkey]
  )

  return (
    <UserTrustContext.Provider
      value={{
        minTrustScore,
        minTrustScoreMap,
        getMinTrustScore,
        updateMinTrustScore,
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
        inspectedPubkey,
        setInspectedPubkey
      }}
    >
      {children}
    </UserTrustContext.Provider>
  )
}
