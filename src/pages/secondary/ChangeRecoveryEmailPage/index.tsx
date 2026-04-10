import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getDefaultRelayUrls } from '@/lib/relay'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import client from '@/services/client.service'
import { useNostr } from '@/providers/NostrProvider'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import { finalizeEvent, nip19, nip44 } from 'nostr-tools'
import { forwardRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const MASTER_PUBKEY = import.meta.env.VITE_EASY_LOGIN_MASTER_PUBKEY as string | undefined

export default forwardRef(function ChangeRecoveryEmailPage(
  { index }: { index?: number },
  ref
) {
  const { t } = useTranslation()
  const { nsec } = useNostr()
  const [email, setEmail] = useState('')
  const [confirm, setConfirm] = useState('')
  const [step, setStep] = useState<'email' | 'confirm'>('email')
  const [mismatch, setMismatch] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setMismatch(false)
    setConfirm('')
    setStep('confirm')
  }

  const handleConfirmSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mismatch) {
      setMismatch(false)
      setConfirm('')
      setEmail('')
      setStep('email')
      return
    }
    if (confirm.trim().toLowerCase() !== email.trim().toLowerCase()) {
      setMismatch(true)
      return
    }
    if (!nsec || !MASTER_PUBKEY) return

    setLoading(true)
    setError('')
    try {
      const { data: privkey } = nip19.decode(nsec) as { data: Uint8Array }
      const ephemeralPrivkey = sha256(new TextEncoder().encode(email.trim().toLowerCase()))
      const conversationKey = nip44.getConversationKey(ephemeralPrivkey, MASTER_PUBKEY)
      const encryptedKey = nip44.encrypt(bytesToHex(privkey), conversationKey)

      const event = finalizeEvent(
        {
          kind: 30078,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['d', 'jumblewisp-recovery-key'],
            ['m', MASTER_PUBKEY]
          ],
          content: encryptedKey
        },
        privkey
      )

      await client.publishEvent(getDefaultRelayUrls(), event)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update recovery email')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SecondaryPageLayout ref={ref} index={index} title={t('Change recovery email')}>
      <div className="space-y-6 p-4">
        {success ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('Recovery email updated')}</p>
            <p className="text-sm text-muted-foreground">
              {t('Your account can now be recovered using the new email address.')}
            </p>
          </div>
        ) : step === 'email' ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t('Enter a new email address to use for account recovery.')}
            </p>
            <form onSubmit={handleEmailSubmit} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="recovery-new-email">{t('New email address')}</Label>
                <Input
                  id="recovery-new-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                  autoComplete="email"
                />
              </div>
              <Button type="submit" className="w-full" disabled={!email.trim()}>
                {t('Continue')}
              </Button>
            </form>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {t('Please re-enter your email address to confirm.')}
            </p>
            <form onSubmit={handleConfirmSubmit} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="recovery-confirm-email">{t('Confirm email address')}</Label>
                <Input
                  id="recovery-confirm-email"
                  type="email"
                  placeholder="you@example.com"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoFocus
                  autoComplete="email"
                  disabled={mismatch || loading}
                />
              </div>
              {mismatch && (
                <p className="text-sm text-red-500">{t('Email addresses do not match')}</p>
              )}
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button
                type="submit"
                className="w-full"
                disabled={loading || (!mismatch && !confirm.trim())}
              >
                {loading
                  ? t('Saving...')
                  : mismatch
                    ? t('Try again')
                    : t('Save')}
              </Button>
            </form>
            <div className="text-center">
              <button
                type="button"
                onClick={() => { setStep('email'); setMismatch(false); setConfirm('') }}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                ← {t('Back')}
              </button>
            </div>
          </>
        )}
      </div>
    </SecondaryPageLayout>
  )
})
