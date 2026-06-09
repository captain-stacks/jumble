import FollowButton from '@/components/FollowButton'
import MuteButton from '@/components/MuteButton'
import Nip05 from '@/components/Nip05'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  selected,
  onSelect,
  showScore,
  hideTrustBadge,
  className
}: {
  userId: string
  hideFollowButton?: boolean
  showMuteButton?: boolean
  showFollowingBadge?: boolean
  onRemove?: (pubkey: string) => void
  selected?: boolean
  onSelect?: (pubkey: string) => void
  showScore?: boolean
  hideTrustBadge?: boolean
  className?: string
}) {
  const pubkey = useMemo(() => userIdToPubkey(userId), [userId])

  return (
    <div
      className={cn('flex h-14 items-center gap-2', onSelect && 'cursor-pointer', className)}
      onClick={onSelect ? () => onSelect(pubkey) : undefined}
    >
      {onSelect && (
        <Checkbox
          checked={selected ?? false}
          onCheckedChange={() => onSelect(pubkey)}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0"
        />
      )}
      <UserAvatar userId={userId} className="shrink-0" />
      <div className="w-full overflow-hidden">
        <div className="flex items-center gap-2">
          <Username
            userId={userId}
            className="w-fit max-w-full truncate font-semibold"
            skeletonClassName="h-4"
          />
          {showFollowingBadge && <FollowingBadge pubkey={pubkey} />}
          {!hideTrustBadge && <TrustScoreBadge pubkey={pubkey} numeric={showScore} />}
        </div>
        <Nip05 pubkey={userId} />
      </div>
      {!onSelect && showMuteButton && <MuteButton pubkey={pubkey} className={!hideFollowButton ? 'min-w-0 px-3' : undefined} />}
      {!onSelect && !hideFollowButton && <FollowButton pubkey={userId} className={showMuteButton ? 'min-w-0 px-3' : undefined} />}
      {!onSelect && onRemove && (
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
