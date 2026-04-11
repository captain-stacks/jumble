import { createMuteListDraftEvent } from '@/lib/draft-event'
import { formatError } from '@/lib/error'
import { getPubkeysFromPTags } from '@/lib/tag'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import bootstrapCache from '@/services/bootstrap-cache.service'
import dayjs from 'dayjs'
import { Event } from 'nostr-tools'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
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
          const privateTags = await getPrivateTags(muteListEvent).catch(() => {
            return []
          })
          setPrivateTags(privateTags)
          setTags(muteListEvent.tags)
        } else {
          setTags([])
          setPrivateTags([])
        }
        return
      }

      // Non-logged-in users only: check bootstrap cache
      const cachedMuteList = bootstrapCache.getMuteList()
      if (cachedMuteList && cachedMuteList.length > 0) {
        // Convert cached pubkeys to public mute tags
        const muteTags = cachedMuteList.map((pk) => ['p', pk])
        setTags(muteTags)
        setPrivateTags([])
      } else {
        setTags([])
        setPrivateTags([])
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
    if (dayjs().unix() === muteListEvent?.created_at) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    const newMuteListDraftEvent = createMuteListDraftEvent(tags, content)
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
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const muteListEvent = await client.fetchMuteListEvent(accountPubkey)
      checkMuteListEvent(muteListEvent)
      if (
        muteListEvent &&
        muteListEvent.tags.some(([tagName, tagValue]) => tagName === 'p' && tagValue === pubkey)
      ) {
        return
      }
      const newTags = (muteListEvent?.tags ?? []).concat([['p', pubkey]])
      // Update local state immediately
      setTags(newTags)
      setChanging(false)
      // Publish in background
      publishNewMuteListEvent(newTags, muteListEvent?.content).then(async (newMuteListEvent) => {
        const privateTags = await getPrivateTags(newMuteListEvent)
        await updateMuteListEvent(newMuteListEvent, privateTags)
      }).catch((error) => {
        const errors = formatError(error)
        errors.forEach((err) => {
          toast.error(t('Failed to mute user publicly') + ': ' + err, { duration: 10_000 })
        })
      })
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(t('Failed to mute user publicly') + ': ' + err, { duration: 10_000 })
      })
      setChanging(false)
    }
  }

  const mutePubkeyPrivately = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const muteListEvent = await client.fetchMuteListEvent(accountPubkey)
      checkMuteListEvent(muteListEvent)
      const existingPrivateTags = muteListEvent ? await getPrivateTags(muteListEvent) : []
      if (existingPrivateTags.some(([tagName, tagValue]) => tagName === 'p' && tagValue === pubkey)) {
        return
      }

      const newPrivateTags = existingPrivateTags.concat([['p', pubkey]])
      // Update local state immediately
      setPrivateTags(newPrivateTags)
      setChanging(false)
      // Publish in background
      nip44Encrypt(accountPubkey, JSON.stringify(newPrivateTags)).then(async (cipherText) => {
        const newMuteListEvent = await publishNewMuteListEvent(muteListEvent?.tags ?? [], cipherText)
        await updateMuteListEvent(newMuteListEvent, newPrivateTags)
      }).catch((error) => {
        const errors = formatError(error)
        errors.forEach((err) => {
          toast.error(t('Failed to mute user privately') + ': ' + err, { duration: 10_000 })
        })
      })
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(t('Failed to mute user privately') + ': ' + err, { duration: 10_000 })
      })
      setChanging(false)
    }
  }

  const unmutePubkey = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
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
      setChanging(false)
    }
  }

  const switchToPublicMute = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
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
      setChanging(false)
    }
  }

  const switchToPrivateMute = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
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
      setChanging(false)
    }
  }

  const makeAllPrivate = async () => {
    if (!accountPubkey || changing) return

    setChanging(true)
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
      setChanging(false)
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
