import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Skeleton } from '@/components/ui/skeleton'
import { useFetchProfile } from '@/hooks'
import { toProfile } from '@/lib/link'
import { generateImageByPubkey } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { SecondaryPageLink } from '@/PageManager'
import { useMemo } from 'react'
import ProfileCard from '../ProfileCard'
import { useUserTrust } from '@/providers/UserTrustProvider'

const UserAvatarSizeCnMap = {
  large: 'w-24 h-24',
  big: 'w-16 h-16',
  semiBig: 'w-12 h-12',
  normal: 'w-10 h-10',
  medium: 'w-9 h-9',
  small: 'w-7 h-7',
  xSmall: 'w-5 h-5',
  tiny: 'w-4 h-4'
}

export default function UserAvatar({
  userId,
  className,
  size = 'normal'
}: {
  userId: string
  className?: string
  size?: 'large' | 'big' | 'semiBig' | 'normal' | 'medium' | 'small' | 'xSmall' | 'tiny'
}) {
  const { profile } = useFetchProfile(userId)
  const { isUserFollowed, isUserTrusted } = useUserTrust()
  const defaultAvatar = useMemo(
    () => (profile?.pubkey ? generateImageByPubkey(profile.pubkey) : ''),
    [profile]
  )

  const isFollowed = profile?.pubkey ? isUserFollowed(profile.pubkey) : false
  const isTrusted = profile?.pubkey ? isUserTrusted(profile.pubkey) : true

  if (!profile) {
    return (
      <Skeleton className={cn('shrink-0', UserAvatarSizeCnMap[size], 'rounded-full', className)} />
    )
  }
  const { avatar, pubkey } = profile

  return (
    <HoverCard>
      <HoverCardTrigger>
        <SecondaryPageLink to={toProfile(pubkey)} onClick={(e) => e.stopPropagation()}>
          <Avatar
            className={cn(
              'shrink-0',
              UserAvatarSizeCnMap[size],
              'relative',
              className,
              isFollowed && 'ring-2 ring-green-500 ring-offset-2',
              !isTrusted && 'ring-2 ring-red-500 ring-offset-2'
            )}
          >
            <AvatarImage src={avatar} className="object-cover object-center" />
            <AvatarFallback>
              <img src={defaultAvatar} alt={pubkey} />
            </AvatarFallback>
          </Avatar>
        </SecondaryPageLink>
      </HoverCardTrigger>
      <HoverCardContent className="w-72">
        <ProfileCard pubkey={pubkey} />
      </HoverCardContent>
    </HoverCard>
  )
}

export function SimpleUserAvatar({
  userId,
  size = 'normal',
  className,
  onClick
}: {
  userId: string
  size?: 'large' | 'big' | 'normal' | 'small' | 'xSmall' | 'tiny'
  className?: string
  onClick?: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
}) {
  const { profile } = useFetchProfile(userId)
  const { isUserFollowed, isUserTrusted } = useUserTrust()
  const defaultAvatar = useMemo(
    () => (profile?.pubkey ? generateImageByPubkey(profile.pubkey) : ''),
    [profile]
  )

  const isFollowed = profile?.pubkey ? isUserFollowed(profile.pubkey) : false
  const isTrusted = profile?.pubkey ? isUserTrusted(profile.pubkey) : true

  if (!profile) {
    return (
      <Skeleton className={cn('shrink-0', UserAvatarSizeCnMap[size], 'rounded-full', className)} />
    )
  }
  const { avatar, pubkey } = profile

  return (
    <Avatar
      className={cn(
        'shrink-0',
        UserAvatarSizeCnMap[size],
        'relative',
        className,
        isFollowed && 'ring-2 ring-green-500 ring-offset-2',
        !isTrusted && 'ring-2 ring-red-500 ring-offset-2'
      )}
      onClick={onClick}
    >
      <AvatarImage src={avatar} className="object-cover object-center" />
      <AvatarFallback>
        <img src={defaultAvatar} alt={pubkey} />
      </AvatarFallback>
    </Avatar>
  )
}
