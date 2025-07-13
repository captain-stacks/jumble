import client from '@/services/client.service'
import storage from '@/services/local-storage.service'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useNostr } from './NostrProvider'
import { useMuteList } from './MuteListProvider'

type TUserTrustContext = {
  hideUntrustedInteractions: boolean
  hideUntrustedNotifications: boolean
  hideUntrustedNotes: boolean
  updateHideUntrustedInteractions: (hide: boolean) => void
  updateHideUntrustedNotifications: (hide: boolean) => void
  updateHideUntrustedNotes: (hide: boolean) => void
  isUserTrusted: (pubkey: string) => boolean
  userTrustScore: (pubkey: string) => number
  isUserFollowed: (pubkey: string) => boolean
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
const wotMap = new Map<string, Set<string>>() // Change value to Set<string>
const followSet = new Set<string>()

export function UserTrustProvider({ children }: { children: React.ReactNode }) {
  const { pubkey: currentPubkey } = useNostr()
  const { mutePubkeys } = useMuteList()
  const mutePubkeysRef = useRef<string[]>(mutePubkeys)
  useEffect(() => {
    mutePubkeysRef.current = mutePubkeys
  }, [mutePubkeys])
  const [hideUntrustedInteractions, setHideUntrustedInteractions] = useState(() =>
    storage.getHideUntrustedInteractions()
  )
  const [hideUntrustedNotifications, setHideUntrustedNotifications] = useState(() =>
    storage.getHideUntrustedNotifications()
  )
  const [hideUntrustedNotes, setHideUntrustedNotes] = useState(() =>
    storage.getHideUntrustedNotes()
  )

  useEffect(() => {
    if (!currentPubkey) return

    const initWoT = async () => {
      wotMap.clear()
      const followings = await client.fetchFollowings(currentPubkey)
      await Promise.allSettled(
        followings.map(async (pubkey) => {
          wotSet.add(pubkey)
          followSet.add(pubkey)
          const _followings = await client.fetchFollowings(pubkey)
          _followings.forEach((following) => {
            wotSet.add(following)
            if (!wotMap.has(following)) {
              wotMap.set(following, new Set<string>())
            }
            wotMap.get(following)!.add(pubkey)
          })
        })
      )
    }
    initWoT()
  }, [currentPubkey])

  const isUserTrusted = useCallback(
    (pubkey: string) => {
      if (!currentPubkey) return true
      return wotSet.has(pubkey) && !mutePubkeysRef.current.includes(pubkey)
    },
    [currentPubkey, mutePubkeys]
  )

  const userTrustScore = useCallback(
    (pubkey: string) => {
      if (!currentPubkey) return 0
      return wotMap.get(pubkey)?.size || 0
    },
    [currentPubkey]
  )

  const isUserFollowed = useCallback(
    (pubkey: string) => {
      if (!currentPubkey) return false
      return followSet.has(pubkey)
    },
    [currentPubkey]
  )

  const updateHideUntrustedInteractions = (hide: boolean) => {
    setHideUntrustedInteractions(hide)
    storage.setHideUntrustedInteractions(hide)
  }

  const updateHideUntrustedNotifications = (hide: boolean) => {
    setHideUntrustedNotifications(hide)
    storage.setHideUntrustedNotifications(hide)
  }

  const updateHideUntrustedNotes = (hide: boolean) => {
    setHideUntrustedNotes(hide)
    if (storage.setHideUntrustedNotes) {
      storage.setHideUntrustedNotes(hide)
    }
  }

  return (
    <UserTrustContext.Provider
      value={{
        hideUntrustedInteractions,
        hideUntrustedNotifications,
        hideUntrustedNotes,
        updateHideUntrustedInteractions,
        updateHideUntrustedNotifications,
        updateHideUntrustedNotes,
        isUserTrusted,
        userTrustScore,
        isUserFollowed
      }}
    >
      {children}
    </UserTrustContext.Provider>
  )
}
