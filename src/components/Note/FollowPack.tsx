import { getFollowPackInfoFromEvent } from '@/lib/event-metadata'
import { ExtendedKind } from '@/constants'
import { Event, kinds } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Image from '../Image'

function kindLabel(kind: number): string {
  if (kind === ExtendedKind.FOLLOW_PACK) return 'Follow Pack'
  if (kind === kinds.Mutelist) return 'Mute Pack'
  return 'List'
}

export default function FollowPack({ event, className }: { event: Event; className?: string }) {
  const { t } = useTranslation()
  const { title, description, image, pubkeys } = useMemo(
    () => getFollowPackInfoFromEvent(event),
    [event]
  )

  return (
    <div className={className}>
      <div className="flex items-start gap-2">
        {image && (
          <Image
            image={{ url: image, pubkey: event.pubkey }}
            className="h-20 w-24 object-cover"
            classNames={{
              wrapper: 'w-24 h-20 flex-shrink-0',
              errorPlaceholder: 'w-24 h-20'
            }}
            hideIfError
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="mb-1 truncate text-xl font-semibold">{title}</h3>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {kindLabel(event.kind)}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {t('n users', { count: pubkeys.length })}
            </span>
          </div>
          {description && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
    </div>
  )
}
