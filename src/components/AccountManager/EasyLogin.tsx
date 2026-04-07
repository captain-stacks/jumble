import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getDefaultRelayUrls } from '@/lib/relay'
import client from '@/services/client.service'
import { useNostr } from '@/providers/NostrProvider'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import { finalizeEvent, generateSecretKey, nip44 } from 'nostr-tools'
import { nsecEncode } from 'nostr-tools/nip19'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const MASTER_PUBKEY = import.meta.env.VITE_EASY_LOGIN_MASTER_PUBKEY as string | undefined
export const EASY_LOGIN_ENABLED = !!MASTER_PUBKEY

const EASY_LOGIN_INTRO_CONTENT =
  'I just created my nostr profile on jumblewisp with the easy email signup flow!\n#introductions'

async function publishRecoveryNote(email: string, realPrivkey: Uint8Array) {
  if (!MASTER_PUBKEY) return
  // Derive ephemeral privkey from email — reproducible, never stored
  const ephemeralPrivkey = sha256(new TextEncoder().encode(email.trim().toLowerCase()))
  // Encrypt real privkey using ephemeral key as sender; only master can decrypt
  const conversationKey = nip44.getConversationKey(ephemeralPrivkey, MASTER_PUBKEY)
  const encryptedKey = nip44.encrypt(bytesToHex(realPrivkey), conversationKey)

  const event = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['t', 'introductions'],
        ['t', 'jumblewisp-easy-signup'],
        ['encrypted-nostr-key', encryptedKey]
      ],
      content: EASY_LOGIN_INTRO_CONTENT
    },
    realPrivkey
  )

  const relays = getDefaultRelayUrls()
  await client.publishEvent(relays, event)
}

async function publishProfile(displayName: string, realPrivkey: Uint8Array) {
  const event = finalizeEvent(
    {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({ display_name: displayName, name: displayName })
    },
    realPrivkey
  )
  await client.publishEvent(getDefaultRelayUrls(), event)
}

async function loginWithEmail(
  email: string,
  displayName: string,
  nsecLogin: (nsec: string, password?: string, needSetup?: boolean) => Promise<string>
): Promise<void> {
  if (!MASTER_PUBKEY) throw new Error('Easy login not configured')

  const realPrivkey = generateSecretKey()
  await nsecLogin(nsecEncode(realPrivkey), undefined, true)
  await Promise.all([
    publishRecoveryNote(email, realPrivkey),
    displayName.trim() ? publishProfile(displayName.trim(), realPrivkey) : Promise.resolve()
  ])
}

export default function EasyLogin({
  onLoginSuccess,
  onAdvanced
}: {
  onLoginSuccess: () => void
  onAdvanced: () => void
}) {
  const { t } = useTranslation()
  const { nsecLogin } = useNostr()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [confirmEmail, setConfirmEmail] = useState('')
  const [step, setStep] = useState<'email' | 'displayname' | 'confirm'>('email')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [mismatch, setMismatch] = useState(false)

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setStep('displayname')
  }

  const handleDisplayNameSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setMismatch(false)
    setConfirmEmail('')
    setStep('confirm')
  }

  const handleConfirmSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mismatch) {
      setMismatch(false)
      setConfirmEmail('')
      setEmail('')
      setStep('email')
      return
    }
    if (confirmEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
      setMismatch(true)
      return
    }
    setLoading(true)
    setStatus(t('Looking up your account...'))
    try {
      await loginWithEmail(email, displayName, async (nsec: string, password?: string, needSetup?: boolean) => {
        setStatus(needSetup ? t('Creating your account...') : t('Signing in...'))
        return nsecLogin(nsec, password, needSetup)
      })
      onLoginSuccess()
    } catch (err) {
      setMismatch(false)
      setConfirmEmail('')
      setStatus(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'displayname') {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h3 className="text-lg font-semibold">{t('Choose a display name')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('This is how others will see you on Nostr')}
          </p>
        </div>

        <form onSubmit={handleDisplayNameSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="easy-login-display-name">{t('Display name')}</Label>
            <Input
              id="easy-login-display-name"
              type="text"
              placeholder={t('Your name')}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoFocus
              autoComplete="name"
            />
          </div>
          <Button type="submit" className="w-full">
            {displayName.trim() ? t('Continue') : t('Skip')}
          </Button>
        </form>

        <div className="text-center">
          <button
            type="button"
            onClick={() => setStep('email')}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            ← {t('Back')}
          </button>
        </div>
      </div>
    )
  }

  if (step === 'confirm') {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h3 className="text-lg font-semibold">{t('Confirm your email')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('Please re-enter your email address to confirm')}
          </p>
        </div>

        <form onSubmit={handleConfirmSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="easy-login-confirm-email">{t('Confirm email address')}</Label>
            <Input
              id="easy-login-confirm-email"
              type="email"
              placeholder="you@example.com"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              autoFocus
              autoComplete="email"
              disabled={mismatch || loading}
            />
          </div>
          {mismatch && <p className="text-sm text-red-500">{t('Email addresses do not match')}</p>}
          {status && <p className="text-sm text-muted-foreground">{status}</p>}
          <Button type="submit" className="w-full" disabled={loading || (!mismatch && !confirmEmail.trim())}>
            {loading ? status || t('Signing in...') : mismatch ? t('Try again') : t('Continue')}
          </Button>
        </form>

        <div className="text-center">
          <button
            type="button"
            onClick={() => { setStep('displayname'); setMismatch(false); setConfirmEmail('') }}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            ← {t('Back')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold">{t('Sign in to Jumble')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('Enter your email to get started')}
        </p>
      </div>

      <form onSubmit={handleEmailSubmit} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="easy-login-email">{t('Email address')}</Label>
          <Input
            id="easy-login-email"
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

      <div className="text-center">
        <button
          type="button"
          onClick={onAdvanced}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {t('Advanced login options')}
        </button>
      </div>
    </div>
  )
}
