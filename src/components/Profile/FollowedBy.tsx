import UserAvatar from '@/components/UserAvatar'
import { useFollowList } from '@/providers/FollowListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import client from '@/services/client.service'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function FollowedBy({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const [followedBy, setFollowedBy] = useState<string[]>([])
  const { pubkey: accountPubkey } = useNostr()
  const { followingSet } = useFollowList()

  useEffect(() => {
    if (!pubkey || !accountPubkey) {
      setFollowedBy([])
      return
    }

    let cancelled = false

    const getFollowedByFromLists = (
      followings: string[],
      followingsOfFollowings: Array<string[] | null>
    ) => {
      const result: string[] = []
      const limit = isSmallScreen ? 3 : 20
      for (const [index, following] of followings.entries()) {
        if (following === pubkey) continue
        const list = followingsOfFollowings[index]
        if (list && list.includes(pubkey)) {
          result.push(following)
        }
        if (result.length >= limit) break
      }
      return result
    }

    const init = async () => {
      const followings = Array.from(followingSet).reverse()

      // Stage 1: render quickly from local cache only.
      const cachedSettled = await Promise.allSettled(
        followings.map(async (following) => client.getCachedFollowings(following, true))
      )
      const cachedFollowedBy = getFollowedByFromLists(
        followings,
        cachedSettled.map((entry) => (entry.status === 'fulfilled' ? entry.value : null))
      )
      if (!cancelled) {
        setFollowedBy(cachedFollowedBy)
      }

      // Stage 2: refresh from network/cache query and update only if result changes.
      const freshSettled = await Promise.allSettled(
        followings.map(async (following) => client.fetchFollowings(following, true, true))
      )
      const freshFollowedBy = getFollowedByFromLists(
        followings,
        freshSettled.map((entry) => (entry.status === 'fulfilled' ? entry.value : null))
      )
      if (!cancelled) {
        setFollowedBy((prev) => {
          if (prev.length === freshFollowedBy.length && prev.every((value, i) => value === freshFollowedBy[i])) {
            return prev
          }
          return freshFollowedBy
        })
      }
    }
    init()

    return () => {
      cancelled = true
    }
  }, [pubkey, accountPubkey, followingSet, isSmallScreen])

  if (followedBy.length === 0) return null

  return (
    <div className="flex items-start gap-1">
      <div className="pt-0.5 text-muted-foreground">{t('Followed by')}</div>
      <div className="grid grid-cols-5 gap-1">
        {followedBy.map((p) => (
          <UserAvatar userId={p} key={p} size="xSmall" />
        ))}
      </div>
    </div>
  )
}
