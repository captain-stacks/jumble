import { cn } from '@/lib/utils'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { ShieldAlert } from 'lucide-react'
import { createContext, useContext, useEffect } from 'react'

const ScoreFetchContext = createContext(true)
export function NoScoreFetch({ children }: { children: React.ReactNode }) {
  return <ScoreFetchContext.Provider value={false}>{children}</ScoreFetchContext.Provider>
}

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
  const { isUserTrusted, getTrustScore, getMuteRatio, fetchScoreForPubkey, isScoreFetched, demandFetchCount } = useUserTrust()
  const fetchEnabled = useContext(ScoreFetchContext)

  useEffect(() => {
    if (fetchEnabled) fetchScoreForPubkey(pubkey)
  }, [pubkey, fetchScoreForPubkey, fetchEnabled])

  // subscribe to demandFetchCount so we re-render when the fetch completes
  void demandFetchCount

  const inWoT = isUserTrusted(pubkey)

  if (numeric && !isScoreFetched(pubkey)) return null

  if (!numeric && inWoT) return null

  const score = getTrustScore(pubkey)
  const { follows, mutes } = getMuteRatio(pubkey)
  const tooltip = follows > 0
    ? `Trust score: ${score} (${mutes} mutes / ${follows} follows)`
    : `Trust score: ${score} (${mutes} mutes, not seen by your follows)`

  if (numeric) {
    const color = follows > 0 ? 'text-green-500' : 'text-red-500'
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
