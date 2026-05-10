import {
  SettingsGroup,
  SettingsPageContainer,
  SettingsRow
} from '@/components/ui/settings'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { useNostr } from '@/providers/NostrProvider'
import { Check, Copy, KeyRound } from 'lucide-react'
import { forwardRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const AccountSettingsPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()
  const { nsec, ncryptsec } = useNostr()
  const [copiedNsec, setCopiedNsec] = useState(false)
  const [copiedNcryptsec, setCopiedNcryptsec] = useState(false)

  const copy = async (value: string, setCopied: (v: boolean) => void) => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <SecondaryPageLayout ref={ref} index={index} title={t('Account')}>
      <SettingsPageContainer>
        {(nsec || ncryptsec) && (
          <SettingsGroup
            title={t('Private key')}
            description={t(
              'Your private key controls your account. Keep it safe and never share it.'
            )}
          >
            {nsec && (
              <SettingsRow
                icon={<KeyRound />}
                title={`${t('Copy private key')} (nsec)`}
                onClick={() => copy(nsec, setCopiedNsec)}
                control={copiedNsec ? <Check className="size-4" /> : <Copy className="size-4" />}
              />
            )}
            {ncryptsec && (
              <SettingsRow
                icon={<KeyRound />}
                title={`${t('Copy private key')} (ncryptsec)`}
                onClick={() => copy(ncryptsec, setCopiedNcryptsec)}
                control={
                  copiedNcryptsec ? <Check className="size-4" /> : <Copy className="size-4" />
                }
              />
            )}
          </SettingsGroup>
        )}
      </SettingsPageContainer>
    </SecondaryPageLayout>
  )
})
AccountSettingsPage.displayName = 'AccountSettingsPage'
export default AccountSettingsPage
