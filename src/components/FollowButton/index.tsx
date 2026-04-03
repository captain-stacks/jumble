import { Button } from '@/components/ui/button'
import { useFollowList } from '@/providers/FollowListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { Loader } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function FollowButton({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { pubkey: accountPubkey, checkLogin } = useNostr()
  const { followingSet, follow, unfollow } = useFollowList()
  const [updating, setUpdating] = useState(false)
  const [hover, setHover] = useState(false)
  const isFollowing = useMemo(() => followingSet.has(pubkey), [followingSet, pubkey])

  if (!accountPubkey || (pubkey && pubkey === accountPubkey)) return null

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    checkLogin(async () => {
      setUpdating(true)
      if (isFollowing) {
        await unfollow(pubkey)
      } else {
        await follow(pubkey)
      }
      setUpdating(false)
    })
  }

  return (
    <Button
      className="min-w-28 rounded-full"
      variant={isFollowing ? (hover ? 'destructive' : 'secondary') : 'default'}
      disabled={updating}
      onClick={handleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {updating ? (
        <Loader className="animate-spin" />
      ) : isFollowing ? (
        hover ? t('Unfollow') : t('buttonFollowing')
      ) : (
        t('Follow')
      )}
    </Button>
  )
}
