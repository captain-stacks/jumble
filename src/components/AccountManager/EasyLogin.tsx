import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useNostr } from '@/providers/NostrProvider'
import { nsecEncode } from 'nostr-tools/nip19'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

async function emailToNsec(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase()
  const encoded = new TextEncoder().encode(`nostr:easy-login:${normalized}`)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const sk = new Uint8Array(hashBuffer)
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
