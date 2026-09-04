import { SPECIAL_TRUST_SCORE_FILTER_ID, SPAMMER_PERCENTILE_THRESHOLD } from '@/constants'
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
  maxTrustScoreMap: Record<string, number>
  getMaxTrustScore: (id: string) => number
  updateMaxTrustScore: (id: string, score: number) => void
  showUnknownRepliesMap: Record<string, boolean>
  getShowUnknownReplies: (id: string) => boolean
  updateShowUnknownReplies: (id: string, bypass: boolean) => void
  isUserTrusted: (pubkey: string) => boolean
  isUnknownProfile: (pubkey: string) => boolean
  isSpammer: (pubkey: string) => Promise<boolean>
  meetsMinTrustScore: (pubkey: string, minScore: number) => Promise<boolean>
  pickRecommendedPubkeys: (count: number, excludeSet: Set<string>) => string[]
  computeTrustScore: (pubkey: string) => number
  trustDecay: number
  setTrustDecay: (decay: number) => void
  muteSlider: number
  setMuteSlider: (slider: number) => void
  minFollowsToCount: number
  setMinFollowsToCount: (n: number) => void
  countEligibleProfiles: (min: number, max: number, excludeSet?: Set<string>, muteSlider?: number, minFollows?: number) => number
  getEligiblePubkeys: (min: number, max: number, excludeSet?: Set<string>) => string[]
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
const wotMuteMap = new Map<string, number>()
const wotFollowersByTarget = new Map<string, Set<string>>()
const wotMutersByTarget = new Map<string, Set<string>>()
const myFollowingSet = new Set<string>()
let myFollowSetSize = 0

let _trustDecay = 7
let _muteWeight = 1
let _minFollowsToCount = 1
let _maxRaw = 0
let _minRaw = 0

function resetWotState() {
  wotMuteMap.clear()
  wotFollowersByTarget.clear()
  wotMutersByTarget.clear()
  myFollowingSet.clear()
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

const sliderToMuteWeight = (slider: number) => 0.1 * Math.pow(100 / 3, (slider - 1) / 9)

// Net WoT followers for a target: people who follow them minus those who also mute them
// (a mute always overrides a follow). Derived live from the Sets so it can never drift
// out of sync with the sampled follower lists shown in the UI.
function getFollowCount(pubkey: string): number {
  const followers = wotFollowersByTarget.get(pubkey)
  if (!followers || followers.size === 0) return 0
  const muters = wotMutersByTarget.get(pubkey)
  if (!muters || muters.size === 0) return followers.size
  let overlap = 0
  muters.forEach((muter) => {
    if (followers.has(muter)) overlap++
  })
  return followers.size - overlap
}

function computeTrustScore(pubkey: string, muteWeight: number, minFollows: number): number {
  const follows = getFollowCount(pubkey)
  const mutes = wotMuteMap.get(pubkey) ?? 0

  const effectiveFollows = follows >= minFollows ? follows : 0
  // Nobody in the network follows them (or not enough follows to count) → unknown stranger baseline
  if (effectiveFollows === 0 && mutes === 0) return 5
  const size = myFollowSetSize > 0 ? myFollowSetSize : 1
  const followRate = effectiveFollows / size
  const muteRate = mutes / size
  const cappedFollowRate = Math.min(followRate, FOLLOW_RATE_CAP)
  const smoothedRatio =
    (muteRate * muteWeight + PRIOR_RATE * TRUST_PRIOR_MUTE_RATE) / (cappedFollowRate + PRIOR_RATE)
  const raw = Math.exp(-_trustDecay * smoothedRatio)
  return Math.min(100, Math.max(0, Math.round(((raw - _minRaw) / (_maxRaw - _minRaw)) * 100)))
}

// True when nobody in the network follows or mutes this pubkey — i.e. computeTrustScore
// falls back to the unknown-stranger baseline rather than a real WoT-derived score.
function isUnknownContributor(pubkey: string, minFollows: number): boolean {
  const follows = getFollowCount(pubkey)
  const mutes = wotMuteMap.get(pubkey) ?? 0
  const effectiveFollows = follows >= minFollows ? follows : 0
  return effectiveFollows === 0 && mutes === 0
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
  })
}

