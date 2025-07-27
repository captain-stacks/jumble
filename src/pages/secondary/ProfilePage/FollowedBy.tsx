import UserAvatar from '@/components/UserAvatar'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import client from '@/services/client.service'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUserTrust } from '@/providers/UserTrustProvider'

export default function FollowedBy({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const [followedBy, setFollowedBy] = useState<string[]>([])
  const { pubkey: accountPubkey } = useNostr()
  const { userTrustScore } = useUserTrust()

  useEffect(() => {
    if (!pubkey || !accountPubkey) return

    const init = async () => {
      const followings = (await client.fetchFollowings(accountPubkey)).reverse()
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
    }
    init()
  }, [pubkey, accountPubkey])

  if (followedBy.length === 0) return null

  return (
    <div className="flex items-center gap-1">
      <div className="text-muted-foreground">{t('Followed by')}
        {' ' + followedBy.length}&nbsp;
      </div>
      {followedBy.slice(0, 10).map((p) => (
        <UserAvatar userId={p} key={p} size="xSmall" />
      ))}
    </div>
  )
}
