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

    const areArraysEqual = (a: string[], b: string[]) =>
      a.length === b.length && a.every((value, i) => value === b[i])

    const mergeSourceFollowings = (extraFollowings: string[]) =>
      Array.from(new Set([...Array.from(followingSet), ...extraFollowings])).reverse()

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

    const resolveFollowedBy = async (followings: string[], useCacheOnly: boolean) => {
      const settled = await Promise.allSettled(
        followings.map(async (following) =>
          useCacheOnly
            ? client.getCachedFollowings(following, true)
            : client.fetchFollowings(following, true, true)
        )
      )
      return getFollowedByFromLists(
        followings,
        settled.map((entry) => (entry.status === 'fulfilled' ? entry.value : null))
      )
    }

    const applyFollowedBy = (nextFollowedBy: string[]) => {
      if (cancelled) return
      setFollowedBy((prev) => (areArraysEqual(prev, nextFollowedBy) ? prev : nextFollowedBy))
    }

    const init = async () => {
      // Stage 1: render quickly from local cache only.
      const cachedSourceFollowings = mergeSourceFollowings(
        await client.getCachedFollowings(accountPubkey, true)
      )
      applyFollowedBy(await resolveFollowedBy(cachedSourceFollowings, true))

      // Stage 2: refresh from network/cache query and update only if result changes.
      const freshSourceFollowings = mergeSourceFollowings(
        await client.fetchFollowings(accountPubkey, true, true)
      )
      applyFollowedBy(await resolveFollowedBy(freshSourceFollowings, false))

      // Stage 3: follow packs may arrive slightly later; run one delayed refresh pass.
      await new Promise((resolve) => setTimeout(resolve, 1500))
      if (cancelled) return
      const delayedSourceFollowings = mergeSourceFollowings(
        await client.fetchFollowings(accountPubkey, true, true)
      )
      applyFollowedBy(await resolveFollowedBy(delayedSourceFollowings, false))
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
