import { SPECIAL_FEED_ID, SPECIAL_TRUST_SCORE_FILTER_ID, SPAMMER_PERCENTILE_THRESHOLD } from '@/constants'
import client from '@/services/client.service'
import storage from '@/services/local-storage.service'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useNostr } from './NostrProvider'

type TWotStats = {
  follows: number
  mutes: number
  myFollowSetSize: number
  sampleFollowers: string[]
  sampleMuters: string[]
}

type TUserTrustContext = {
  minTrustScore: number
  minTrustScoreMap: Record<string, number>
  getMinTrustScore: (id: string) => number
  updateMinTrustScore: (id: string, score: number) => void
  isUserTrusted: (pubkey: string) => boolean
  isSpammer: (pubkey: string) => Promise<boolean>
  meetsMinTrustScore: (pubkey: string, minScore: number) => Promise<boolean>
  pickRecommendedPubkeys: (count: number, excludeSet: Set<string>) => string[]
  computeTrustScore: (pubkey: string) => number
  trustDecay: number
  setTrustDecay: (decay: number) => void
  wotReady: boolean
  getWotStats: (pubkey: string) => TWotStats
}

const UserTrustContext = createContext<TUserTrustContext | undefined>(undefined)

export const useUserTrust = () => {
  const context = useContext(UserTrustContext)
  if (!context) {
    throw new Error('useUserTrust must be used within a UserTrustProvider')
  }
  return context
}

const FOLLOW_RATE_CAP = 0.5
const TRUST_PRIOR_MUTE_RATE = 0.1
const TRUST_PRIOR_SCALE = 5
const PRIOR_RATE = 1 / TRUST_PRIOR_SCALE
const wotScoreMap = new Map<string, number>()
const wotMuteMap = new Map<string, number>()
const wotFollowersByTarget = new Map<string, string[]>()
const wotMutersByTarget = new Map<string, string[]>()
let myFollowSetSize = 0

let _trustDecay = 7
let _maxRaw = 0
let _minRaw = 0

function recomputeDecayBounds(decay: number) {
  _trustDecay = decay
  _maxRaw = Math.exp((-decay * PRIOR_RATE * TRUST_PRIOR_MUTE_RATE) / (FOLLOW_RATE_CAP + PRIOR_RATE))
  _minRaw = Math.exp((-decay * (1 + PRIOR_RATE * TRUST_PRIOR_MUTE_RATE)) / PRIOR_RATE)
}
recomputeDecayBounds(7)

function computeTrustScore(pubkey: string): number {
  // No signal at all from the network → treat as untrusted stranger
  if (!wotScoreMap.has(pubkey) && !wotMuteMap.has(pubkey)) return 5

  const follows = wotScoreMap.get(pubkey) ?? 0
  const mutes = wotMuteMap.get(pubkey) ?? 0
  const size = myFollowSetSize > 0 ? myFollowSetSize : 1
  const followRate = follows / size
  const muteRate = mutes / size
  const cappedFollowRate = Math.min(followRate, FOLLOW_RATE_CAP)
  const smoothedRatio =
    (muteRate + PRIOR_RATE * TRUST_PRIOR_MUTE_RATE) / (cappedFollowRate + PRIOR_RATE)
  const raw = Math.exp(-_trustDecay * smoothedRatio)
  return Math.min(100, Math.max(0, Math.round(((raw - _minRaw) / (_maxRaw - _minRaw)) * 100)))
}

