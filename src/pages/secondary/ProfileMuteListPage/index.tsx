import ProfileList from '@/components/ProfileList'
import { useFetchProfile } from '@/hooks'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { useUserTrust } from '@/providers/UserTrustProvider'
import client from '@/services/client.service'
import { Event } from 'nostr-tools'
import { forwardRef, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const ProfileMuteListPage = forwardRef(
  ({ pubkey, index }: { pubkey?: string; index?: number }, ref) => {
    const { t } = useTranslation()
    const { profile } = useFetchProfile(pubkey)
    const { computeTrustScore, wotReady } = useUserTrust()
    const [rawMutePubkeys, setRawMutePubkeys] = useState<string[]>([])

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
        <ProfileList pubkeys={mutePubkeys} />
      </SecondaryPageLayout>
    )
  }
)
ProfileMuteListPage.displayName = 'ProfileMuteListPage'
export default ProfileMuteListPage
