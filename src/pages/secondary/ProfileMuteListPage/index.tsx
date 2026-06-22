import FollowButton from '@/components/FollowButton'
import MuteButton from '@/components/MuteButton'
import UserItem from '@/components/UserItem'
import { useFetchProfile } from '@/hooks'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { useUserTrust } from '@/providers/UserTrustProvider'
import client from '@/services/client.service'
import { Event } from 'nostr-tools'
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const ProfileMuteListPage = forwardRef(
  ({ pubkey, index }: { pubkey?: string; index?: number }, ref) => {
    const { t } = useTranslation()
    const { profile } = useFetchProfile(pubkey)
    const { computeTrustScore, wotReady } = useUserTrust()
    const [rawMutePubkeys, setRawMutePubkeys] = useState<string[]>([])
    const [visiblePubkeys, setVisiblePubkeys] = useState<string[]>([])
    const bottomRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      if (!pubkey) return
      client.fetchMuteListEvent(pubkey).then((event: Event | null) => {
        if (!event) return
        const pubkeys = event.tags
          .filter((tag) => tag[0] === 'p' && tag[1])
          .map((tag) => tag[1])
        setRawMutePubkeys([...new Set(pubkeys)])
      })
    }, [pubkey])

    const mutePubkeys = useMemo(
      () => [...rawMutePubkeys].sort((a, b) => computeTrustScore(a) - computeTrustScore(b)),
      [rawMutePubkeys, wotReady, computeTrustScore]
    )

    useEffect(() => {
      setVisiblePubkeys(mutePubkeys.slice(0, 10))
    }, [mutePubkeys])

    useEffect(() => {
      const options = { root: null, rootMargin: '10px', threshold: 1 }
      const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && mutePubkeys.length > visiblePubkeys.length) {
          setVisiblePubkeys((prev) => [
            ...prev,
            ...mutePubkeys.slice(prev.length, prev.length + 10)
          ])
        }
      }, options)
      const el = bottomRef.current
      if (el) observer.observe(el)
      return () => { if (el) observer.unobserve(el) }
    }, [visiblePubkeys, mutePubkeys])

    return (
      <SecondaryPageLayout
        ref={ref}
        index={index}
        title={
          profile?.username
            ? t("username's muted", { username: profile.username })
            : t('Muted')
        }
        displayScrollToTopButton
      >
        <div className="space-y-0 px-4">
          {visiblePubkeys.map((pk) => (
            <div key={pk} className="flex items-center gap-2">
              <UserItem userId={pk} hideFollowButton className="flex-1 min-w-0" />
              <MuteButton pubkey={pk} />
              <FollowButton pubkey={pk} />
            </div>
          ))}
          {mutePubkeys.length > visiblePubkeys.length && <div ref={bottomRef} />}
        </div>
      </SecondaryPageLayout>
    )
  }
)
ProfileMuteListPage.displayName = 'ProfileMuteListPage'
export default ProfileMuteListPage
