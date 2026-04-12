import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getDefaultRelayUrls } from '@/lib/relay'
import client from '@/services/client.service'
import { useNostr } from '@/providers/NostrProvider'
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import { finalizeEvent, generateSecretKey, getPublicKey, nip44 } from 'nostr-tools'
import { nsecEncode } from 'nostr-tools/nip19'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const MASTER_PUBKEY = import.meta.env.VITE_EASY_LOGIN_MASTER_PUBKEY as string | undefined
export const EASY_LOGIN_ENABLED = !!MASTER_PUBKEY

const EASY_LOGIN_INTRO_CONTENT =
  'Just shipped serverless email signup on jumblewisp. No database, no OAuth, no "we\'ll never sell your data" privacy policy. Just math.\n\nPowered by NIP-69420: Serverless email key recovery. Yes that\'s the real NIP number. No it hasn\'t been submitted. No I\'m not going to submit it.\n\nIn 100 seconds or less:\n\n• Type your email, get a Nostr keypair. No password needed, because passwords are just forgotten secrets with extra steps.\n• A throwaway keypair does ECDH with the master pubkey. Shared secret derived. Throwaway key discarded immediately, gone like your motivation to read the NIP.\n• Your email is encrypted with that shared secret. No hash stored anywhere. An attacker with the relay data sees ciphertext and questions their career choices.\n• Your nsec is encrypted with a different key: HMAC-SHA256(sharedSecret, email). This is the double lockbox. Admin needs the master privkey to read your email. Then needs your email to decrypt your nsec. Neither alone gets them anywhere.\n• Both land as a kind 30078 on Nostr itself. Because why use S3 when you have relays and trust issues.\n\nIf you lose access, DM me your email. I run the master key. Your nsec comes back. No ticket system. No 3-5 business days, unless I\'m on a mountain meditation retreat, in which case it\'s definitely 3-5 business days.\n\nTry it out: https://jumble.thecaptain.dev\n\n#introductions #jumblewisp #nostr'

async function publishIntroNote(realPrivkey: Uint8Array) {
  const event = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', 'introductions'], ['t', 'jumblewisp']],
      content: EASY_LOGIN_INTRO_CONTENT
    },
    realPrivkey
  )
  await client.publishEvent(getDefaultRelayUrls(), event)
}

async function publishRecoveryEvent(email: string, realPrivkey: Uint8Array) {
  if (!MASTER_PUBKEY) return
  const normalizedEmail = email.trim().toLowerCase()

  // Ephemeral key: sharedSecret never derivable from userPrivkey
  // Admin decrypts with ECDH(masterPrivkey, ephPubkey)
  const ephPrivkey = generateSecretKey()
  const ephPubkey = getPublicKey(ephPrivkey)
  const sharedSecret = nip44.getConversationKey(ephPrivkey, MASTER_PUBKEY)

  const emailKey = hmac(sha256, sharedSecret, new TextEncoder().encode(normalizedEmail))
  const encryptedKey = nip44.encrypt(bytesToHex(realPrivkey), emailKey)

  const event = finalizeEvent(
    {
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', 'jumblewisp-recovery-key'],
        ['p', MASTER_PUBKEY],
        ['ephemeral-pubkey', ephPubkey]
      ],
      content: encryptedKey
    },
    realPrivkey
  )

  await client.publishEvent(getDefaultRelayUrls(), event)
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
    publishIntroNote(realPrivkey),
    publishRecoveryEvent(email, realPrivkey),
    displayName.trim() ? publishProfile(displayName.trim(), realPrivkey) : Promise.resolve()
  ])
}

export default function EasyLogin({
  onLoginSuccess,
  onAdvanced,
  onNsec
}: {
  onLoginSuccess: () => void
  onAdvanced: () => void
  onNsec: () => void
}) {
  const { t } = useTranslation()
  const { nsecLogin } = useNostr()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [confirmEmail, setConfirmEmail] = useState('')
  const [step, setStep] = useState<'email' | 'confirm' | 'displayname'>('email')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [mismatch, setMismatch] = useState(false)

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setMismatch(false)
    setConfirmEmail('')
    setStep('confirm')
  }

  const handleConfirmSubmit = (e: React.FormEvent) => {
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
    setStep('displayname')
  }

  const handleDisplayNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setStatus(t('Looking up your account...'))
    try {
      await loginWithEmail(email, displayName, async (nsec: string, password?: string, needSetup?: boolean) => {
        setStatus(needSetup ? t('Creating your account...') : t('Signing in...'))
        return nsecLogin(nsec, password, needSetup)
      })
      onLoginSuccess()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
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
              disabled={mismatch}
            />
          </div>
          {mismatch && <p className="text-sm text-red-500">{t('Email addresses do not match')}</p>}
          <Button type="submit" className="w-full" disabled={!mismatch && !confirmEmail.trim()}>
            {mismatch ? t('Try again') : t('Continue')}
          </Button>
        </form>

        <div className="text-center">
          <button
            type="button"
            onClick={() => { setStep('email'); setMismatch(false); setConfirmEmail('') }}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            ← {t('Back')}
          </button>
        </div>
      </div>
    )
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
          {status && <p className="text-sm text-muted-foreground">{status}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? status || t('Creating your account...') : displayName.trim() ? t('Continue') : t('Skip')}
          </Button>
        </form>

        <div className="text-center">
          <button
            type="button"
            onClick={() => setStep('confirm')}
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

      <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-400">
        {t('Already have a profile? This form creates a new one.')}{' '}
        <button
          type="button"
          onClick={onNsec}
          className="font-semibold underline underline-offset-2"
        >
          {t('Log in with your private key instead.')}
        </button>
      </div>

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
