import UserItem from '@/components/UserItem'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { Users, VolumeX } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function TrustScorePanel({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { pubkey: currentPubkey } = useNostr()
  const { computeTrustScore, getWotStats, wotReady } = useUserTrust()

  if (!currentPubkey || !wotReady) return null

  const { follows, mutes, myFollowSetSize, sampleFollowers, sampleMuters } = getWotStats(pubkey)
  const score = computeTrustScore(pubkey)

  return (
    <div className="border-border mt-3 rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground font-medium">{t('Network trust score')}</span>
        <span
          className={cn(
            'font-semibold tabular-nums',
            score >= 70 ? 'text-green-500' : score >= 40 ? 'text-yellow-500' : 'text-red-500'
          )}
        >
          {score}
          <span className="text-muted-foreground font-normal">/100</span>
        </span>
      </div>

      {follows === 0 && mutes === 0 ? (
        <p className="text-muted-foreground mt-2">
          {t('Not known by any of your {{count}} follows', { count: myFollowSetSize })}
        </p>
      ) : (
        <>
          {sampleFollowers.length > 0 && (
            <div className="mt-3">
              <div className="text-muted-foreground mb-2 flex items-center gap-1.5">
                <Users size={12} className="shrink-0" />
                <span>
                  {t('Followed by {{follows}} of your {{total}} follows', {
                    follows,
                    total: myFollowSetSize
                  })}
                </span>
              </div>
              <div className="flex flex-col">
                {sampleFollowers.map((p) => (
                  <UserItem key={p} userId={p} hideFollowButton />
                ))}
              </div>
            </div>
          )}

          {sampleMuters.length > 0 && (
            <div className="mt-3">
              <div className="text-muted-foreground mb-2 flex items-center gap-1.5">
                <VolumeX size={12} className="shrink-0" />
                <span>
                  {t('Muted by {{mutes}} of your {{total}} follows', {
                    mutes,
                    total: myFollowSetSize
                  })}
                </span>
              </div>
              <div className="flex flex-col">
                {sampleMuters.map((p) => (
                  <UserItem key={p} userId={p} hideFollowButton />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
