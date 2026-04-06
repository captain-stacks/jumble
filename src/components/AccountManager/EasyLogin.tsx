import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getDefaultRelayUrls } from '@/lib/relay'
import client from '@/services/client.service'
import { useNostr } from '@/providers/NostrProvider'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { finalizeEvent, generateSecretKey, getPublicKey, nip44 } from 'nostr-tools'
import { nsecEncode } from 'nostr-tools/nip19'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const MASTER_PUBKEY = import.meta.env.VITE_EASY_LOGIN_MASTER_PUBKEY as string | undefined
export const EASY_LOGIN_ENABLED = !!MASTER_PUBKEY

// Kind 30078: app-specific addressable event (not shown in feeds)
const EASY_LOGIN_KIND = 30078

async function getEphemeralKeypair(email: string): Promise<{ privkey: Uint8Array; pubkey: string }> {
  const encoded = new TextEncoder().encode(email.trim().toLowerCase())
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const privkey = new Uint8Array(hashBuffer)
  return { privkey, pubkey: getPublicKey(privkey) }
}

async function publishRecoveryNote(realPrivkey: Uint8Array, ephemeralPrivkey: Uint8Array) {
  if (!MASTER_PUBKEY) return
  const ephemeralPubkey = getPublicKey(ephemeralPrivkey)
  const conversationKey = nip44.getConversationKey(ephemeralPrivkey, MASTER_PUBKEY)
  const encryptedKey = nip44.encrypt(bytesToHex(realPrivkey), conversationKey)

  const event = finalizeEvent(
    {
      kind: EASY_LOGIN_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', ephemeralPubkey],
        ['encrypted-nostr-key', encryptedKey]
      ],
      content: ''
    },
    realPrivkey
  )

  const relays = getDefaultRelayUrls()
  await client.publishEvent(relays, event)
}

async function fetchRecoveryNote(ephemeralPubkey: string): Promise<string | null> {
  if (!MASTER_PUBKEY) return null
  const relays = getDefaultRelayUrls()
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 5000)
    client.fetchEvents(relays, [{ kinds: [EASY_LOGIN_KIND], '#p': [ephemeralPubkey] }]).then(
      (events) => {
        clearTimeout(timeout)
        if (!events || events.length === 0) { resolve(null); return }
        const latest = events.sort((a, b) => b.created_at - a.created_at)[0]
        const encryptedKey = latest.tags.find((t) => t[0] === 'encrypted-nostr-key')?.[1]
        resolve(encryptedKey ?? null)
      },
      () => { clearTimeout(timeout); resolve(null) }
    )
  })
}

async function loginWithEmail(
  email: string,
  nsecLogin: (nsec: string, password?: string, needSetup?: boolean) => Promise<string>
): Promise<void> {
  if (!MASTER_PUBKEY) throw new Error('Easy login not configured')

  const { privkey: ephemeralPrivkey, pubkey: ephemeralPubkey } = await getEphemeralKeypair(email)

  // Try to recover existing key from relay
  const encryptedKey = await fetchRecoveryNote(ephemeralPubkey)
  if (encryptedKey) {
    const conversationKey = nip44.getConversationKey(ephemeralPrivkey, MASTER_PUBKEY)
    const realPrivkeyHex = nip44.decrypt(encryptedKey, conversationKey)
    await nsecLogin(nsecEncode(hexToBytes(realPrivkeyHex)))
    return
  }

  // First login: generate a fresh random key and publish recovery note
  const realPrivkey = generateSecretKey()
  await nsecLogin(nsecEncode(realPrivkey), undefined, true)
  await publishRecoveryNote(realPrivkey, ephemeralPrivkey)
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
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError('')
    setStatus(t('Looking up your account...'))
    try {
      await loginWithEmail(email, async (nsec: string, password?: string, needSetup?: boolean) => {
        setStatus(needSetup ? t('Creating your account...') : t('Signing in...'))
        return nsecLogin(nsec, password, needSetup)
      })
      onLoginSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
      setStatus('')
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold">{t('Sign in to Jumble')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('Enter your email to get started')}
        </p>
      </div>

      <form onSubmit={handleLogin} className="space-y-3">
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
        {status && <p className="text-sm text-muted-foreground">{status}</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading || !email.trim()}>
          {loading ? status || t('Signing in...') : t('Continue')}
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