function removeFollowerContribution(follower: string) {
  wotFollowersByTarget.forEach((followers, target) => {
    if (!followers.has(follower)) return
    followers.delete(follower)
    if (followers.size === 0) wotFollowersByTarget.delete(target)
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


export function UserTrustProvider({ children }: { children: React.ReactNode }) {
  const { pubkey: currentPubkey } = useNostr()
  const { followingSet } = useFollowList()


  const [minTrustScore, setMinTrustScore] = useState(() => storage.getMinTrustScore())
  const [minTrustScoreMap, setMinTrustScoreMap] = useState<Record<string, number>>(() =>
    storage.getMinTrustScoreMap()
  )
  const [maxTrustScoreMap, setMaxTrustScoreMap] = useState<Record<string, number>>(() =>
    storage.getMaxTrustScoreMap()
  )
  const [showUnknownRepliesMap, setShowUnknownRepliesMap] = useState<
    Record<string, boolean>
  >(() => storage.getShowUnknownRepliesMap())
  const [trustDecay, setTrustDecayState] = useState(() => {
    const stored = storage.getTrustDecay()
    recomputeDecayBounds(stored) // sync module-level bounds with stored value
    return stored
  })
  const [muteSlider, setMuteSliderState] = useState(() => {
    const stored = storage.getMuteWeight()
    _muteWeight = sliderToMuteWeight(stored)
    return stored
  })
  const [minFollowsToCount, setMinFollowsToCountState] = useState(() => {
    const stored = storage.getMinFollowsToCount()
    _minFollowsToCount = stored
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
    setWotReady(false)
    prevFollowingSetRef.current = null
    prevWotReadyRef.current = false
    initInProgressRef.current = false
    resetWotState()

    if (!currentPubkey) return

    initInProgressRef.current = true

    let cancelled = false

    const initWoT = async () => {
      try {
        const followings = [...new Set(await client.fetchFollowings(currentPubkey, false))]
        if (cancelled) return

        myFollowSetSize = followings.length
        followings.forEach((pubkey) => myFollowingSet.add(pubkey))

        const batchSize = 20
        const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | undefined> =>
          Promise.race([p, new Promise<undefined>((resolve) => setTimeout(resolve, ms))])

        // Phase 1: build WoT follow set
        for (let i = 0; i < followings.length; i += batchSize) {
          if (cancelled) return
          const batch = followings.slice(i, i + batchSize)
          await Promise.allSettled(
            batch.map(async (pubkey) => {
              const result = await withTimeout(client.fetchFollowings(pubkey, false), 3000)
              if (!cancelled) addFollowerContribution(pubkey, [...new Set(result ?? [])])
            })
          )
        }

        // Phase 2: load mute sets
        for (let i = 0; i < followings.length; i += batchSize) {
          if (cancelled) return
          const batch = followings.slice(i, i + batchSize)
          await Promise.allSettled(
            batch.map(async (pubkey) => {
              const muteListEvent = await withTimeout(client.fetchMuteListEvent(pubkey), 3000)
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
        }
      } finally {
        if (!cancelled) {
          initInProgressRef.current = false
          setWotReady(true)
        }
      }
    }
    // Safety valve: if the WoT build hangs (e.g. relays never respond), unblock
    // the feed after 60 seconds with whatever partial data was collected.
    const wotTimeoutId = setTimeout(() => {
      if (!cancelled) {
        initInProgressRef.current = false
        setWotReady(true)
      }
    }, 60_000)

    initWoT().catch(() => undefined).finally(() => clearTimeout(wotTimeoutId))

    return () => {
      cancelled = true
      initInProgressRef.current = false
      clearTimeout(wotTimeoutId)
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
      myFollowingSet.delete(removedPubkey)
      removeFollowerContribution(removedPubkey)
      removeMuterContribution(removedPubkey)
    })

    if (removed.length > 0) setWotVersion((v) => v + 1)

    // Asynchronously add contributions from newly followed people.
    if (added.length > 0) {
      ;(async () => {
        for (const newPubkey of added) {
          myFollowingSet.add(newPubkey)

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
        }
        setWotVersion((v) => v + 1)
      })()
    }
  }, [followingSet])

  const isUserTrusted = useCallback(
    (pubkey: string) => {
      if (!currentPubkey || pubkey === currentPubkey) return true
      return getFollowCount(pubkey) > 0
    },
    [currentPubkey, wotVersion]
  )

  const isUnknownProfile = useCallback(
    (pubkey: string) => {
      if (!currentPubkey || pubkey === currentPubkey) return false
      return isUnknownContributor(pubkey, _minFollowsToCount)
    },
    [currentPubkey, wotVersion]
  )

  const isSpammer = useCallback(
    async (pubkey: string) => {
      if (!wotReady) return false
      return computeTrustScore(pubkey, _muteWeight, _minFollowsToCount) < SPAMMER_PERCENTILE_THRESHOLD
    },
    [wotReady, wotVersion]
  )

  const pickRecommendedPubkeys = useCallback((count: number, excludeSet: Set<string>) => {
    const candidates: { pubkey: string; score: number }[] = []
    wotFollowersByTarget.forEach((_, pubkey) => {
      if (!excludeSet.has(pubkey)) {
        candidates.push({ pubkey, score: getFollowCount(pubkey) })
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

  const getMaxTrustScore = useCallback(
    (id: string) => {
      if (id in maxTrustScoreMap) return maxTrustScoreMap[id]
      return 100
    },
    [maxTrustScoreMap]
  )

  const updateMaxTrustScore = (id: string, score: number) => {
    if (score < 0 || score > 100) return
    const newMap = { ...maxTrustScoreMap, [id]: score }
    setMaxTrustScoreMap(newMap)
    storage.setMaxTrustScoreMap(newMap)
  }

  const getShowUnknownReplies = useCallback(
    (id: string) => showUnknownRepliesMap[id] ?? false,
    [showUnknownRepliesMap]
  )

  const updateShowUnknownReplies = (id: string, bypass: boolean) => {
    const newMap = { ...showUnknownRepliesMap, [id]: bypass }
    setShowUnknownRepliesMap(newMap)
    storage.setShowUnknownRepliesMap(newMap)
  }

  const meetsMinTrustScore = useCallback(
    async (pubkey: string, minScore: number) => {
      if (minScore === 0) return true
      if (pubkey === currentPubkey) return true
      if (!wotReady) return false
      return computeTrustScore(pubkey, _muteWeight, _minFollowsToCount) >= minScore
    },
    [currentPubkey, wotReady, wotVersion]
  )

  const setTrustDecay = useCallback((decay: number) => {
    if (decay < 1 || decay > 10) return
    recomputeDecayBounds(decay)
    storage.setTrustDecay(decay)
    setTrustDecayState(decay)
  }, [])

  const setMuteSlider = useCallback((slider: number) => {
    if (slider < 1 || slider > 10) return
    _muteWeight = sliderToMuteWeight(slider)
    storage.setMuteWeight(slider)
    setMuteSliderState(slider)
    setWotVersion((v) => v + 1)
  }, [])

  const countEligibleProfiles = useCallback(
    (min: number, max: number, excludeSet?: Set<string>, muteSlider?: number, minFollows?: number) => {
      const muteWeight = muteSlider !== undefined ? sliderToMuteWeight(muteSlider) : _muteWeight
      const resolvedMinFollows = minFollows ?? _minFollowsToCount
      const seen = new Set<string>()
      let count = 0
      const check = (pubkey: string) => {
        if (seen.has(pubkey)) return
        seen.add(pubkey)
        if (excludeSet?.has(pubkey)) return
        const score = computeTrustScore(pubkey, muteWeight, resolvedMinFollows)
        if (score >= min && score <= max) count++
      }
      wotFollowersByTarget.forEach((_, pubkey) => check(pubkey))
      wotMuteMap.forEach((_, pubkey) => check(pubkey))
      myFollowingSet.forEach((pubkey) => check(pubkey))
      return count
    },
    [wotVersion]
  )

  const getEligiblePubkeys = useCallback(
    (min: number, max: number, excludeSet?: Set<string>): string[] => {
      const seen = new Set<string>()
      const result: string[] = []
      const check = (pubkey: string) => {
        if (seen.has(pubkey)) return
        seen.add(pubkey)
        if (excludeSet?.has(pubkey)) return
        const score = computeTrustScore(pubkey, _muteWeight, _minFollowsToCount)
        if (score >= min && score <= max) result.push(pubkey)
      }
      wotFollowersByTarget.forEach((_, pubkey) => check(pubkey))
      wotMuteMap.forEach((_, pubkey) => check(pubkey))
      myFollowingSet.forEach((pubkey) => check(pubkey))
      return result
    },
    [wotVersion]
  )

  const setMinFollowsToCount = useCallback((n: number) => {
    if (n < 1 || n > 10) return
    _minFollowsToCount = n
    storage.setMinFollowsToCount(n)
    setMinFollowsToCountState(n)
    setWotVersion((v) => v + 1)
  }, [])

  // New function reference on every WoT update so consumers' useMemos re-run.
  const computeTrustScoreCallback = useCallback(
    (pubkey: string) => computeTrustScore(pubkey, _muteWeight, _minFollowsToCount),
    [wotVersion]
  )

  const getWotStats = useCallback(
    (pubkey: string): TWotStats => {
      const allFollowers = wotFollowersByTarget.get(pubkey) ?? new Set<string>()
      const muters = wotMutersByTarget.get(pubkey) ?? new Set<string>()
      return {
        follows: getFollowCount(pubkey),
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
        maxTrustScoreMap,
        getMaxTrustScore,
        updateMaxTrustScore,
        showUnknownRepliesMap,
        getShowUnknownReplies,
        updateShowUnknownReplies,
        isUserTrusted,
        isUnknownProfile,
        isSpammer,
        meetsMinTrustScore,
        pickRecommendedPubkeys,
        computeTrustScore: computeTrustScoreCallback,
        trustDecay,
        setTrustDecay,
        muteSlider,
        setMuteSlider,
        minFollowsToCount,
        setMinFollowsToCount,
        countEligibleProfiles,
        getEligiblePubkeys,
        wotReady,
        getWotStats
      }}
    >
      {children}
    </UserTrustContext.Provider>
  )
}
