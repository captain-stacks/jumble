import { Button } from '@/components/ui/button'
import { describePomegranateError } from '@/lib/pomegranate'
import { useNostr } from '@/providers/NostrProvider'
import pomegranateService from '@/services/pomegranate.service'
import { Loader } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import PomegranateHowItWorks from '../PomegranateHowItWorks'

type Status = 'idle' | 'authenticating' | 'checking' | 'creating' | 'loggingIn' | 'error'

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

  const busy = status !== 'idle' && status !== 'error'

  const handleLogin = async () => {
    setErrorMsg('')
    setStatus('authenticating')
    try {
      const { bunkerUrl, central } = await pomegranateService.loginFlow((s) => setStatus(s))
      setStatus('loggingIn')
      await bunkerLogin(bunkerUrl, central)
      onLoginSuccess()
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

  const statusText: Record<Exclude<Status, 'idle' | 'error'>, string> = {
    authenticating: t('Waiting for Google sign-in...'),
    checking: t('Checking your account...'),
    creating: t('Setting up your secure account...'),
    loggingIn: t('Logging in...')
  }

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
          {statusText[status as Exclude<Status, 'idle' | 'error'>]}
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