export function UserTrustProvider({ children }: { children: React.ReactNode }) {
  const { pubkey: currentPubkey } = useNostr()
  const [minTrustScore, setMinTrustScore] = useState(() => storage.getMinTrustScore())
  const [minTrustScoreMap, setMinTrustScoreMap] = useState<Record<string, number>>(() =>
    storage.getMinTrustScoreMap()
  )
  const [trustDecay, setTrustDecayState] = useState(() => {
    const stored = storage.getTrustDecay()
    recomputeDecayBounds(stored) // sync module-level bounds with stored value
    return stored
  })
  const [wotReady, setWotReady] = useState(false)

  useEffect(() => {
    if (!currentPubkey) return

    setWotReady(false)
    wotScoreMap.clear()
    wotMuteMap.clear()
    wotFollowersByTarget.clear()
    wotMutersByTarget.clear()
    myFollowSetSize = 0

    const initWoT = async () => {
      const followings = [...new Set(await client.fetchFollowings(currentPubkey, false))]
      myFollowSetSize = followings.length
      followings.forEach((pubkey) => {
        if (!wotScoreMap.has(pubkey)) wotScoreMap.set(pubkey, 0)
      })

      const batchSize = 20

      // Phase 1: build WoT follow set
      for (let i = 0; i < followings.length; i += batchSize) {
        const batch = followings.slice(i, i + batchSize)
        await Promise.allSettled(
          batch.map(async (pubkey) => {
            const uniqueFollowings = [...new Set(await client.fetchFollowings(pubkey, false))]
            uniqueFollowings.forEach((following) => {
              wotScoreMap.set(following, (wotScoreMap.get(following) ?? 0) + 1)
              wotFollowersByTarget.set(following, [
                ...(wotFollowersByTarget.get(following) ?? []),
                pubkey
              ])
            })
          })
        )
        await new Promise((resolve) => setTimeout(resolve, 200))
      }

      // Phase 2: load mute sets
      for (let i = 0; i < followings.length; i += batchSize) {
        const batch = followings.slice(i, i + batchSize)
        await Promise.allSettled(
          batch.map(async (pubkey) => {
            const muteListEvent = await client.fetchMuteListEvent(pubkey)
            if (!muteListEvent) return
            const mutedPubkeys = [
              ...new Set(
                muteListEvent.tags
                  .filter((tag) => tag[0] === 'p' && tag[1])
                  .map((tag) => tag[1])
              )
            ]
            mutedPubkeys.forEach((target) => {
              wotMuteMap.set(target, (wotMuteMap.get(target) ?? 0) + 1)
              wotMutersByTarget.set(target, [
                ...(wotMutersByTarget.get(target) ?? []),
                pubkey
              ])
            })
          })
        )
        await new Promise((resolve) => setTimeout(resolve, 200))
      }

      setWotReady(true)
    }
    initWoT()
  }, [currentPubkey])

  const isUserTrusted = useCallback(
    (pubkey: string) => {
      if (!currentPubkey || pubkey === currentPubkey) return true
      return wotScoreMap.has(pubkey)
    },
    [currentPubkey]
  )

  const isSpammer = useCallback(
    async (pubkey: string) => {
      if (!wotReady) return false
      return computeTrustScore(pubkey) < SPAMMER_PERCENTILE_THRESHOLD
    },
    [wotReady]
  )

  const pickRecommendedPubkeys = useCallback((count: number, excludeSet: Set<string>) => {
    const candidates: { pubkey: string; score: number }[] = []
    wotScoreMap.forEach((score, pubkey) => {
      if (!excludeSet.has(pubkey)) {
        candidates.push({ pubkey, score })
      }
    })
    candidates.sort((a, b) => b.score - a.score)
    const pool = candidates.slice(0, 50)
    // Fisher-Yates shuffle, but only as many swaps as we need
    const take = Math.min(count, pool.length)
    for (let i = 0; i < take; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    return pool.slice(0, take).map((c) => c.pubkey)
  }, [])

  const getMinTrustScore = useCallback(
    (id: string) => {
      if (id === SPECIAL_TRUST_SCORE_FILTER_ID.DEFAULT) return minTrustScore
      if (id in minTrustScoreMap) return minTrustScoreMap[id]
      if (id === SPECIAL_FEED_ID.GLOBAL) return 100
      return minTrustScore
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

  const meetsMinTrustScore = useCallback(
    async (pubkey: string, minScore: number) => {
      if (minScore === 0) return true
      if (pubkey === currentPubkey) return true
      // Allow everything through until WoT data has finished loading
      if (!wotReady) return true
      return computeTrustScore(pubkey) >= minScore
    },
    [currentPubkey, wotReady]
  )

  const setTrustDecay = useCallback((decay: number) => {
    if (decay < 1 || decay > 10) return
    recomputeDecayBounds(decay)
    storage.setTrustDecay(decay)
    setTrustDecayState(decay)
  }, [])

  const computeTrustScoreCallback = useCallback((pubkey: string) => computeTrustScore(pubkey), [])

  const getWotStats = useCallback(
    (pubkey: string): TWotStats => ({
      follows: wotScoreMap.get(pubkey) ?? 0,
      mutes: wotMuteMap.get(pubkey) ?? 0,
      myFollowSetSize,
      sampleFollowers: wotFollowersByTarget.get(pubkey) ?? [],
      sampleMuters: wotMutersByTarget.get(pubkey) ?? []
    }),
    // Re-create when WoT finishes loading so consumers re-read the maps
    [wotReady]
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
        pickRecommendedPubkeys,
        computeTrustScore: computeTrustScoreCallback,
        trustDecay,
        setTrustDecay,
        wotReady,
        getWotStats
      }}
    >
      {children}
    </UserTrustContext.Provider>
  )
}
