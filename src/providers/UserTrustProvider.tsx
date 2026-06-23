import { SPECIAL_FEED_ID, SPECIAL_TRUST_SCORE_FILTER_ID, SPAMMER_PERCENTILE_THRESHOLD } from '@/constants'
import client from '@/services/client.service'
import storage from '@/services/local-storage.service'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useFollowList } from './FollowListProvider'

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
const wotFollowersByTarget = new Map<string, Set<string>>()
const wotMutersByTarget = new Map<string, Set<string>>()
let myFollowSetSize = 0

let _trustDecay = 7
let _maxRaw = 0
let _minRaw = 0

function resetWotState() {
  wotScoreMap.clear()
  wotMuteMap.clear()
  wotFollowersByTarget.clear()
  wotMutersByTarget.clear()
  myFollowSetSize = 0
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    resetWotState()
  })
}

function recomputeDecayBounds(decay: number) {
  _trustDecay = decay
  _maxRaw = Math.exp((-decay * PRIOR_RATE * TRUST_PRIOR_MUTE_RATE) / (FOLLOW_RATE_CAP + PRIOR_RATE))
  _minRaw = Math.exp((-decay * (1 + PRIOR_RATE * TRUST_PRIOR_MUTE_RATE)) / PRIOR_RATE)
}
recomputeDecayBounds(7)

function computeTrustScore(pubkey: string): number {
  const follows = wotScoreMap.get(pubkey) ?? 0
  const mutes = wotMuteMap.get(pubkey) ?? 0

  // Nobody in the network follows them → unknown stranger baseline
  if (follows === 0 && mutes === 0) return 5
  const size = myFollowSetSize > 0 ? myFollowSetSize : 1
  const followRate = follows / size
  const muteRate = mutes / size
  const cappedFollowRate = Math.min(followRate, FOLLOW_RATE_CAP)
  const smoothedRatio =
    (muteRate + PRIOR_RATE * TRUST_PRIOR_MUTE_RATE) / (cappedFollowRate + PRIOR_RATE)
  const raw = Math.exp(-_trustDecay * smoothedRatio)
  return Math.min(100, Math.max(0, Math.round(((raw - _minRaw) / (_maxRaw - _minRaw)) * 100)))
}

function addFollowerContribution(follower: string, followings: string[]) {
  followings.forEach((following) => {
    if (following === follower) return // self-follow: skip
    const followers = wotFollowersByTarget.get(following)
    if (followers) {
      if (followers.has(follower)) return // already counted
      followers.add(follower)
    } else {
      wotFollowersByTarget.set(following, new Set([follower]))
    }
    wotScoreMap.set(following, (wotScoreMap.get(following) ?? 0) + 1)
  })
}

function removeFollowerContribution(follower: string) {
  wotFollowersByTarget.forEach((followers, target) => {
    if (!followers.has(follower)) return
    followers.delete(follower)
    if (followers.size === 0) wotFollowersByTarget.delete(target)
    wotScoreMap.set(target, Math.max(0, (wotScoreMap.get(target) ?? 0) - 1))
  })
}

function addMuterContribution(muter: string, targets: string[]) {
  targets.forEach((target) => {
    if (target === muter) return // self-mute: skip
    const muters = wotMutersByTarget.get(target)
    if (muters) {
      if (muters.has(muter)) return // already counted
      muters.add(muter)
    } else {
      wotMutersByTarget.set(target, new Set([muter]))
    }
    wotMuteMap.set(target, (wotMuteMap.get(target) ?? 0) + 1)
  })
}

function removeMuterContribution(muter: string) {
  wotMutersByTarget.forEach((muters, target) => {
    if (!muters.has(muter)) return
    muters.delete(muter)
    if (muters.size === 0) wotMutersByTarget.delete(target)
    wotMuteMap.set(target, Math.max(0, (wotMuteMap.get(target) ?? 0) - 1))
  })
}

// For a given signaler, subtract their follow contributions where they also mute (only mute counts).
function reconcileFollowMuteOverlap(signaler: string) {
  wotMutersByTarget.forEach((muters, target) => {
    if (!muters.has(signaler)) return
    if (!wotFollowersByTarget.get(target)?.has(signaler)) return
    wotScoreMap.set(target, Math.max(0, (wotScoreMap.get(target) ?? 0) - 1))
  })
}


