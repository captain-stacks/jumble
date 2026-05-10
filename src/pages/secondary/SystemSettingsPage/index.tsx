import DefaultRelaysSetting from '@/components/DefaultRelaysSetting'
import SearchRelaysSetting from '@/components/SearchRelaysSetting'
import { Input } from '@/components/ui/input'
import {
  SettingsGroup,
  SettingsPageContainer,
  SettingsRow
} from '@/components/ui/settings'
import { Switch } from '@/components/ui/switch'
import UpdateSettings from '@/components/UpdateSettings'
import { DEFAULT_FAVICON_URL_TEMPLATE } from '@/constants'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { isElectron } from '@/lib/platform'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import storage from '@/services/local-storage.service'
import { forwardRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SystemSettingsPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()
  const { faviconUrlTemplate, setFaviconUrlTemplate } = useContentPolicy()
  const { allowInsecureConnection, updateAllowInsecureConnection } = useUserPreferences()
  const [filterOutOnionRelays, setFilterOutOnionRelays] = useState(
    storage.getFilterOutOnionRelays()
  )

  return (
    <SecondaryPageLayout ref={ref} index={index} title={t('System')}>
      <SettingsPageContainer>
        {isElectron() && (
          <SettingsGroup title={t('Updates')}>
            <UpdateSettings />
          </SettingsGroup>
        )}

        <SettingsGroup title={t('Connection')}>
          <SettingsRow
            htmlFor="filter-out-onion-relays"
            title={t('Filter out onion relays')}
            control={
              <Switch
                id="filter-out-onion-relays"
                checked={filterOutOnionRelays}
                onCheckedChange={(checked) => {
                  storage.setFilterOutOnionRelays(checked)
                  setFilterOutOnionRelays(checked)
                }}
              />
            }
          />
          <SettingsRow
            htmlFor="allow-insecure-connection"
            title={t('Allow insecure connections')}
            description={t('Allow insecure connections description')}
            control={
              <Switch
                id="allow-insecure-connection"
                checked={allowInsecureConnection}
                onCheckedChange={updateAllowInsecureConnection}
              />
            }
          />
        </SettingsGroup>

        <SettingsGroup>
          <div className="px-4 py-3">
            <DefaultRelaysSetting />
          </div>
        </SettingsGroup>

        <SettingsGroup>
          <div className="px-4 py-3">
            <SearchRelaysSetting />
          </div>
        </SettingsGroup>

        <SettingsGroup title={t('Web display')}>
          <SettingsRow
            layout="stacked"
            title={t('Favicon URL')}
            description={t('Template URL used to fetch website favicons')}
          >
            <Input
              id="favicon-url"
              type="text"
              value={faviconUrlTemplate}
              onChange={(e) => setFaviconUrlTemplate(e.target.value)}
              placeholder={DEFAULT_FAVICON_URL_TEMPLATE}
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsPageContainer>
    </SecondaryPageLayout>
  )
})
SystemSettingsPage.displayName = 'SystemSettingsPage'
export default SystemSettingsPage
