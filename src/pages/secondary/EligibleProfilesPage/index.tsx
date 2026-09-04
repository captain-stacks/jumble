import ProfileList from '@/components/ProfileList'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { useMuteList } from '@/providers/MuteListProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { forwardRef, useMemo } from 'react'

const EligibleProfilesPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { getEligiblePubkeys } = useUserTrust()
  const { mutePubkeySet } = useMuteList()

  const params = new URLSearchParams(window.location.search)
  const min = parseInt(params.get('min') ?? '0')
  const max = parseInt(params.get('max') ?? '100')

  const pubkeys = useMemo(
    () => getEligiblePubkeys(min, max, mutePubkeySet),
    [getEligiblePubkeys, min, max, mutePubkeySet]
  )

  return (
    <SecondaryPageLayout ref={ref} index={index} title={`Eligible profiles (${pubkeys.length})`}>
      <ProfileList pubkeys={pubkeys} />
    </SecondaryPageLayout>
  )
})
EligibleProfilesPage.displayName = 'EligibleProfilesPage'
export default EligibleProfilesPage
