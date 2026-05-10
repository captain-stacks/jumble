import {
  SettingsGroup,
  SettingsPageContainer
} from '@/components/ui/settings'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { useMediaUploadService } from '@/providers/MediaUploadServiceProvider'
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import BlossomServerListSetting from './BlossomServerListSetting'
import MediaUploadServiceSetting from './MediaUploadServiceSetting'

const PostSettingsPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()
  const { serviceConfig } = useMediaUploadService()
  const isBlossom = serviceConfig.type === 'blossom'

  return (
    <SecondaryPageLayout ref={ref} index={index} title={t('Post settings')}>
      <SettingsPageContainer>
        <SettingsGroup title={t('Media upload')}>
          <MediaUploadServiceSetting />
        </SettingsGroup>
        {isBlossom && (
          <SettingsGroup>
            <div className="px-4 py-3">
              <BlossomServerListSetting />
            </div>
          </SettingsGroup>
        )}
      </SettingsPageContainer>
    </SecondaryPageLayout>
  )
})
PostSettingsPage.displayName = 'PostSettingsPage'
export default PostSettingsPage
