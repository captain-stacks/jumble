import { ExtendedKind } from '@/constants'
import { formatError } from '@/lib/error'
import { getPubkeysFromPTags } from '@/lib/tag'
import indexedDb from '@/services/indexed-db.service'
import { Event } from 'nostr-tools'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { useNostr } from './NostrProvider'

type TPinnedUsersContext = {
  pinnedPubkeySet: Set<string>
  isPinned: (pubkey: string) => boolean
  pinUser: (pubkey: string) => Promise<void>
  unpinUser: (pubkey: string) => Promise<void>
  togglePin: (pubkey: string) => Promise<void>
}

const PinnedUsersContext = createContext<TPinnedUsersContext | undefined>(undefined)

export const usePinnedUsers = () => {
  const context = useContext(PinnedUsersContext)
  if (!context) {
    throw new Error('usePinnedUsers must be used within a PinnedUsersProvider')
  }
  return context
}

function createPinnedUsersListDraftEvent(tags: string[][], content = '') {
  return {
    kind: ExtendedKind.PINNED_USERS,
    content,
    tags,
    created_at: Math.floor(Date.now() / 1000)
  }
}

export function PinnedUsersProvider({ children }: { children: React.ReactNode }) {
  const {
    pubkey: accountPubkey,
    pinnedUsersEvent,
    updatePinnedUsersEvent,
    publish,
    nip44Decrypt,
    nip44Encrypt
  } = useNostr()
  const [privateTags, setPrivateTags] = useState<string[][]>([])
  const pinnedPubkeySet = useMemo(() => {
    if (!pinnedUsersEvent) return new Set<string>()
    return new Set(getPubkeysFromPTags(pinnedUsersEvent.tags.concat(privateTags)))
  }, [pinnedUsersEvent, privateTags])

  useEffect(() => {
    const updatePrivateTags = async () => {
      if (!pinnedUsersEvent) {
        setPrivateTags([])
        return
      }

      const privateTags = await getPrivateTags(pinnedUsersEvent).catch(() => {
        return []
      })
      setPrivateTags(privateTags)
    }
    updatePrivateTags()
  }, [pinnedUsersEvent])

  const getPrivateTags = useCallback(
    async (event: Event) => {
      if (!event.content) return []

      try {
        const storedPlainText = await indexedDb.getDecryptedContent(event.id)

        let plainText: string
        if (storedPlainText) {
          plainText = storedPlainText
        } else {
          plainText = await nip44Decrypt(event.pubkey, event.content)
          await indexedDb.putDecryptedContent(event.id, plainText)
        }

        const privateTags = z.array(z.array(z.string())).parse(JSON.parse(plainText))
        return privateTags
      } catch (error) {
        console.error('Failed to decrypt pinned users content', error)
        return []
      }
    },
    [nip44Decrypt]
  )

  const isPinned = useCallback(
    (pubkey: string) => {
      return pinnedPubkeySet.has(pubkey)
    },
    [pinnedPubkeySet]
  )

  const pinUser = useCallback(
    async (pubkey: string) => {
      if (!accountPubkey || isPinned(pubkey)) return

      try {
        const newTags = [...(pinnedUsersEvent?.tags ?? []), ['p', pubkey]]
        const draftEvent = createPinnedUsersListDraftEvent(newTags, pinnedUsersEvent?.content ?? '')
        const newEvent = await publish(draftEvent)
        await updatePinnedUsersEvent(newEvent, privateTags)
      } catch (error) {
        const errors = formatError(error)
        errors.forEach((err) => {
          toast.error(`Failed to pin user: ${err}`, { duration: 10_000 })
        })
      }
    },
    [accountPubkey, isPinned, pinnedUsersEvent, publish, updatePinnedUsersEvent, privateTags]
  )

  const unpinUser = useCallback(
    async (pubkey: string) => {
      if (!accountPubkey || !pinnedUsersEvent || !isPinned(pubkey)) return

      try {
        const newTags = pinnedUsersEvent.tags.filter(
          ([tagName, tagValue]) => tagName !== 'p' || tagValue !== pubkey
        )
        const newPrivateTags = privateTags.filter(
          ([tagName, tagValue]) => tagName !== 'p' || tagValue !== pubkey
        )
        let newContent = pinnedUsersEvent.content
        if (newPrivateTags.length !== privateTags.length) {
          newContent = await nip44Encrypt(pinnedUsersEvent.pubkey, JSON.stringify(newPrivateTags))
        }
        const draftEvent = createPinnedUsersListDraftEvent(newTags, newContent)
        const newEvent = await publish(draftEvent)
        await updatePinnedUsersEvent(newEvent, newPrivateTags)
      } catch (error) {
        const errors = formatError(error)
        errors.forEach((err) => {
          toast.error(`Failed to unpin user: ${err}`, { duration: 10_000 })
        })
      }
    },
    [
      accountPubkey,
      isPinned,
      pinnedUsersEvent,
      publish,
      updatePinnedUsersEvent,
      privateTags,
      nip44Encrypt
    ]
  )

  const togglePin = useCallback(
    async (pubkey: string) => {
      if (isPinned(pubkey)) {
        await unpinUser(pubkey)
      } else {
        await pinUser(pubkey)
      }
    },
    [isPinned, pinUser, unpinUser]
  )

  return (
    <PinnedUsersContext.Provider
      value={{
        pinnedPubkeySet,
        isPinned,
        pinUser,
        unpinUser,
        togglePin
      }}
    >
      {children}
    </PinnedUsersContext.Provider>
  )
}
