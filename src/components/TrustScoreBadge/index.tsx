import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import fayan from '@/services/fayan.service'
import { ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()
  const { isUserTrusted } = useUserTrust()
  const { pubkey: currentPubkey } = useNostr()
  const [percentile, setPercentile] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const isSelf = currentPubkey === pubkey
  const inWoT = !isSelf && isUserTrusted(pubkey)

  useEffect(() => {
    if (isSelf) {
      setLoading(false)
      setPercentile(null)
      return
    }
    // Non-numeric badge skips WoT users (they're trusted, no need for a warning icon).
    // Numeric badge always fetches so it can show the actual score.
    if (!numeric && inWoT) {
      setLoading(false)
      setPercentile(null)
      return
    }

    const fetchScore = async () => {
      try {
        const percentile = await fayan.fetchUserPercentile(pubkey)
        if (percentile !== null) {
          setPercentile(percentile)
        }
      } catch (error) {
        console.error('Failed to fetch trust score:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchScore()
  }, [pubkey, isSelf, inWoT, numeric])

  if (numeric) {
    if (isSelf || loading || percentile === null) return null

    const color = inWoT ? 'text-green-500' : 'text-red-500'
    return (
      <span
        title={t('Trust score: {{percentile}}%', { percentile })}
        className={cn('text-xs font-medium tabular-nums', color, className)}
      >
        {percentile}%
      </span>
    )
  }

  if (loading || percentile === null) return null

  // percentile < 40: low trust ranking (red alert)
  if (percentile < 40) {
    return (
      <div
        title={t('Low trust ranking ({{percentile}}%)', { percentile })}
        className={classNames?.container}
      >
        <ShieldAlert className={cn('!size-4 text-red-500', className)} />
      </div>
    )
  }

  return null
}
