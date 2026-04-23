import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { ShieldAlert } from 'lucide-react'
import { useEffect } from 'react'

export default function TrustScoreBadge({
  pubkey,
  className,
  classNames,
  numeric = false
}: {
  pubkey: string
  className?: string
  classNames?: {
    container?: string
  }
  numeric?: boolean
}) {
  const { isUserTrusted, getTrustScore, getMuteRatio, fetchScoreForPubkey } = useUserTrust()
  const { pubkey: currentPubkey } = useNostr()

  useEffect(() => {
    fetchScoreForPubkey(pubkey)
  }, [pubkey, fetchScoreForPubkey])

  const isSelf = currentPubkey === pubkey
  const inWoT = isUserTrusted(pubkey)

  if (!numeric && inWoT) return null

  const score = getTrustScore(pubkey)
  const { follows, mutes } = getMuteRatio(pubkey)
  const tooltip = follows > 0
    ? `Trust score: ${score} (${mutes} mutes / ${follows} follows)`
    : `Trust score: ${score} (not seen by your follows)`

  if (numeric) {
    const color = inWoT ? 'text-green-500' : 'text-red-500'
    return (
      <span
        title={tooltip}
        className={cn('text-xs font-medium tabular-nums', color, className)}
      >
        {score}
      </span>
    )
  }

  if (score >= 40) return null

  return (
    <div title={tooltip} className={classNames?.container}>
      <ShieldAlert className={cn('!size-4 text-red-500', className)} />
    </div>
  )
}
