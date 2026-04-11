import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import UserAvatar from '@/components/UserAvatar'
import { getDefaultRelayUrls } from '@/lib/relay'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import client from '@/services/client.service'
import { useNostr } from '@/providers/NostrProvider'
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha2'
import { hexToBytes } from '@noble/hashes/utils'
import { nip19, getPublicKey, nip44 } from 'nostr-tools'
import { decrypt as decryptNcryptsec } from 'nostr-tools/nip49'
import { nsecEncode } from 'nostr-tools/nip19'
import { forwardRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

const MASTER_PUBKEY = import.meta.env.VITE_EASY_LOGIN_MASTER_PUBKEY as string | undefined
const NCRYPTSEC_STORAGE_KEY = 'jumblewisp_master_ncryptsec'

type TRecoveredAccount = {
  pubkey: string
  nsec: string | null
  copied: boolean
}

export default forwardRef(function EasyLoginRecoveryPage(
  { index }: { index?: number },
  ref
) {
  const { pubkey, nsec } = useNostr()
  const [ncryptsec, setNcryptsec] = useState(() => localStorage.getItem(NCRYPTSEC_STORAGE_KEY) ?? '')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [npub, setNpub] = useState('')
  const [loading, setLoading] = useState(false)
  const [accounts, setAccounts] = useState<TRecoveredAccount[] | null>(null)
  const [totalNotes, setTotalNotes] = useState<number | null>(null)
  const [error, setError] = useState('')

  const isMaster = pubkey === MASTER_PUBKEY

  const handleNcryptsecChange = (value: string) => {
    setNcryptsec(value)
    if (value.trim()) {
      localStorage.setItem(NCRYPTSEC_STORAGE_KEY, value.trim())
    } else {
      localStorage.removeItem(NCRYPTSEC_STORAGE_KEY)
    }
  }

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!MASTER_PUBKEY) return
    setLoading(true)
    setError('')
    setAccounts(null)
    setTotalNotes(null)

    try {
      let masterPrivkey: Uint8Array
      if (nsec) {
        const decoded = nip19.decode(nsec)
        if (decoded.type !== 'nsec') throw new Error('Invalid master key')
        masterPrivkey = decoded.data
      } else {
        if (!ncryptsec.trim()) throw new Error('Enter your master ncryptsec')
        if (!password) throw new Error('Enter your password')
        masterPrivkey = decryptNcryptsec(ncryptsec.trim(), password)
      }

      let authorPubkey: string | undefined
      if (npub.trim()) {
        try {
          const decoded = nip19.decode(npub.trim())
          if (decoded.type === 'npub') authorPubkey = decoded.data
        } catch {
          setError('Invalid npub')
          setLoading(false)
          return
        }
      }

      const normalizedEmail = email.trim().toLowerCase()

      const relays = getDefaultRelayUrls()
      const allEvents = await client.fetchEvents(relays, [
        {
          kinds: [30078],
          '#p': [MASTER_PUBKEY!],
          '#d': ['jumblewisp-recovery-key'],
          ...(authorPubkey ? { authors: [authorPubkey] } : {}),
          limit: 500
        }
      ])
      setTotalNotes(allEvents.length)

      const found: TRecoveredAccount[] = []

      for (const ev of allEvents) {
        try {
          const ephPubkey = ev.tags.find((t) => t[0] === 'ephemeral-pubkey')?.[1]
          if (!ephPubkey) continue

          if (normalizedEmail) {
            // Email provided: derive emailKey and attempt full decryption
            const sharedSecret = nip44.getConversationKey(masterPrivkey, ephPubkey)
            const emailKey = hmac(sha256, sharedSecret, new TextEncoder().encode(normalizedEmail))
            try {
              const nsecHex = nip44.decrypt(ev.content, emailKey)
              if (!nsecHex || !/^[0-9a-f]{64}$/.test(nsecHex)) continue
              const keyBytes = hexToBytes(nsecHex)
              if (getPublicKey(keyBytes) !== ev.pubkey) continue
              found.push({ pubkey: ev.pubkey, nsec: nsecEncode(keyBytes), copied: false })
            } catch {
              // Wrong email for this event, skip
            }
          } else {
            // No email: show profile only, nsec locked
            found.push({ pubkey: ev.pubkey, nsec: null, copied: false })
          }
        } catch {
          // Skip malformed events
        }
      }

      if (found.length === 0) {
        setError('No recovery notes found.')
      } else {
        setAccounts(found)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recovery failed')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = (i: number) => {
    if (!accounts || !accounts[i].nsec) return
    navigator.clipboard.writeText(accounts[i].nsec!)
    setAccounts((prev) =>
      prev ? prev.map((a, idx) => (idx === i ? { ...a, copied: true } : a)) : prev
    )
    setTimeout(() => {
      setAccounts((prev) =>
        prev ? prev.map((a, idx) => (idx === i ? { ...a, copied: false } : a)) : prev
      )
    }, 2000)
  }

  if (!isMaster) {
    return (
      <SecondaryPageLayout ref={ref} index={index} title="Account Recovery">
        <div className="p-4 text-sm text-muted-foreground">
          This page is only accessible to the master account.
        </div>
      </SecondaryPageLayout>
    )
  }

  return (
    <SecondaryPageLayout ref={ref} index={index} title="Account Recovery">
      <div className="space-y-6 p-4">
        <p className="text-sm text-muted-foreground">
          Enter an email address to find a specific user, or leave blank to retrieve all recovery events.
        </p>

        <form onSubmit={handleRecover} className="space-y-3">
          {!nsec && (
            <>
              <div className="space-y-1">
                <Label htmlFor="recovery-ncryptsec">Master ncryptsec</Label>
                <Input
                  id="recovery-ncryptsec"
                  type="password"
                  placeholder="ncryptsec1..."
                  value={ncryptsec}
                  onChange={(e) => handleNcryptsecChange(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="recovery-password">Password</Label>
                <Input
                  id="recovery-password"
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </>
          )}
          <div className="space-y-1">
            <Label htmlFor="recovery-email">
              User's email address <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="recovery-email"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus={!!nsec}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="recovery-npub">
              User's npub <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="recovery-npub"
              type="text"
              placeholder="npub1..."
              value={npub}
              onChange={(e) => setNpub(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Searching...' : 'Recover Key'}
          </Button>
        </form>

        {totalNotes !== null && (
          <p className="text-xs text-muted-foreground">
            {totalNotes} recovery event{totalNotes !== 1 ? 's' : ''} in search space
          </p>
        )}

        {accounts && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {accounts.length === 1 ? '1 account found:' : `${accounts.length} accounts found:`}
            </p>
            {accounts.map((account, i) => (
              <div key={account.pubkey} className="space-y-3 rounded-lg border p-3">
                <UserAvatar userId={account.pubkey} size="normal" />
                {account.nsec && (
                  <div className="flex gap-2">
                    <Input value={account.nsec} readOnly className="font-mono text-xs" />
                    <Button variant="secondary" size="icon" onClick={() => handleCopy(i)}>
                      {account.copied ? <Check /> : <Copy />}
                    </Button>
                  </div>
                )}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Share each nsec securely with the user to restore their account.
            </p>
          </div>
        )}
      </div>
    </SecondaryPageLayout>
  )
})
