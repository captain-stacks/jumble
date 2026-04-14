import ProfileList from '@/components/ProfileList'
import { Button } from '@/components/ui/button'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { Loader, LockKeyhole } from 'lucide-react'
import { forwardRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import NotFoundPage from '../NotFoundPage'

const MuteListPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()
  const { profile, pubkey: accountPubkey } = useNostr()
  const { getMutePubkeys, makeAllPrivate, changing, getMuteType } = useMuteList()
  const mutePubkeys = useMemo(() => getMutePubkeys(), [accountPubkey])
  const hasPublicMutes = useMemo(
    () => mutePubkeys.some((pk) => getMuteType(pk) === 'public'),
    [mutePubkeys, getMuteType]
  )

  if (!profile) {
    return <NotFoundPage />
  }

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={t("username's muted", { username: profile.username })}
      displayScrollToTopButton
    >
      {hasPublicMutes && (
        <div className="flex flex-wrap gap-2 px-4 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={changing}
            onClick={makeAllPrivate}
          >
            {changing ? <Loader className="animate-spin" /> : <LockKeyhole />}
            {t('Make all private')}
          </Button>
        </div>
      )}
      <ProfileList pubkeys={mutePubkeys} showBulkActions showMuteButton />
    </SecondaryPageLayout>
  )
})
MuteListPage.displayName = 'MuteListPage'
export default MuteListPage
