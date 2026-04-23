import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useNostr } from '@/providers/NostrProvider'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as nip06 from 'nostr-tools/nip06'
import * as nip19 from 'nostr-tools/nip19'

export default function PrivateKeyLogin({
  back,
  onLoginSuccess
}: {
  back: () => void
  onLoginSuccess: () => void
}) {
  return (
    <Tabs defaultValue="seed">
      <TabsList>
        <TabsTrigger value="seed">Seed Phrase</TabsTrigger>
        <TabsTrigger value="nsec">nsec</TabsTrigger>
        <TabsTrigger value="ncryptsec">ncryptsec</TabsTrigger>
      </TabsList>
      <TabsContent value="seed">
        <SeedPhraseLogin back={back} onLoginSuccess={onLoginSuccess} />
      </TabsContent>
      <TabsContent value="nsec">
        <NsecLogin back={back} onLoginSuccess={onLoginSuccess} />
      </TabsContent>
      <TabsContent value="ncryptsec">
        <NcryptsecLogin back={back} onLoginSuccess={onLoginSuccess} />
      </TabsContent>
    </Tabs>
  )
}

function SeedPhraseLogin({
  back,
  onLoginSuccess
}: {
  back: () => void
  onLoginSuccess: () => void
}) {
  const { t } = useTranslation()
  const { nsecLogin } = useNostr()
  const [mnemonic, setMnemonic] = useState('')
  const [password, setPassword] = useState('')
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const handleLogin = () => {
    const words = mnemonic.trim().toLowerCase()
    if (!words) return

    const wordCount = words.split(/\s+/).length
    if (wordCount !== 12 && wordCount !== 24) {
      setErrMsg(t('Seed phrase must be 12 or 24 words'))
      return
    }

    if (!nip06.validateWords(words)) {
      setErrMsg(t('Invalid seed phrase'))
      return
    }

    try {
      const privkey = nip06.privateKeyFromSeedWords(words)
      const nsec = nip19.nsecEncode(privkey)
      nsecLogin(nsec, password)
        .then(() => onLoginSuccess())
        .catch((err: Error) => setErrMsg(err.message))
    } catch (err) {
      setErrMsg((err as Error).message)
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        handleLogin()
      }}
    >
      <div className="text-orange-400">
        {t(
          'Using private key login is insecure. It is recommended to use a browser extension for login, such as alby, nostr-keyx or nos2x. If you must use a private key, please set a password for encryption at minimum.'
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="seed-input">{t('12 or 24-word seed phrase')}</Label>
        <textarea
          id="seed-input"
          className={`flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none${errMsg ? ' border-destructive' : ''}`}
          placeholder={t('word1 word2 word3 ...')}
          value={mnemonic}
          onChange={(e) => {
            setMnemonic(e.target.value)
            setErrMsg(null)
          }}
          autoComplete="off"
          spellCheck={false}
        />
        {errMsg && <div className="text-xs text-destructive">{errMsg}</div>}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="seed-password-input">{t('password')}</Label>
        <Input
          id="seed-password-input"
          type="password"
          placeholder={t('optional: encrypt nsec')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button className="w-fit px-8" variant="secondary" type="button" onClick={back}>
          {t('Back')}
        </Button>
        <Button className="flex-1" type="submit">
          {t('Login')}
        </Button>
      </div>
    </form>
  )
}

function NsecLogin({ back, onLoginSuccess }: { back: () => void; onLoginSuccess: () => void }) {
  const { t } = useTranslation()
  const { nsecLogin } = useNostr()
  const [nsecOrHex, setNsecOrHex] = useState('')
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [password, setPassword] = useState('')

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNsecOrHex(e.target.value)
    setErrMsg(null)
  }

  const handleLogin = () => {
    if (nsecOrHex === '') return

    nsecLogin(nsecOrHex, password)
      .then(() => onLoginSuccess())
      .catch((err) => {
        setErrMsg(err.message)
      })
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        handleLogin()
      }}
    >
      <div className="text-orange-400">
        {t(
          'Using private key login is insecure. It is recommended to use a browser extension for login, such as alby, nostr-keyx or nos2x. If you must use a private key, please set a password for encryption at minimum.'
        )}
      </div>
      <div className="rounded-md border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-sm text-blue-700 dark:text-blue-400">
        Lost your nostr private key? Message the admin on Signal at{' '}
        <span className="font-semibold">p246.01</span>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="nsec-input">nsec or hex</Label>
        <Input
          id="nsec-input"
          type="password"
          placeholder="nsec1.. or hex"
          value={nsecOrHex}
          onChange={handleInputChange}
          className={errMsg ? 'border-destructive' : ''}
        />
        {errMsg && <div className="text-xs text-destructive">{errMsg}</div>}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password-input">{t('password')}</Label>
        <Input
          id="password-input"
          type="password"
          placeholder={t('optional: encrypt nsec')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button className="w-fit px-8" variant="secondary" type="button" onClick={back}>
          {t('Back')}
        </Button>
        <Button className="flex-1" type="submit">
          {t('Login')}
        </Button>
      </div>
    </form>
  )
}

function NcryptsecLogin({
  back,
  onLoginSuccess
}: {
  back: () => void
  onLoginSuccess: () => void
}) {
  const { t } = useTranslation()
  const { ncryptsecLogin } = useNostr()
  const [ncryptsec, setNcryptsec] = useState('')
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNcryptsec(e.target.value)
    setErrMsg(null)
  }

  const handleLogin = () => {
    if (ncryptsec === '') return

    ncryptsecLogin(ncryptsec)
      .then(() => onLoginSuccess())
      .catch((err) => {
        setErrMsg(err.message)
      })
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        handleLogin()
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="ncryptsec-input">ncryptsec</Label>
        <Input
          id="ncryptsec-input"
          type="password"
          placeholder="ncryptsec1.."
          value={ncryptsec}
          onChange={handleInputChange}
          className={errMsg ? 'border-destructive' : ''}
        />
        {errMsg && <div className="text-xs text-destructive">{errMsg}</div>}
      </div>
      <div className="flex gap-2">
        <Button className="w-fit px-8" variant="secondary" type="button" onClick={back}>
          {t('Back')}
        </Button>
        <Button className="flex-1" type="submit">
          {t('Login')}
        </Button>
      </div>
    </form>
  )
}
