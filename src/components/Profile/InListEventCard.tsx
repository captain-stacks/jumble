import { ExtendedKind } from '@/constants'
import { toFollowPack } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import { kinds, Event } from 'nostr-tools'
import UserAvatar from '@/components/UserAvatar'
import { useFetchProfile } from '@/hooks'

function kindLabel(kind: number): string {
  if (kind === ExtendedKind.FOLLOW_PACK) return 'Follow Pack'
  if (kind === kinds.Followsets) return 'Follow Set'
  if (kind === kinds.Genericlists) return 'List'
  return 'List'
}

function AuthorName({ pubkey }: { pubkey: string }) {
  const { profile } = useFetchProfile(pubkey)
  return <span className="font-medium truncate">{profile?.username ?? pubkey.slice(0, 8) + '…'}</span>
}

export default function InListEventCard({ event }: { event: Event }) {
  const { push } = useSecondaryPage()
  const title =
    event.tags.find(([t]) => t === 'title')?.[1] ||
    event.tags.find(([t]) => t === 'd')?.[1] ||
    kindLabel(event.kind)

  const handleClick = () => {
    if (event.kind === ExtendedKind.FOLLOW_PACK) {
      push(toFollowPack(event))
    }
  }

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors ${event.kind === ExtendedKind.FOLLOW_PACK ? 'cursor-pointer' : ''}`}
      onClick={handleClick}
    >
      <UserAvatar userId={event.pubkey} className="size-7 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <AuthorName pubkey={event.pubkey} />
          <span className="text-muted-foreground text-xs shrink-0">·</span>
          <span className="text-xs text-muted-foreground shrink-0">{title}</span>
        </div>
        <div className="text-xs text-muted-foreground/60">{kindLabel(event.kind)}</div>
      </div>
    </div>
  )
}
