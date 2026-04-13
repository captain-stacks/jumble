import { createMuteListDraftEvent } from '@/lib/draft-event'
import { formatError } from '@/lib/error'
import { getPubkeysFromPTags } from '@/lib/tag'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import bootstrapCache from '@/services/bootstrap-cache.service'
import dayjs from 'dayjs'
import { Event } from 'nostr-tools'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { useNostr } from './NostrProvider'
import { useUserTrustReady } from './UserTrustProvider'

type TMuteListContext = {
  mutePubkeySet: Set<string>
  changing: boolean
  getMutePubkeys: () => string[]
  getMuteType: (pubkey: string) => 'public' | 'private' | null
  mutePubkeyPublicly: (pubkey: string) => Promise<void>
  mutePubkeyPrivately: (pubkey: string) => Promise<void>
  unmutePubkey: (pubkey: string) => Promise<void>
  switchToPublicMute: (pubkey: string) => Promise<void>
  switchToPrivateMute: (pubkey: string) => Promise<void>
  makeAllPrivate: () => Promise<void>
}

const MuteListContext = createContext<TMuteListContext | undefined>(undefined)

export const useMuteList = () => {
  const context = useContext(MuteListContext)
  if (!context) {
    throw new Error('useMuteList must be used within a MuteListProvider')
  }
  return context
}

