import { useFetchProfile } from '@/hooks'
import { userIdToPubkey } from '@/lib/pubkey'
import { useMemo } from 'react'
import FollowButton from '../FollowButton'
import Nip05 from '../Nip05'
import ProfileAbout from '../ProfileAbout'
import TextWithEmojis from '../TextWithEmojis'
import TrustScoreBadge from '../TrustScoreBadge'
import { SimpleUserAvatar } from '../UserAvatar'

export default function ProfileCard({
  userId,
  showFollowButton = true
}: {
  userId: string
  showFollowButton?: boolean
}) {
  const pubkey = useMemo(() => userIdToPubkey(userId), [userId])
  const { profile } = useFetchProfile(userId)
  const { username, about, emojis } = profile || {}

  return (
    <div className="not-prose flex w-full flex-col gap-2">
      <div className="flex w-full items-start justify-between space-x-2">
        <SimpleUserAvatar userId={pubkey} className="h-12 w-12" />
        {showFollowButton && <FollowButton pubkey={pubkey} />}
      </div>
      <div>
        <div className="flex items-center gap-2">
          <TextWithEmojis
            text={username || ''}
            emojis={emojis}
            className="truncate text-lg font-semibold"
          />
          <TrustScoreBadge pubkey={pubkey} />
        </div>
        <Nip05 pubkey={pubkey} />
      </div>
      {about && (
        <ProfileAbout
          about={about}
          emojis={emojis}
          className="line-clamp-6 w-full overflow-hidden text-ellipsis text-wrap break-words text-sm"
        />
      )}
    </div>
  )
}
