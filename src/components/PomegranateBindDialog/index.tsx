import ResponsiveDialog from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { describePomegranateError } from '@/lib/pomegranate'
import { useNostr } from '@/providers/NostrProvider'
import pomegranateService, {
  TGoogleToken,
  TPomegranateAccount
} from '@/services/pomegranate.service'
import { TSignerType } from '@/types'
import { Loader } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import InfoCard from '../InfoCard'
import PomegranateHowItWorks from '../PomegranateHowItWorks'

type Phase = 'intro' | 'conflict' | 'replace' | 'done'
type Status = 'idle' | 'authenticating' | 'binding' | 'loggingIn' | 'error'

export default function PomegranateBindDialog({
  open,
  onOpenChange,
  central,
  pubkey,
  signerType
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  central: string
  pubkey: string
  signerType: TSignerType
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <PomegranateBindContent
        open={open}
        central={central}
        pubkey={pubkey}
        signerType={signerType}
        onClose={() => onOpenChange(false)}
      />
    </ResponsiveDialog>
  )
}

function PomegranateBindContent({
  open,
  central,
  pubkey,
  signerType,
  onClose
}: {
  open: boolean
  central: string
  pubkey: string
  signerType: TSignerType
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { getActivePrivkey, bunkerLogin, nsecLogin, removeAccount } = useNostr()
  const [phase, setPhase] = useState<Phase>('intro')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [token, setToken] = useState<TGoogleToken | null>(null)
  const [existing, setExisting] = useState<TPomegranateAccount | null>(null)
  const [bindResult, setBindResult] = useState<{ bunkerUrl: string; central: string } | null>(null)
  const [replaced, setReplaced] = useState(false)

  useEffect(() => {
    if (open) {
      setPhase('intro')
      setStatus('idle')
      setErrorMsg('')
      setToken(null)
      setExisting(null)
      setBindResult(null)
      setReplaced(false)
    }
  }, [open])

  const busy = status === 'authenticating' || status === 'binding' || status === 'loggingIn'

  const statusText: Record<'authenticating' | 'binding' | 'loggingIn', string> = {
    authenticating: t('Waiting for Google sign-in...'),
    binding: t('Linking your account...'),
    loggingIn: t('Switching to remote signer...')
  }

  // Step 1 (user gesture): sign in with Google and check for an existing link.
  const handleStart = async () => {
    setErrorMsg('')
    setStatus('authenticating')
    try {
      const result = await pomegranateService.authenticateForBinding(central)
      setToken(result.token)
      setExisting(result.existing)
      if (result.existing && result.existing.pubkey !== pubkey) {
        // This Google account is already linked to a different key.
        setStatus('idle')
        setPhase('conflict')
        return
      }
      await runBinding(result.token, false)
    } catch (err) {
      handleError(err)
    }
  }

  // Step 2 (no popup): register the existing key's shards and ensure a profile.
  const runBinding = async (googleToken: TGoogleToken, rebind: boolean) => {
    setErrorMsg('')
    setStatus('binding')
    setPhase('intro')
    try {
      const privkey = getActivePrivkey()
      if (!privkey) {
        throw new Error('Private key is not available')
      }
      const result = await pomegranateService.completeBinding(
        central,
        googleToken,
        privkey,
        pubkey,
        { rebind }
      )
      setBindResult(result)
      setStatus('idle')
      setPhase('replace')
    } catch (err) {
      handleError(err)
    }
  }

  const handleRebind = () => {
    if (token) runBinding(token, true)
  }

  // Step 3 (optional): swap the local key login for the bunker (remote signer).
  // Remove the old local account FIRST so bunkerLogin writes the bunker client
  // secret last (both accounts share the pubkey, and removeAccount clears
  // per-pubkey secrets). Keep the nsec to restore login if bunkerLogin fails.
  const handleReplace = async () => {
    if (!bindResult) return
    setErrorMsg('')
    setStatus('loggingIn')
    const privkey = getActivePrivkey()
    const nsecBackup = privkey ? nip19.nsecEncode(privkey) : null
    removeAccount({ pubkey, signerType })
    try {
      await bunkerLogin(bindResult.bunkerUrl, bindResult.central)
      setReplaced(true)
      setStatus('idle')
      setPhase('done')
    } catch (err) {
      if (nsecBackup) {
        try {
          await nsecLogin(nsecBackup)
        } catch {
          // ignore; surface the original error below
        }
      }
      const msg = describePomegranateError(err, t)
      setStatus('error')
      setErrorMsg(msg || t('Something went wrong'))
    }
  }

  const handleKeepLocal = () => {
    setReplaced(false)
    setPhase('done')
  }

  const handleError = (err: unknown) => {
    const msg = describePomegranateError(err, t)
    if (!msg) {
      // The user simply closed the popup; reset quietly.
      setStatus('idle')
      return
    }
    setStatus('error')
    setErrorMsg(msg)
  }

  if (phase === 'done') {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h3 className="mb-2 text-lg font-semibold">{t('Google account linked')}</h3>
        </div>
        <InfoCard
          variant="success"
          title={t('What happens next')}
          content={
            replaced
              ? t(
                  'This account now signs through a secure remote signer, and you can sign in with Google anytime. Your private key is never shared with Google.'
                )
              : t(
                  'You can now sign in to this account with Google. You are still signing locally with your private key, which is never shared with Google.'
                )
          }
        />
        <Button onClick={onClose} className="w-full">
          {t('Done')}
        </Button>
      </div>
    )
  }

  if (phase === 'replace') {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h3 className="mb-2 text-lg font-semibold">{t('Switch to remote signer login?')}</h3>
          <p className="text-muted-foreground text-sm">
            {t(
              'Your account is now linked. You can switch to signing through the remote signer, or keep signing locally with your private key.'
            )}
          </p>
        </div>
        {errorMsg && <p className="text-destructive text-center text-sm">{errorMsg}</p>}
        {busy ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-4 text-sm">
            <Loader className="size-4 animate-spin" />
            {statusText.loggingIn}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button onClick={handleReplace} className="w-full">
              {t('Switch to remote signer')}
            </Button>
            <Button variant="secondary" onClick={handleKeepLocal} className="w-full">
              {t('Keep signing locally')}
            </Button>
          </div>
        )}
      </div>
    )
  }

  if (phase === 'conflict') {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h3 className="mb-2 text-lg font-semibold">{t('Google account already linked')}</h3>
        </div>
        <InfoCard
          variant="alert"
          title={t('This Google account is already linked to another account')}
          content={t(
            'It is currently linked to {{email}}. To link it to this account instead, the previous link will be removed. The previous account still exists and remains usable with its private key.',
            { email: existing?.email ?? '' }
          )}
        />
        {errorMsg && <p className="text-destructive text-center text-sm">{errorMsg}</p>}
        {busy ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-4 text-sm">
            <Loader className="size-4 animate-spin" />
            {statusText.binding}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button onClick={handleRebind} className="w-full">
              {t('Unlink the previous account and link this one')}
            </Button>
            <Button variant="secondary" onClick={onClose} className="w-full">
              {t('Cancel')}
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="mb-2 text-lg font-semibold">{t('Link Google account')}</h3>
        <p className="text-muted-foreground text-sm">
          {t('Link a Google account so you can sign in to this account with Google.')}
        </p>
      </div>
      <PomegranateHowItWorks />
      {errorMsg && <p className="text-destructive text-center text-sm">{errorMsg}</p>}
      {busy ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-4 text-sm">
          <Loader className="size-4 animate-spin" />
          {statusText[status === 'binding' ? 'binding' : 'authenticating']}
        </div>
      ) : (
        <Button onClick={handleStart} className="w-full">
          {status === 'error' ? t('Try again') : t('Continue with Google')}
        </Button>
      )}
    </div>
  )
}
