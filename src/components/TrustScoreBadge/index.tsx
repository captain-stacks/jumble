import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { useTranslation } from 'react-i18next'

export default function TrustScoreBadge({
  pubkey,
  className,
  classNames
}: {
  pubkey: string
  className?: string
  classNames?: {
    container?: string
  }
}) {
  const { t } = useTranslation()
  const { pubkey: currentPubkey } = useNostr()
  const { computeTrustScore, isUserTrusted } = useUserTrust()

  if (!currentPubkey) return null

  const score = computeTrustScore(pubkey)
  const trusted = isUserTrusted(pubkey)
  const colorClass = trusted ? 'text-green-500' : 'text-red-500'
  const tooltip = trusted
    ? t('WoT score: {{score}} — someone in your network follows this person', { score })
    : t('WoT score: {{score}} — nobody in your network follows this person', { score })

  return (
    <span
      className={cn(
        'shrink-0 text-xs font-medium tabular-nums',
        colorClass,
        className,
        classNames?.container
      )}
      title={tooltip}
    >
      {score}
    </span>
  )
}
