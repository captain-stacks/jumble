import { Button } from '@/components/ui/button'
import { describePomegranateError } from '@/lib/pomegranate'
import { useNostr } from '@/providers/NostrProvider'
import pomegranateService from '@/services/pomegranate.service'
import { Loader } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PomegranateHowItWorks from '../PomegranateHowItWorks'

type Status = 'idle' | 'authenticating' | 'checking' | 'creating' | 'loggingIn' | 'error'

// The bunker (remote signer) connection can stall on a flaky network, so retry
// it automatically a few times before suggesting the user try again later.
const MAX_BUNKER_RETRIES = 3

export default function GoogleLogin({
  back,
  onLoginSuccess
}: {
  back: () => void
  onLoginSuccess: () => void
}) {
  const { t } = useTranslation()
  const { bunkerLogin } = useNostr()
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  // 0 = first attempt; 1..MAX = the current automatic retry, shown as N/3.
  const [retryAttempt, setRetryAttempt] = useState(0)
  const bunkerCtxRef = useRef<{ bunkerUrl: string; central: string } | null>(null)

  const busy = status !== 'idle' && status !== 'error'

  // Final step: connect to the remote signer, retrying automatically so a
  // stalled connection does not force the user back through the Google popup.
  const runBunkerLogin = async () => {
    const ctx = bunkerCtxRef.current
    if (!ctx) return
    for (let attempt = 0; attempt <= MAX_BUNKER_RETRIES; attempt++) {
      setRetryAttempt(attempt)
      setStatus('loggingIn')
      try {
        await bunkerLogin(ctx.bunkerUrl, ctx.central)
        onLoginSuccess()
        return
      } catch {
        // keep retrying until the attempts run out
      }
    }
    setStatus('error')
    setErrorMsg(
      t(
        'Could not reach the remote signer. Please try again later or check your network connection.'
      )
    )
  }

  const handleLogin = async () => {
    setErrorMsg('')
    setRetryAttempt(0)
    bunkerCtxRef.current = null
    setStatus('authenticating')
    try {
      const ctx = await pomegranateService.loginFlow((s) => setStatus(s))
      bunkerCtxRef.current = ctx
      await runBunkerLogin()
    } catch (err) {
      const msg = describePomegranateError(err, t)
      if (!msg) {
        setStatus('idle')
        return
      }
      setStatus('error')
      setErrorMsg(msg)
    }
  }

  const statusText: Record<'authenticating' | 'checking' | 'creating', string> = {
    authenticating: t('Waiting for Google sign-in...'),
    checking: t('Checking your account...'),
    creating: t('Setting up your secure account...')
  }

  const busyText =
    status === 'loggingIn'
      ? retryAttempt > 0
        ? t('Retrying ({{current}}/{{max}})', { current: retryAttempt, max: MAX_BUNKER_RETRIES })
        : t('Logging in...')
      : statusText[status as 'authenticating' | 'checking' | 'creating']

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="mb-2 text-lg font-semibold">{t('Login with Google')}</h3>
        <p className="text-muted-foreground text-sm">
          {t(
            "Sign in with Google to access your account. If you don't have one yet, a Nostr account is created for you automatically."
          )}
        </p>
      </div>

      <PomegranateHowItWorks />

      {busy ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-4 text-sm">
          <Loader className="size-4 animate-spin" />
          {busyText}
        </div>
      ) : (
        status === 'error' && <p className="text-destructive text-center text-sm">{errorMsg}</p>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={back} className="w-fit px-6" disabled={busy}>
          {t('Back')}
        </Button>
        <Button onClick={handleLogin} className="flex-1" disabled={busy}>
          {status === 'error' ? t('Try again') : t('Continue with Google')}
        </Button>
      </div>
    </div>
  )
}
