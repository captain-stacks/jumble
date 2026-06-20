import UserItem from '@/components/UserItem'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { useEffect, useState } from 'react'
import InListEventCard from './InListEventCard'

export default function ProfileWotInfo({ pubkey }: { pubkey: string }) {
  const { getWotFollowers, getWotNonScoringFollowers, getWotMuters, getWotNonScoringMuters, getWotInListEvents, fetchScoreForPubkey, muteVersion, demandFetchCount } =
    useUserTrust()
  const [tab, setTab] = useState<'followers' | 'muters' | 'inlists'>('followers')

  useEffect(() => {
    fetchScoreForPubkey(pubkey, true)
  }, [pubkey, fetchScoreForPubkey, muteVersion])

  // muteVersion and demandFetchCount subscriptions keep this component in sync
  void muteVersion
  void demandFetchCount

  const followers = getWotFollowers(pubkey)
  const nonScoringFollowers = getWotNonScoringFollowers(pubkey)
  const muters = getWotMuters(pubkey)
  const nonScoringMuters = getWotNonScoringMuters(pubkey)
  const inListEvents = getWotInListEvents(pubkey)

  const tabs = [
    { key: 'followers' as const, label: `Followed by (${followers.length}${nonScoringFollowers.length ? `+${nonScoringFollowers.length}` : ''})` },
    { key: 'muters' as const, label: `Muted by (${muters.length}${nonScoringMuters.length ? `+${nonScoringMuters.length}` : ''})` },
    { key: 'inlists' as const, label: `In Lists (${inListEvents.length})` },
  ]

  return (
    <div className="mt-3 border border-border rounded-lg overflow-hidden">
      <div className="flex border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-2 py-2 text-xs font-medium transition-colors ${
              tab === t.key
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="max-h-64 overflow-y-auto">
        {tab === 'followers' && (
          followers.length === 0 && nonScoringFollowers.length === 0
            ? <div className="px-3 py-4 text-xs text-muted-foreground italic text-center">None found</div>
            : <>
                {followers.map((pk) => <UserItem key={pk} userId={pk} hideFollowButton hideTrustBadge />)}
                {nonScoringFollowers.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-xs text-muted-foreground italic border-t">
                      Doesn't count toward score
                    </div>
                    {nonScoringFollowers.map((pk) => (
                      <UserItem key={pk} userId={pk} hideFollowButton hideTrustBadge />
                    ))}
                  </>
                )}
              </>
        )}
        {tab === 'muters' && (
          muters.length === 0 && nonScoringMuters.length === 0
            ? <div className="px-3 py-4 text-xs text-muted-foreground italic text-center">None found</div>
            : <>
                {muters.map((pk) => <UserItem key={pk} userId={pk} hideFollowButton hideTrustBadge />)}
                {nonScoringMuters.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-xs text-muted-foreground italic border-t">
                      Doesn't count toward score
                    </div>
                    {nonScoringMuters.map((pk) => (
                      <UserItem key={pk} userId={pk} hideFollowButton hideTrustBadge />
                    ))}
                  </>
                )}
              </>
        )}
        {tab === 'inlists' && (
          inListEvents.length === 0
            ? <div className="px-3 py-4 text-xs text-muted-foreground italic text-center">None found</div>
            : inListEvents.map((evt) => <InListEventCard key={evt.id} event={evt} />)
        )}
      </div>
    </div>
  )
}
