import KindFilter from '@/components/KindFilter'
import NoteList, { TNoteListRef } from '@/components/NoteList'
import Tabs from '@/components/Tabs'
import { ExtendedKind, MAX_PINNED_NOTES, YOUTUBE_URL_REGEX } from '@/constants'
import { getDefaultRelayUrls, getSearchRelayUrls } from '@/lib/relay'
import { isImage } from '@/lib/url'
import { generateBech32IdFromETag } from '@/lib/tag'
import { isTouchDevice } from '@/lib/utils'
import { useKindFilter } from '@/providers/KindFilterProvider'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import storage from '@/services/local-storage.service'
import relayInfoService from '@/services/relay-info.service'
import { TFeedSubRequest, TNoteListMode } from '@/types'
import { NostrEvent } from 'nostr-tools'
import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshButton } from '../RefreshButton'

export default function ProfileFeed({
  pubkey,
  topSpace = 0,
  search = ''
}: {
  pubkey: string
  topSpace?: number
  search?: string
}) {
  const { pubkey: myPubkey, pinListEvent: myPinListEvent } = useNostr()
  const { mutePubkeySet } = useMuteList()
  const isMuted = mutePubkeySet.has(pubkey)
  const { showKinds } = useKindFilter()
  const [temporaryShowKinds, setTemporaryShowKinds] = useState(showKinds)
  const [listMode, setListMode] = useState<TNoteListMode>(() => {
    const mode = storage.getNoteListMode()
    if (mode === '24h') {
      return 'posts'
    }
    return mode
  })
  const [subRequests, setSubRequests] = useState<TFeedSubRequest[]>([])
  const [pinnedEventIds, setPinnedEventIds] = useState<string[]>([])
  const tabs = useMemo(() => {
    const _tabs = [
      { value: 'posts', label: 'Notes' },
      { value: 'postsAndReplies', label: 'Replies' },
      { value: 'images', label: 'Images' },
      { value: 'gallery', label: 'Gallery' },
      { value: 'lists', label: 'Lists' },
      { value: 'inLists', label: "In lists" },
      { value: 'youtube', label: 'YouTube' }
    ]

    if (myPubkey && myPubkey !== pubkey) {
      _tabs.push({ value: 'you', label: 'YouTabName' })
    }

    return _tabs
  }, [myPubkey, pubkey])
  const supportTouch = useMemo(() => isTouchDevice(), [])
  const noteListRef = useRef<TNoteListRef>(null)

  useEffect(() => {
    const initPinnedEventIds = async () => {
      let evt: NostrEvent | null = null
      if (pubkey === myPubkey) {
        evt = myPinListEvent
      } else {
        evt = await client.fetchPinListEvent(pubkey)
      }
      const hexIdSet = new Set<string>()
      const ids =
        (evt?.tags
          .filter((tag) => tag[0] === 'e')
          .reverse()
          .slice(0, MAX_PINNED_NOTES)
          .map((tag) => {
            const [, hexId, relay, _pubkey] = tag
            if (!hexId || hexIdSet.has(hexId) || (_pubkey && _pubkey !== pubkey)) {
              return undefined
            }

            const id = generateBech32IdFromETag(['e', hexId, relay ?? '', pubkey])
            if (id) {
              hexIdSet.add(hexId)
            }
            return id
          })
          .filter(Boolean) as string[]) ?? []
      setPinnedEventIds(ids)
    }
    initPinnedEventIds()
  }, [pubkey, myPubkey, myPinListEvent])

  useEffect(() => {
    const init = async () => {
      if (listMode === 'you') {
        if (!myPubkey) {
          setSubRequests([])
          return
        }

        const [relayList, myRelayList] = await Promise.all([
          client.fetchRelayList(pubkey),
          client.fetchRelayList(myPubkey)
        ])

        setSubRequests([
          {
            urls: myRelayList.write.concat(getDefaultRelayUrls()).slice(0, 5),
            filter: {
              authors: [myPubkey],
              '#p': [pubkey]
            }
          },
          {
            urls: relayList.write.concat(getDefaultRelayUrls()).slice(0, 5),
            filter: {
              authors: [pubkey],
              '#p': [myPubkey]
            }
          }
        ])
        return
      }

      const relayList = await client.fetchRelayList(pubkey)

      if (listMode === 'gallery') {
        setSubRequests([
          {
            urls: relayList.write.concat(getDefaultRelayUrls()).slice(0, 8),
            filter: { authors: [pubkey], kinds: [ExtendedKind.PICTURE] }
          }
        ])
        return
      }

      if (listMode === 'lists') {
        setSubRequests([
          {
            urls: relayList.write.concat(getDefaultRelayUrls()).slice(0, 8),
            filter: { authors: [pubkey], kinds: [ExtendedKind.FOLLOW_SET] }
          }
        ])
        return
      }

      if (listMode === 'inLists') {
        setSubRequests([
          {
            urls: relayList.write.concat(getDefaultRelayUrls()).slice(0, 8),
            filter: { kinds: [ExtendedKind.FOLLOW_SET, ExtendedKind.FOLLOW_PACK, 10000], '#p': [pubkey] }
          }
        ])
        return
      }

      if (search) {
        const writeRelays = relayList.write.slice(0, 8)
        const relayInfos = await relayInfoService.getRelayInfos(writeRelays)
        const searchableRelays = writeRelays.filter((_, index) =>
          relayInfos[index]?.supported_nips?.includes(50)
        )
        setSubRequests([
          {
            urls: searchableRelays.concat(getSearchRelayUrls()).slice(0, 8),
            filter: { authors: [pubkey], search }
          }
        ])
      } else {
        setSubRequests([
          {
            urls: relayList.write.concat(getDefaultRelayUrls()).slice(0, 8),
            filter: {
              authors: [pubkey]
            }
          }
        ])
      }
    }
    init()
  }, [pubkey, listMode, search])

  const handleListModeChange = (mode: TNoteListMode) => {
    setListMode(mode)
    noteListRef.current?.scrollToTop('smooth')
  }

  const handleShowKindsChange = (newShowKinds: number[]) => {
    setTemporaryShowKinds(newShowKinds)
    noteListRef.current?.scrollToTop('instant')
  }

  return (
    <>
      <Tabs
        value={listMode}
        tabs={tabs}
        onTabChange={(listMode) => {
          handleListModeChange(listMode as TNoteListMode)
        }}
        threshold={Math.max(800, topSpace)}
        options={
          listMode !== 'gallery' && listMode !== 'lists' && listMode !== 'inLists' && listMode !== 'youtube' ? (
            <>
              {!supportTouch && <RefreshButton onClick={() => noteListRef.current?.refresh()} />}
              <KindFilter showKinds={temporaryShowKinds} onShowKindsChange={handleShowKindsChange} />
            </>
          ) : undefined
        }
      />
      <NoteList
        ref={noteListRef}
        subRequests={subRequests}
        showKinds={
          listMode === 'gallery'
            ? [ExtendedKind.PICTURE]
            : listMode === 'lists'
              ? [ExtendedKind.FOLLOW_SET]
              : listMode === 'inLists'
                ? [ExtendedKind.FOLLOW_SET, ExtendedKind.FOLLOW_PACK, 10000]
                : temporaryShowKinds
        }
        hideReplies={listMode === 'posts' || listMode === 'images'}
        filterMutedNotes={false}
        showMutedContent={isMuted}
        pinnedEventIds={listMode === 'you' || listMode === 'lists' || listMode === 'inLists' || listMode === 'youtube' || !!search ? [] : pinnedEventIds}
        showNewNotesDirectly={myPubkey === pubkey}
        filterFn={
          listMode === 'images'
            ? (e) => e.content.split(/\s+/).some((word) => isImage(word))
            : listMode === 'youtube'
              ? (e) => YOUTUBE_URL_REGEX.test(e.content)
              : undefined
        }
        fetchLimit={listMode === 'images' || listMode === 'youtube' ? 1000 : undefined}
      />
    </>
  )
}
