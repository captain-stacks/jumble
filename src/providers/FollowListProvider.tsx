import { createFollowListDraftEvent } from '@/lib/draft-event'
import { getPubkeysFromPTags } from '@/lib/tag'
import client from '@/services/client.service'
import { createContext, useContext, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNostr } from './NostrProvider'
import { formatError } from '@/lib/error'
import { toast } from 'sonner'

type TFollowListContext = {
  followingSet: Set<string>
  follow: (pubkey: string) => Promise<void>
  unfollow: (pubkey: string) => Promise<void>
  followAll: (pubkeys: string[]) => Promise<void>
}

const FollowListContext = createContext<TFollowListContext | undefined>(undefined)

export const useFollowList = () => {
  const context = useContext(FollowListContext)
  if (!context) {
    throw new Error('useFollowList must be used within a FollowListProvider')
  }
  return context
}

export function FollowListProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const { pubkey: accountPubkey, followListEvent, publish, updateFollowListEvent } = useNostr()
  const followingSet = useMemo(
    () => new Set(followListEvent ? getPubkeysFromPTags(followListEvent.tags) : []),
    [followListEvent]
  )

  const follow = async (pubkey: string) => {
    if (!accountPubkey) return

    const followListEvent = await client.fetchFollowListEvent(accountPubkey)
    if (!followListEvent) {
      const result = confirm(t('FollowListNotFoundConfirmation'))

      if (!result) {
        return
      }
    }
    const newFollowListDraftEvent = createFollowListDraftEvent(
      (followListEvent?.tags ?? []).concat([['p', pubkey]]),
      followListEvent?.content
    )
    try {
      const newFollowListEvent = await publish(newFollowListDraftEvent)
      await updateFollowListEvent(newFollowListEvent)
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(`Failed to follow: ${err}`, { duration: 10_000 })
      })
    }
  }

  const followAll = async (pubkeys: string[]) => {
    if (!accountPubkey || pubkeys.length === 0) return

    const followListEvent = await client.fetchFollowListEvent(accountPubkey)
    if (!followListEvent) {
      const result = confirm(t('FollowListNotFoundConfirmation'))
      if (!result) return
    }

    const existingPubkeys = new Set(getPubkeysFromPTags(followListEvent?.tags ?? []))
    const newPubkeys = pubkeys.filter((pk) => !existingPubkeys.has(pk))
    if (newPubkeys.length === 0) return

    const newTags = (followListEvent?.tags ?? []).concat(newPubkeys.map((pk) => ['p', pk]))
    const newFollowListDraftEvent = createFollowListDraftEvent(newTags, followListEvent?.content)
    try {
      const newFollowListEvent = await publish(newFollowListDraftEvent)
      await updateFollowListEvent(newFollowListEvent)
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(`Failed to follow all: ${err}`, { duration: 10_000 })
      })
    }
  }

  const unfollow = async (pubkey: string) => {
    if (!accountPubkey) return

    const followListEvent = await client.fetchFollowListEvent(accountPubkey)
    if (!followListEvent) return

    const newFollowListDraftEvent = createFollowListDraftEvent(
      followListEvent.tags.filter(([tagName, tagValue]) => tagName !== 'p' || tagValue !== pubkey),
      followListEvent.content
    )
    try {
      const newFollowListEvent = await publish(newFollowListDraftEvent)
      await updateFollowListEvent(newFollowListEvent)
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(`Failed to unfollow: ${err}`, { duration: 10_000 })
      })
    }
  }

  return (
    <FollowListContext.Provider
      value={{
        followingSet,
        follow,
        unfollow,
        followAll
      }}
    >
      {children}
    </FollowListContext.Provider>
  )
}