export function UserTrustProvider({ children }: { children: React.ReactNode }) {
  const { pubkey: currentPubkey } = useNostr()
  const { followingSet } = useFollowList()


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
  // Incremented after each incremental WoT update so consumers re-read the maps.
  const [wotVersion, setWotVersion] = useState(0)

  // Snapshot used to diff against on next change. null = WoT not ready yet.
  const prevFollowingSetRef = useRef<Set<string> | null>(null)
  const prevWotReadyRef = useRef(false)
  const initInProgressRef = useRef(false)

  // Readable ref so the follow effect can see the latest value without re-subscribing.
  const followingSetRef = useRef(followingSet)
  followingSetRef.current = followingSet

  // Full rebuild when the account changes.
  useEffect(() => {
    if (!currentPubkey) return

    setWotReady(false)
    prevFollowingSetRef.current = null
    prevWotReadyRef.current = false
    initInProgressRef.current = true
    resetWotState()

    let cancelled = false

    const initWoT = async () => {
      const followings = [...new Set(await client.fetchFollowings(currentPubkey, false))]
      if (cancelled) return

      myFollowSetSize = followings.length
      followings.forEach((pubkey) => {
        if (!wotScoreMap.has(pubkey)) wotScoreMap.set(pubkey, 0)
      })

      const batchSize = 20

      // Phase 1: build WoT follow set
      for (let i = 0; i < followings.length; i += batchSize) {
        if (cancelled) return
        const batch = followings.slice(i, i + batchSize)
        await Promise.allSettled(
          batch.map(async (pubkey) => {
            const uniqueFollowings = [...new Set(await client.fetchFollowings(pubkey, false))]
            if (!cancelled) addFollowerContribution(pubkey, uniqueFollowings)
          })
        )
        await new Promise((resolve) => setTimeout(resolve, 200))
      }

      // Phase 2: load mute sets
      for (let i = 0; i < followings.length; i += batchSize) {
        if (cancelled) return
        const batch = followings.slice(i, i + batchSize)
        await Promise.allSettled(
          batch.map(async (pubkey) => {
            const muteListEvent = await client.fetchMuteListEvent(pubkey)
            if (cancelled || !muteListEvent) return
            const mutedPubkeys = [
              ...new Set(
                muteListEvent.tags
                  .filter((tag) => tag[0] === 'p' && tag[1])
                  .map((tag) => tag[1])
              )
            ]
            addMuterContribution(pubkey, mutedPubkeys)
          })
        )
        await new Promise((resolve) => setTimeout(resolve, 200))
      }

      if (cancelled) return

      // If someone both follows and mutes a target, only the mute counts.
      wotMutersByTarget.forEach((muters, target) => {
        const followers = wotFollowersByTarget.get(target)
        if (!followers) return
        const followerSet = new Set(followers)
        muters.forEach((muter) => {
          if (followerSet.has(muter)) {
            wotScoreMap.set(target, Math.max(0, (wotScoreMap.get(target) ?? 0) - 1))
          }
        })
      })

      initInProgressRef.current = false
      setWotReady(true)
    }
    initWoT()

    return () => {
      cancelled = true
      initInProgressRef.current = false
    }
  }, [currentPubkey])

  // Snapshot the follow set baseline once when WoT finishes loading.
  useEffect(() => {
    if (!wotReady) {
      prevFollowingSetRef.current = null
      prevWotReadyRef.current = false
      return
    }

    if (!prevWotReadyRef.current) {
      prevFollowingSetRef.current = new Set(followingSetRef.current)
      myFollowSetSize = followingSetRef.current.size
      setWotVersion((v) => v + 1)
    }
    prevWotReadyRef.current = true
  }, [wotReady])

  // Incremental update when the current user follows or unfollows someone.
  useEffect(() => {
    const prev = prevFollowingSetRef.current
    if (prev === null || initInProgressRef.current) return // WoT not ready or rebuilding

    const added = [...followingSet].filter((pk) => !prev.has(pk))
    const removed = [...prev].filter((pk) => !followingSet.has(pk))
    if (added.length === 0 && removed.length === 0) return

    prevFollowingSetRef.current = new Set(followingSet)
    myFollowSetSize = followingSet.size

    // Synchronously remove contributions from unfollowed people.
    removed.forEach((removedPubkey) => {
      removeFollowerContribution(removedPubkey)
      removeMuterContribution(removedPubkey)
    })

    if (removed.length > 0) setWotVersion((v) => v + 1)

    // Asynchronously add contributions from newly followed people.
    if (added.length > 0) {
      ;(async () => {
        for (const newPubkey of added) {
          const uniqueFollowings = [...new Set(await client.fetchFollowings(newPubkey, false))]
          addFollowerContribution(newPubkey, uniqueFollowings)

          const muteListEvent = await client.fetchMuteListEvent(newPubkey)
          if (muteListEvent) {
            const mutedPubkeys = [
              ...new Set(
                muteListEvent.tags
                  .filter((tag) => tag[0] === 'p' && tag[1])
                  .map((tag) => tag[1])
              )
            ]
            addMuterContribution(newPubkey, mutedPubkeys)
          }

          // Reconcile: if newPubkey both follows and mutes a target, only the mute counts.
          reconcileFollowMuteOverlap(newPubkey)
        }
        setWotVersion((v) => v + 1)
      })()
    }
  }, [followingSet])

  const isUserTrusted = useCallback(
    (pubkey: string) => {
      if (!currentPubkey || pubkey === currentPubkey) return true
      return (wotScoreMap.get(pubkey) ?? 0) > 0
    },
    [currentPubkey, wotVersion]
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

  // New function reference on every WoT update so consumers' useMemos re-run.
  const computeTrustScoreCallback = useCallback(
    (pubkey: string) => computeTrustScore(pubkey),
    [wotVersion]
  )

  const getWotStats = useCallback(
    (pubkey: string): TWotStats => {
      const allFollowers = wotFollowersByTarget.get(pubkey) ?? new Set<string>()
      const muters = wotMutersByTarget.get(pubkey) ?? new Set<string>()
      return {
        follows: wotScoreMap.get(pubkey) ?? 0,
        mutes: wotMuteMap.get(pubkey) ?? 0,
        myFollowSetSize,
        sampleFollowers: [...allFollowers].filter((f) => !muters.has(f)),
        sampleMuters: [...muters]
      }
    },
    [wotReady, wotVersion]
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