export function MuteListProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const {
    pubkey: accountPubkey,
    muteListEvent,
    publish,
    updateMuteListEvent,
    nip44Decrypt,
    nip44Encrypt
  } = useNostr()
  const isWotReady = useUserTrustReady()
  const [tags, setTags] = useState<string[][]>([])
  const [privateTags, setPrivateTags] = useState<string[][]>([])
  const publicMutePubkeySet = useMemo(() => new Set(getPubkeysFromPTags(tags)), [tags])
  const privateMutePubkeySet = useMemo(
    () => new Set(getPubkeysFromPTags(privateTags)),
    [privateTags]
  )
  const mutePubkeySet = useMemo(() => {
    return new Set([...Array.from(privateMutePubkeySet), ...Array.from(publicMutePubkeySet)])
  }, [publicMutePubkeySet, privateMutePubkeySet])
  const [changing, setChanging] = useState(false)
  // Refs hold the latest pending state so concurrent mute calls immediately see each other's changes
  const pendingTagsRef = useRef<string[][]>([])
  const pendingPrivateTagsRef = useRef<string[][]>([])
  const lastPublishedAtRef = useRef<number>(0)
  const inflightRef = useRef<number>(0)

  const incrementChanging = useCallback(() => {
    inflightRef.current++
    setChanging(true)
  }, [])

  const decrementChanging = useCallback(() => {
    inflightRef.current = Math.max(0, inflightRef.current - 1)
    if (inflightRef.current === 0) setChanging(false)
  }, [])

  const getPrivateTags = useCallback(
    async (muteListEvent: Event) => {
      if (!muteListEvent.content) return []

      try {
        const storedPlainText = await indexedDb.getDecryptedContent(muteListEvent.id)

        let plainText: string
        if (storedPlainText) {
          plainText = storedPlainText
        } else {
          plainText = await nip44Decrypt(muteListEvent.pubkey, muteListEvent.content)
          await indexedDb.putDecryptedContent(muteListEvent.id, plainText)
        }

        const privateTags = z.array(z.array(z.string())).parse(JSON.parse(plainText))
        return privateTags
      } catch (error) {
        console.error('Failed to decrypt mute list content', error)
        return []
      }
    },
    [nip44Decrypt]
  )

  useEffect(() => {
    const updateMuteTags = async () => {
      // Logged-in users should NEVER use bootstrap cache
      if (accountPubkey) {
        bootstrapCache.clear()

        if (muteListEvent) {
          // Logged-in user: use their mute list event
          const resolvedPrivateTags = await getPrivateTags(muteListEvent).catch(() => {
            return []
          })
          setPrivateTags(resolvedPrivateTags)
          setTags(muteListEvent.tags)
          // Sync refs with ground truth from relay (overwrites any pending state)
          pendingTagsRef.current = muteListEvent.tags
          pendingPrivateTagsRef.current = resolvedPrivateTags
        } else {
          setTags([])
          setPrivateTags([])
          pendingTagsRef.current = []
          pendingPrivateTagsRef.current = []
        }
        return
      }

      // Non-logged-in users only: check bootstrap cache
      const cachedMuteList = bootstrapCache.getMuteList()
      if (cachedMuteList && cachedMuteList.length > 0) {
        // Convert cached pubkeys to public mute tags
        const muteTags = cachedMuteList.map((pk) => ['p', pk])
        setTags(muteTags)
        pendingTagsRef.current = muteTags
        setPrivateTags([])
        pendingPrivateTagsRef.current = []
      } else {
        setTags([])
        setPrivateTags([])
        pendingTagsRef.current = []
        pendingPrivateTagsRef.current = []
      }
    }
    updateMuteTags()
  }, [muteListEvent, accountPubkey, getPrivateTags, isWotReady])

  const getMutePubkeys = () => {
    return Array.from(mutePubkeySet)
  }

  const getMuteType = useCallback(
    (pubkey: string): 'public' | 'private' | null => {
      if (publicMutePubkeySet.has(pubkey)) return 'public'
      if (privateMutePubkeySet.has(pubkey)) return 'private'
      return null
    },
    [publicMutePubkeySet, privateMutePubkeySet]
  )

  const publishNewMuteListEvent = async (tags: string[][], content?: string) => {
    const now = dayjs().unix()
    const createdAt = Math.max(now, lastPublishedAtRef.current + 1)
    lastPublishedAtRef.current = createdAt
    const newMuteListDraftEvent = { ...createMuteListDraftEvent(tags, content), created_at: createdAt }
    const event = await publish(newMuteListDraftEvent)
    return event
  }

  const checkMuteListEvent = (muteListEvent: Event | null) => {
    if (!muteListEvent) {
      const result = confirm(t('MuteListNotFoundConfirmation'))

      if (!result) {
        throw new Error('Mute list not found')
      }
    }
  }

  const mutePubkeyPublicly = async (pubkey: string) => {
    if (!accountPubkey) return

    // Check pending state (not relay state) to avoid double-mute
    const currentTags = pendingTagsRef.current
    const currentPrivateTags = pendingPrivateTagsRef.current
    if (
      currentTags.some(([n, v]) => n === 'p' && v === pubkey) ||
      currentPrivateTags.some(([n, v]) => n === 'p' && v === pubkey)
    ) {
      return
    }

    // Update pending refs and local state synchronously so concurrent calls see this immediately
    const newTags = currentTags.concat([['p', pubkey]])
    pendingTagsRef.current = newTags
    setTags(newTags)

    incrementChanging()
    // Re-encrypt private tags in every publish to ensure private content is never clobbered
    // by a higher-timestamped public-mute event that carries stale (or empty) encrypted content.
    ;(async () => {
      try {
        const muteListEvent = await client.fetchMuteListEvent(accountPubkey)
        checkMuteListEvent(muteListEvent)
        let cipherText = muteListEvent?.content
        if (currentPrivateTags.length > 0) {
          cipherText = await nip44Encrypt(accountPubkey, JSON.stringify(currentPrivateTags))
        }
        const newMuteListEvent = await publishNewMuteListEvent(newTags, cipherText)
        await updateMuteListEvent(newMuteListEvent, currentPrivateTags)
      } catch (error) {
        const errors = formatError(error)
        errors.forEach((err) => {
          toast.error(t('Failed to mute user publicly') + ': ' + err, { duration: 10_000 })
        })
      } finally {
        decrementChanging()
      }
    })()
  }

  const mutePubkeyPrivately = async (pubkey: string) => {
    if (!accountPubkey) return

    // Check pending state to avoid double-mute
    const currentTags = pendingTagsRef.current
    const currentPrivateTags = pendingPrivateTagsRef.current
    if (
      currentPrivateTags.some(([n, v]) => n === 'p' && v === pubkey) ||
      currentTags.some(([n, v]) => n === 'p' && v === pubkey)
    ) {
      return
    }

    // Update pending refs and local state synchronously
    const newPrivateTags = currentPrivateTags.concat([['p', pubkey]])
    pendingPrivateTagsRef.current = newPrivateTags
    setPrivateTags(newPrivateTags)

    incrementChanging()
    ;(async () => {
      try {
        const muteListEvent = await client.fetchMuteListEvent(accountPubkey)
        checkMuteListEvent(muteListEvent)
        const cipherText = await nip44Encrypt(accountPubkey, JSON.stringify(newPrivateTags))
        const newMuteListEvent = await publishNewMuteListEvent(currentTags, cipherText)
        await updateMuteListEvent(newMuteListEvent, newPrivateTags)
      } catch (error) {
        const errors = formatError(error)
        errors.forEach((err) => {
          toast.error(t('Failed to mute user privately') + ': ' + err, { duration: 10_000 })
        })
      } finally {
        decrementChanging()
      }
    })()
  }

  const unmutePubkey = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    incrementChanging()
    try {
      const muteListEvent = await client.fetchMuteListEvent(accountPubkey)
      if (!muteListEvent) return

      const privateTags = await getPrivateTags(muteListEvent)
      const newPrivateTags = privateTags.filter((tag) => tag[0] !== 'p' || tag[1] !== pubkey)
      let cipherText = muteListEvent.content
      if (newPrivateTags.length !== privateTags.length) {
        cipherText = await nip44Encrypt(accountPubkey, JSON.stringify(newPrivateTags))
      }

      const newMuteListEvent = await publishNewMuteListEvent(
        muteListEvent.tags.filter((tag) => tag[0] !== 'p' || tag[1] !== pubkey),
        cipherText
      )
      await updateMuteListEvent(newMuteListEvent, newPrivateTags)
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(t('Failed to unmute user') + ': ' + err, { duration: 10_000 })
      })
    } finally {
      decrementChanging()
    }
  }

  const switchToPublicMute = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    incrementChanging()
    try {
      const muteListEvent = await client.fetchMuteListEvent(accountPubkey)
      if (!muteListEvent) return

      const privateTags = await getPrivateTags(muteListEvent)
      const newPrivateTags = privateTags.filter((tag) => tag[0] !== 'p' || tag[1] !== pubkey)
      if (newPrivateTags.length === privateTags.length) {
        return
      }

      const cipherText = await nip44Encrypt(accountPubkey, JSON.stringify(newPrivateTags))
      const newMuteListEvent = await publishNewMuteListEvent(
        muteListEvent.tags
          .filter((tag) => tag[0] !== 'p' || tag[1] !== pubkey)
          .concat([['p', pubkey]]),
        cipherText
      )
      await updateMuteListEvent(newMuteListEvent, newPrivateTags)
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(t('Failed to switch to public mute') + ': ' + err, { duration: 10_000 })
      })
    } finally {
      decrementChanging()
    }
  }

  const switchToPrivateMute = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    incrementChanging()
    try {
      const muteListEvent = await client.fetchMuteListEvent(accountPubkey)
      if (!muteListEvent) return

      const newTags = muteListEvent.tags.filter((tag) => tag[0] !== 'p' || tag[1] !== pubkey)
      if (newTags.length === muteListEvent.tags.length) {
        return
      }

      const privateTags = await getPrivateTags(muteListEvent)
      const newPrivateTags = privateTags
        .filter((tag) => tag[0] !== 'p' || tag[1] !== pubkey)
        .concat([['p', pubkey]])
      const cipherText = await nip44Encrypt(accountPubkey, JSON.stringify(newPrivateTags))
      const newMuteListEvent = await publishNewMuteListEvent(newTags, cipherText)
      await updateMuteListEvent(newMuteListEvent, newPrivateTags)
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(t('Failed to switch to private mute') + ': ' + err, { duration: 10_000 })
      })
    } finally {
      decrementChanging()
    }
  }

  const makeAllPrivate = async () => {
    if (!accountPubkey || changing) return

    incrementChanging()
    try {
      const muteListEvent = await client.fetchMuteListEvent(accountPubkey)
      if (!muteListEvent) return

      const publicPubkeys = getPubkeysFromPTags(muteListEvent.tags)
      if (publicPubkeys.length === 0) return

      const existingPrivateTags = await getPrivateTags(muteListEvent)
      const existingPrivatePubkeys = new Set(getPubkeysFromPTags(existingPrivateTags))

      const newPublicTags = muteListEvent.tags.filter((tag) => tag[0] !== 'p')
      const mergedPrivateTags = [
        ...existingPrivateTags,
        ...publicPubkeys
          .filter((pk) => !existingPrivatePubkeys.has(pk))
          .map((pk) => ['p', pk])
      ]
      const cipherText = await nip44Encrypt(accountPubkey, JSON.stringify(mergedPrivateTags))
      const newMuteListEvent = await publishNewMuteListEvent(newPublicTags, cipherText)
      await updateMuteListEvent(newMuteListEvent, mergedPrivateTags)
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(t('Failed to make all mutes private') + ': ' + err, { duration: 10_000 })
      })
    } finally {
      decrementChanging()
    }
  }

  return (
    <MuteListContext.Provider
      value={{
        mutePubkeySet,
        changing,
        getMutePubkeys,
        getMuteType,
        mutePubkeyPublicly,
        mutePubkeyPrivately,
        unmutePubkey,
        switchToPublicMute,
        switchToPrivateMute,
        makeAllPrivate
      }}
    >
      {children}
    </MuteListContext.Provider>
  )
}
