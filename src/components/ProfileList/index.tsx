import { Button } from '@/components/ui/button'
import { useFollowList } from '@/providers/FollowListProvider'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { Loader, UserCheck, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import UserItem from '../UserItem'

export default function ProfileList({
  pubkeys,
  showBulkActions = false,
  showMuteButton = false,
  hideFollowButton = false
}: {
  pubkeys: string[]
  showBulkActions?: boolean
  showMuteButton?: boolean
  hideFollowButton?: boolean
}) {
  const { t } = useTranslation()
  const { pubkey: accountPubkey } = useNostr()
  const { followAll, followingSet } = useFollowList()
  const { muteAllPublicly, mutePubkeySet, changing } = useMuteList()
  const [followingAll, setFollowingAll] = useState(false)
  const [mutingAll, setMutingAll] = useState(false)
  const [visiblePubkeys, setVisiblePubkeys] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setVisiblePubkeys(pubkeys.slice(0, 10))
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

  return (
    <div className="px-4 pt-2">
      {showBulkActions && accountPubkey && pubkeys.length > 0 && (
        <div className="mb-3 flex gap-2">
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
        </div>
      )}
      {visiblePubkeys.map((pubkey, index) => (
        <UserItem key={`${index}-${pubkey}`} userId={pubkey} showMuteButton={showMuteButton} hideFollowButton={hideFollowButton} />
      ))}
      {pubkeys.length > visiblePubkeys.length && <div ref={bottomRef} />}
    </div>
  )
}
