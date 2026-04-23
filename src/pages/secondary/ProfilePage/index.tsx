import Profile from '@/components/Profile'
import { useFetchProfile } from '@/hooks'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { forwardRef, useEffect } from 'react'

const ProfilePage = forwardRef(({ id, index }: { id?: string; index?: number }, ref) => {
  const { profile } = useFetchProfile(id)
  const { setInspectedPubkey } = useUserTrust()

  useEffect(() => {
    if (profile?.pubkey) setInspectedPubkey(profile.pubkey)
    return () => setInspectedPubkey(null)
  }, [profile?.pubkey, setInspectedPubkey])

  return (
    <SecondaryPageLayout index={index} title={profile?.username} displayScrollToTopButton ref={ref}>
      <Profile id={id} />
    </SecondaryPageLayout>
  )
})
ProfilePage.displayName = 'ProfilePage'
export default ProfilePage
