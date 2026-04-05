import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useNostr } from '@/providers/NostrProvider'
import { nip44 } from 'nostr-tools'
import { nsecEncode } from 'nostr-tools/nip19'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const MASTER_PUBKEY = import.meta.env.VITE_EASY_LOGIN_MASTER_PUBKEY as string | undefined
export const EASY_LOGIN_ENABLED = !!MASTER_PUBKEY

async function emailToNsec(email: string): Promise<string> {
  if (!MASTER_PUBKEY) throw new Error('Easy login is not configured (missing VITE_EASY_LOGIN_MASTER_PUBKEY)')
  const normalized = email.trim().toLowerCase()
  // Step 1: hash email to get a deterministic ephemeral private key
  const encoded = new TextEncoder().encode(`nostr:easy-login:${normalized}`)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const ephemeralPrivkey = new Uint8Array(hashBuffer)
  // Step 2: ECDH with master pubkey → conversation key becomes the actual private key
  // getConversationKey expects pubkey as hex string
  const sk = nip44.getConversationKey(ephemeralPrivkey, MASTER_PUBKEY)
  return nsecEncode(sk)
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
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      const nsec = await emailToNsec(email)
      await nsecLogin(nsec)
      onLoginSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
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
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading || !email.trim()}>
          {loading ? t('Signing in...') : t('Continue')}
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
