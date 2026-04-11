import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getDefaultRelayUrls } from '@/lib/relay'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import client from '@/services/client.service'
import { useNostr } from '@/providers/NostrProvider'
import { bytesToHex } from '@noble/hashes/utils'
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, nip44 } from 'nostr-tools'
import { forwardRef, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const MASTER_PUBKEY = import.meta.env.VITE_EASY_LOGIN_MASTER_PUBKEY as string | undefined

export default forwardRef(function ChangeRecoveryEmailPage(
  { index }: { index?: number },
  ref
) {
  const { t } = useTranslation()
  const { nsec, pubkey } = useNostr()
  const [hasExisting, setHasExisting] = useState<boolean | null>(null)
  const [email, setEmail] = useState('')
  const [confirm, setConfirm] = useState('')
  const [step, setStep] = useState<'email' | 'confirm'>('email')
  const [mismatch, setMismatch] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!pubkey || !MASTER_PUBKEY) return
    client
      .fetchEvents(getDefaultRelayUrls(), [
        {
          kinds: [30078],
          authors: [pubkey],
          '#d': ['jumblewisp-recovery-key'],
          '#m': [MASTER_PUBKEY],
          limit: 1
        }
      ])
      .then((events) => setHasExisting(events.length > 0))
      .catch(() => setHasExisting(false))
  }, [pubkey])

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
      const decoded = nip19.decode(nsec)
      if (decoded.type !== 'nsec') throw new Error('Invalid key')
      const privkey = decoded.data

      // encryptionPrivkey: random throwaway — encrypts both email and nsec, then discarded
      const encryptionPrivkey = generateSecretKey()
      const encryptionPubkey = getPublicKey(encryptionPrivkey)
      const conversationKey = nip44.getConversationKey(encryptionPrivkey, MASTER_PUBKEY)

      const encryptedEmail = nip44.encrypt(email.trim().toLowerCase(), conversationKey)
      const encryptedKey = nip44.encrypt(bytesToHex(privkey), conversationKey)

      const event = finalizeEvent(
        {
          kind: 30078,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['d', 'jumblewisp-recovery-key'],
            ['m', MASTER_PUBKEY],
            ['encryption-pubkey', encryptionPubkey],
            ['encrypted-email', encryptedEmail]
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

  const isChanging = hasExisting === true
  const title = hasExisting === null ? '' : isChanging ? t('Change recovery email') : t('Set up recovery email')

  return (
    <SecondaryPageLayout ref={ref} index={index} title={title}>
      <div className="space-y-6 p-4">
        {success ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {isChanging ? t('Recovery email updated') : t('Recovery email set up')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('Your account can now be recovered using this email address.')}
            </p>
          </div>
        ) : step === 'email' ? (
          <>
            <p className="text-sm text-muted-foreground">
              {isChanging
                ? t(
                    'Enter a new email address for account recovery. Your current recovery email will no longer work after this change. For privacy reasons, we cannot display what email is currently set.'
                  )
                : t(
                    'Enter an email address to use for account recovery. If you ever lose access, this email will allow the account administrator to recover your private key.'
                  )}
            </p>
            <form onSubmit={handleEmailSubmit} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="recovery-new-email">
                  {isChanging ? t('New email address') : t('Email address')}
                </Label>
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
                {loading ? t('Saving...') : mismatch ? t('Try again') : t('Save')}
              </Button>
            </form>
            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setStep('email')
                  setMismatch(false)
                  setConfirm('')
                }}
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
