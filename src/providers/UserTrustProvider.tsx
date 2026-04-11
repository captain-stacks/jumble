import { SPECIAL_TRUST_SCORE_FILTER_ID } from '@/constants'
import client from '@/services/client.service'
import fayan from '@/services/fayan.service'
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

type TUserTrustContext = {
  minTrustScore: number
  minTrustScoreMap: Record<string, number>
  getMinTrustScore: (id: string) => number
  updateMinTrustScore: (id: string, score: number) => void
  isUserTrusted: (pubkey: string) => boolean
  isSpammer: (pubkey: string) => Promise<boolean>
  meetsMinTrustScore: (pubkey: string, minScore: number) => Promise<boolean>
  isWotReady: boolean
  wotStep: number
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

export function UserTrustProvider({ children }: { children: React.ReactNode }) {
  const { pubkey: currentPubkey, isInitialized } = useNostr()
  const { followingSet } = useFollowList()
  const [minTrustScore, setMinTrustScore] = useState(() => storage.getMinTrustScore())
  const [minTrustScoreMap, setMinTrustScoreMap] = useState<Record<string, number>>(() =>
    storage.getMinTrustScoreMap()
  )
  const [isWotReady, setIsWotReady] = useState(false)
  const [wotStep, setWotStep] = useState(0)

  useEffect(() => {
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
        
        // Step 3: Fetch follows of follows in batches from standard relays
        setWotStep(3)
        const relays = getDefaultRelayUrls()
        try {
          const pool = new SimplePool()
          for (let i = 0; i < directFollows.length; i += BATCH_SIZE) {
            const batch = directFollows.slice(i, i + BATCH_SIZE)
            const results = await Promise.all(
              batch.map((pubkey) => {
                const filter = {
                  authors: [pubkey],
                  kinds: [kinds.Contacts],
                  limit: 1
                }
                return pool.get(relays, filter)
              })
            )
            results.forEach((event) => {
              if (event) {
                getPubkeysFromPTags(event.tags).forEach((pubkey) => wotSet.add(pubkey))
              }
            })

            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS))
          }
        } catch {
          // Silently handle errors
        }
        
        // Step 4: Done
        setWotStep(4)
        setIsWotReady(true)
        return
      }

      // For non-logged-in users: bootstrap from FOLLOW_SOURCE_PUBKEY
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
      if (isUserTrusted(pubkey)) return false
      const percentile = await fayan.fetchUserPercentile(pubkey)
      if (percentile === null) return false
      return percentile < 60
    },
    [isUserTrusted]
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

  const meetsMinTrustScore = useCallback(
    async (pubkey: string, minScore: number) => {
      if (minScore === 0) return true
      if (pubkey === currentPubkey) return true

      // WoT users always have 100% trust score
      if (wotSet.has(pubkey)) return true

      // Get percentile from reputation system
      const percentile = await fayan.fetchUserPercentile(pubkey)
      if (percentile === null) return false
      return percentile >= minScore
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
        isWotReady,
        wotStep
      }}
    >
      {children}
    </UserTrustContext.Provider>
  )
}
