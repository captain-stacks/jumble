import { Button } from '@/components/ui/button'
import { useFollowList } from '@/providers/FollowListProvider'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { Loader, MousePointer2, UserCheck, VolumeX, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import UserItem from '../UserItem'

export default function ProfileList({
  pubkeys,
  showBulkActions = false,
  showMuteButton = false,
  hideFollowButton = false,
  showScores = false,
  onRemove
}: {
  pubkeys: string[]
  showBulkActions?: boolean
  showMuteButton?: boolean
  hideFollowButton?: boolean
  showScores?: boolean
  onRemove?: (pubkey: string) => void
}) {
  const { t } = useTranslation()
  const { pubkey: accountPubkey } = useNostr()
  const { followAll, followingSet } = useFollowList()
  const { muteAllPublicly, unmuteAll, mutePubkeySet, changing } = useMuteList()
  const [followingAll, setFollowingAll] = useState(false)
  const [mutingAll, setMutingAll] = useState(false)
  const [unmutingSelected, setUnmutingSelected] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedPubkeys, setSelectedPubkeys] = useState<Set<string>>(new Set())
  const [anchorPubkey, setAnchorPubkey] = useState<string | null>(null)
  const [visiblePubkeys, setVisiblePubkeys] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setVisiblePubkeys(pubkeys.slice(0, 10))
    setSelectMode(false)
    setSelectedPubkeys(new Set())
    setAnchorPubkey(null)
  }, [pubkeys])

  useEffect(() => {
    const options = {
      root: null,
      rootMargin: '10px',
      threshold: 1
    }

    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && pubkeys.length > visiblePubkeys.length) {
        setVisiblePubkeys((prev) => [...prev, ...pubkeys.slice(prev.length, prev.length + 10)])
      }
    }, options)

    const currentBottomRef = bottomRef.current
    if (currentBottomRef) {
      observerInstance.observe(currentBottomRef)
    }

    return () => {
      if (observerInstance && currentBottomRef) {
        observerInstance.unobserve(currentBottomRef)
      }
    }
  }, [visiblePubkeys, pubkeys])

  const unfollowedPubkeys = pubkeys.filter(
    (pk) => pk !== accountPubkey && !followingSet.has(pk)
  )
  const unmutedPubkeys = pubkeys.filter(
    (pk) => pk !== accountPubkey && !mutePubkeySet.has(pk)
  )

  const handleFollowAll = async () => {
    setFollowingAll(true)
    try {
      await followAll(unfollowedPubkeys)
    } finally {
      setFollowingAll(false)
    }
  }

  const handleMuteAll = async () => {
    setMutingAll(true)
    try {
      await muteAllPublicly(unmutedPubkeys)
    } finally {
      setMutingAll(false)
    }
  }

  const handleToggleSelect = (pubkey: string) => {
    if (!anchorPubkey || anchorPubkey === pubkey) {
      setSelectedPubkeys((prev) => {
        const next = new Set(prev)
        if (next.has(pubkey)) {
          next.delete(pubkey)
        } else {
          next.add(pubkey)
        }
        return next
      })
      setAnchorPubkey(pubkey)
    } else {
      const anchorIdx = pubkeys.indexOf(anchorPubkey)
      const clickedIdx = pubkeys.indexOf(pubkey)
      if (anchorIdx !== -1 && clickedIdx !== -1) {
        const start = Math.min(anchorIdx, clickedIdx)
        const end = Math.max(anchorIdx, clickedIdx)
        const range = pubkeys.slice(start, end + 1)
        setSelectedPubkeys((prev) => {
          const next = new Set(prev)
          range.forEach((pk) => next.add(pk))
          return next
        })
      }
      setAnchorPubkey(pubkey)
    }
  }

  const handleUnmuteSelected = async () => {
    const toUnmute = Array.from(selectedPubkeys).filter((pk) => mutePubkeySet.has(pk))
    if (toUnmute.length === 0) return
    setUnmutingSelected(true)
    try {
      await unmuteAll(toUnmute)
      setSelectMode(false)
      setSelectedPubkeys(new Set())
      setAnchorPubkey(null)
    } finally {
      setUnmutingSelected(false)
    }
  }

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelectedPubkeys(new Set())
    setAnchorPubkey(null)
  }

  const mutedSelected = Array.from(selectedPubkeys).filter((pk) => mutePubkeySet.has(pk))

  return (
    <div className="px-4 pt-2">
      {showBulkActions && accountPubkey && pubkeys.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {!selectMode ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={followingAll || unfollowedPubkeys.length === 0}
                onClick={handleFollowAll}
              >
                {followingAll ? <Loader className="animate-spin" /> : <UserCheck />}
                {t('Follow all')} {unfollowedPubkeys.length > 0 && `(${unfollowedPubkeys.length})`}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={mutingAll || changing || unmutedPubkeys.length === 0}
                onClick={handleMuteAll}
              >
                {mutingAll ? <Loader className="animate-spin" /> : <VolumeX />}
                {t('Mute all')} {unmutedPubkeys.length > 0 && `(${unmutedPubkeys.length})`}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setSelectMode(true)}
              >
                <MousePointer2 />
                Select
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={unmutingSelected || changing || mutedSelected.length === 0}
                onClick={handleUnmuteSelected}
              >
                {unmutingSelected ? <Loader className="animate-spin" /> : <VolumeX />}
                Unmute selected {selectedPubkeys.size > 0 && `(${mutedSelected.length})`}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2"
                onClick={exitSelectMode}
              >
                <X />
                Cancel
              </Button>
            </>
          )}
        </div>
      )}
      {visiblePubkeys.map((pubkey, index) => (
        <UserItem
          key={`${index}-${pubkey}`}
          userId={pubkey}
          showMuteButton={showMuteButton}
          hideFollowButton={hideFollowButton}
          onRemove={onRemove}
          selected={selectMode ? selectedPubkeys.has(pubkey) : undefined}
          onSelect={selectMode ? handleToggleSelect : undefined}
          showScore={showScores}
        />
      ))}
      {pubkeys.length > visiblePubkeys.length && <div ref={bottomRef} />}
    </div>
  )
}
