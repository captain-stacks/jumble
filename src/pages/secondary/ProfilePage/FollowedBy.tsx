import UserAvatar from '@/components/UserAvatar'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import client from '@/services/client.service'
import { useRef, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUserTrust } from '@/providers/UserTrustProvider'

export default function FollowedBy({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const [followedBy, setFollowedBy] = useState<string[]>([])
  const [trustScore, setTrustScore] = useState(-1)
  const { pubkey: accountPubkey } = useNostr()
  const { isUserTrusted } = useUserTrust()
  const isMounted = useRef(false)

  useEffect(() => {
    if (isMounted.current) return
    isMounted.current = true
    const init = async () => {
      if (!accountPubkey) return
      const followings = await client.fetchFollowings(accountPubkey)
      const followingsOfFollowings = await Promise.all(
        followings.map(async (following) => {
          return client.fetchFollowings(following)
        })
      )
      const _followedBy: string[] = []
      const limit = isSmallScreen ? 3 : 500
      for (const [index, following] of followings.entries()) {
        if (following === pubkey) continue
        if (followingsOfFollowings[index].includes(pubkey)) {
          _followedBy.push(following)
        }
        if (_followedBy.length >= limit) {
          break
        }
      }
      setFollowedBy(_followedBy)

      //if (_followedBy.length) return

      // Get all users who follow the given npub (depth-2 connections)
      const followers = await client.fetchFollowedBy(pubkey)
      // Get all users who mute the given npub
      const muters = await client.fetchMutedBy(pubkey)
      
      // Filter both lists to only trusted users
      const trustedFollowers = followers.filter(isUserTrusted)
      const trustedMuters = muters.filter(isUserTrusted)

      // Calculate score
      const F = trustedFollowers.length
      const M = trustedMuters.length
      let score = 0
      if (F > 0) {
        score = 100 * F / (F + M)
      }
      setTrustScore(score)
    }
    init()
  }, [pubkey, accountPubkey])

  return (
    <div className="flex items-center gap-1">
      {followedBy.length > 0 && <>
        <div className="text-muted-foreground">{t('Followed by')}
          {' ' + followedBy.length}&nbsp;
        </div>
        {followedBy.slice(0, 10).map((p) => (
          <UserAvatar userId={p} key={p} size="xSmall" />
        ))}
      </>}
      <span className="ml-2 text-muted-foreground">
        Trust score: {trustScore.toFixed(0)}%
      </span>
    </div>
  )
}
