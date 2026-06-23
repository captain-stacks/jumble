import UserItem from '@/components/UserItem'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { Users, VolumeX } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export default function TrustScorePanel({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { pubkey: currentPubkey } = useNostr()
  const { computeTrustScore, getWotStats, wotReady } = useUserTrust()

  const { follows, mutes, myFollowSetSize, sampleFollowers, sampleMuters } = useMemo(
    () =>
      currentPubkey && wotReady
        ? getWotStats(pubkey)
        : { follows: 0, mutes: 0, myFollowSetSize: 0, sampleFollowers: [], sampleMuters: [] },
    [currentPubkey, wotReady, getWotStats, pubkey]
  )
  const score = currentPubkey && wotReady ? computeTrustScore(pubkey) : 0

  const sortedFollowers = useMemo(
    () => [...sampleFollowers].sort((a, b) => computeTrustScore(b) - computeTrustScore(a)),
    [sampleFollowers, computeTrustScore]
  )
  const sortedMuters = useMemo(
    () => [...sampleMuters].sort((a, b) => computeTrustScore(b) - computeTrustScore(a)),
    [sampleMuters, computeTrustScore]
  )

  if (!currentPubkey || !wotReady) return null

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
          {sortedFollowers.length > 0 && (
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
                {sortedFollowers.map((p) => (
                  <UserItem key={p} userId={p} hideFollowButton />
                ))}
              </div>
            </div>
          )}

          {sortedMuters.length > 0 && (
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
                {sortedMuters.map((p) => (
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
