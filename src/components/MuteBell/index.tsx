import { cn } from '@/lib/utils'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useStuff } from '@/hooks/useStuff'
import { Bell, BellOff, Loader } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function MuteBell({
  stuff,
  className
}: {
  stuff: Event | string
  className?: string
}) {
  const { t } = useTranslation()
  const { pubkey: accountPubkey, checkLogin } = useNostr()
  const { mutePubkeySet, mutePubkeyPublicly, unmutePubkey } = useMuteList()
  const [updating, setUpdating] = useState(false)
  const { event } = useStuff(stuff)

  const isMuted = useMemo(
    () => (event ? mutePubkeySet.has(event.pubkey) : false),
    [mutePubkeySet, event]
  )

  if (!accountPubkey || !event || event.pubkey === accountPubkey) return null

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    checkLogin(async () => {
      setUpdating(true)
      try {
        if (isMuted) {
          await unmutePubkey(event.pubkey)
        } else {
          await mutePubkeyPublicly(event.pubkey)
        }
      } finally {
        setUpdating(false)
      }
    })
  }

  return (
    <button
      className={cn(
        'flex cursor-pointer items-center px-2 py-1 transition-colors [&_svg]:size-4 [&_svg]:shrink-0 disabled:cursor-default',
        isMuted
          ? 'text-red-400 hover:text-red-400/60'
          : 'text-muted-foreground hover:text-red-400',
        className
      )}
      onClick={handleClick}
      disabled={updating}
      title={isMuted ? t('Unmute user') : t('Mute user publicly')}
    >
      {updating ? (
        <Loader className="animate-spin" />
      ) : isMuted ? (
        <Bell />
      ) : (
        <BellOff />
      )}
    </button>
  )
}
