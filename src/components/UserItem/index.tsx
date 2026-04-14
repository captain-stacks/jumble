import FollowButton from '@/components/FollowButton'
import MuteButton from '@/components/MuteButton'
import Nip05 from '@/components/Nip05'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { userIdToPubkey } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { useMemo } from 'react'
import FollowingBadge from '../FollowingBadge'
import TrustScoreBadge from '../TrustScoreBadge'

export default function UserItem({
  userId,
  hideFollowButton,
  showMuteButton = false,
  showFollowingBadge = false,
  onRemove,
  className
}: {
  userId: string
  hideFollowButton?: boolean
  showMuteButton?: boolean
  showFollowingBadge?: boolean
  onRemove?: (pubkey: string) => void
  className?: string
}) {
  const pubkey = useMemo(() => userIdToPubkey(userId), [userId])

  return (
    <div className={cn('flex h-14 items-center gap-2', className)}>
      <UserAvatar userId={userId} className="shrink-0" />
      <div className="w-full overflow-hidden">
        <div className="flex items-center gap-2">
          <Username
            userId={userId}
            className="w-fit max-w-full truncate font-semibold"
            skeletonClassName="h-4"
          />
          {showFollowingBadge && <FollowingBadge pubkey={pubkey} />}
          <TrustScoreBadge pubkey={pubkey} />
        </div>
        <Nip05 pubkey={userId} />
      </div>
      {showMuteButton && <MuteButton pubkey={pubkey} className={!hideFollowButton ? 'min-w-0 px-3' : undefined} />}
      {!hideFollowButton && <FollowButton pubkey={userId} className={showMuteButton ? 'min-w-0 px-3' : undefined} />}
      {onRemove && (
        <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => onRemove(pubkey)}>
          <X size={16} />
        </Button>
      )}
    </div>
  )
}

export function UserItemSkeleton({ hideFollowButton }: { hideFollowButton?: boolean }) {
  return (
    <div className="flex h-14 items-center gap-2">
      <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
      <div className="w-full">
        <div className="py-1">
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
      {!hideFollowButton && <Skeleton className="h-9 min-w-28 rounded-full" />}
    </div>
  )
}
