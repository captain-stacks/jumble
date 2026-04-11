import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import ProfileCard from '@/components/ProfileCard'
import { getDefaultRelayUrls } from '@/lib/relay'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import client from '@/services/client.service'
import { useNostr } from '@/providers/NostrProvider'
import { nip19 } from 'nostr-tools'
import { nsecEncode } from 'nostr-tools/nip19'
import { forwardRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

const MASTER_PUBKEY = import.meta.env.VITE_EASY_LOGIN_MASTER_PUBKEY as string | undefined


type TRecoveredAccount = {
  pubkey: string
  nsec: string
  copied: boolean
}

export default forwardRef(function EasyLoginRecoveryPage(
  { index }: { index?: number },
  ref
) {
  const { pubkey, nip44Decrypt } = useNostr()
  const [email, setEmail] = useState('')
  const [npub, setNpub] = useState('')
  const [loading, setLoading] = useState(false)
  const [accounts, setAccounts] = useState<TRecoveredAccount[] | null>(null)
  const [totalNotes, setTotalNotes] = useState<number | null>(null)
  const [error, setError] = useState('')

  const isMaster = pubkey === MASTER_PUBKEY

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !MASTER_PUBKEY) return
    setLoading(true)
    setError('')
    setAccounts(null)
    setTotalNotes(null)

    try {
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

      const { getPublicKey } = await import('nostr-tools')
      const { hexToBytes } = await import('@noble/hashes/utils')

      const relays = getDefaultRelayUrls()
      const allEvents = await client.fetchEvents(relays, [
        {
          kinds: [30078],
          '#m': [MASTER_PUBKEY!],
          '#d': ['jumblewisp-recovery-key'],
          ...(authorPubkey ? { authors: [authorPubkey] } : {}),
          limit: 500
        }
      ])
      setTotalNotes(allEvents.length)

      const found: TRecoveredAccount[] = []

      for (const ev of allEvents) {
        const encryptionPubkey = ev.tags.find((t) => t[0] === 'encryption-pubkey')?.[1]
        if (!encryptionPubkey) continue
        try {
          const { encryptedEmail, encryptedKey } = JSON.parse(ev.content)
          const decryptedEmail = await nip44Decrypt(encryptionPubkey, encryptedEmail)
          if (decryptedEmail.trim().toLowerCase() !== email.trim().toLowerCase()) continue
          const decrypted = await nip44Decrypt(encryptionPubkey, encryptedKey)
          if (!decrypted || !/^[0-9a-f]{64}$/.test(decrypted)) continue
          const keyBytes = hexToBytes(decrypted)
          const derivedPubkey = getPublicKey(keyBytes)
          if (derivedPubkey !== ev.pubkey) continue
          found.push({
            pubkey: ev.pubkey,
            nsec: nsecEncode(keyBytes),
            copied: false
          })
        } catch {
          // Wrong key, try next
        }
      }

      if (found.length === 0) {
        setError('No recovery notes found. Make sure they signed up with the easy login flow.')
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
    if (!accounts) return
    navigator.clipboard.writeText(accounts[i].nsec)
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
          Enter the user's email address to recover their private key from their recovery event.
        </p>

        <form onSubmit={handleRecover} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="recovery-email">User's email address</Label>
            <Input
              id="recovery-email"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="recovery-npub">User's npub <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              id="recovery-npub"
              type="text"
              placeholder="npub1..."
              value={npub}
              onChange={(e) => setNpub(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || !email.trim()}>
            {loading ? 'Searching...' : 'Recover Key'}
          </Button>
        </form>

        {totalNotes !== null && (
          <p className="text-xs text-muted-foreground">
            {totalNotes} signup note{totalNotes !== 1 ? 's' : ''} in search space
          </p>
        )}

        {accounts && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {accounts.length === 1 ? '1 account found:' : `${accounts.length} accounts found:`}
            </p>
            {accounts.map((account, i) => (
              <div key={account.pubkey} className="space-y-3 rounded-lg border p-3">
                <ProfileCard userId={account.pubkey} showFollowButton={false} />
                <div className="flex gap-2">
                  <Input value={account.nsec} readOnly className="font-mono text-xs" />
                  <Button variant="secondary" size="icon" onClick={() => handleCopy(i)}>
                    {account.copied ? <Check /> : <Copy />}
                  </Button>
                </div>
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
