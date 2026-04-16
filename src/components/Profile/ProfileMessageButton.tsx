import { Button } from '@/components/ui/button'
import { toMessageThread } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import { useMarmot } from '@/providers/MarmotProvider'
import { useNostr } from '@/providers/NostrProvider'
import { getDefaultRelayUrls } from '@/lib/relay'
import { MessageSquare, Loader } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export default function ProfileMessageButton({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { checkLogin } = useNostr()
  const { marmotClient } = useMarmot()
  const { push } = useSecondaryPage()
  const [loading, setLoading] = useState(false)

  if (!marmotClient) return null

  const handleClick = () => {
    checkLogin(async () => {
      setLoading(true)
      try {
        // Find existing 1:1 group with this person, or create one
        const existing = marmotClient.groups.find((g) => {
          const data = g.groupData
          if (!data) return false
          return (
            data.adminPubkeys.includes(pubkey) &&
            data.adminPubkeys.length <= 2
          )
        })

        if (existing) {
          push(toMessageThread(existing.idStr))
          return
        }

        const relays = getDefaultRelayUrls().slice(0, 3)
        const group = await marmotClient.createGroup('', { relays })

        // Fetch the recipient's key package so we can invite them
        const keyPackageEvents = await marmotClient.network.request(relays, {
          kinds: [443],
          authors: [pubkey],
          limit: 5
        })

        if (keyPackageEvents.length > 0) {
          try {
            await group.inviteByKeyPackageEvent(keyPackageEvents[0])
          } catch (err) {
            console.warn('[Marmot] invite failed:', err)
            toast.error(t('Could not invite user — they may not have a key package published'))
          }
        } else {
          toast.error(t('User has no key package — they need to open Messages first'))
        }

        push(toMessageThread(group.idStr))
      } catch (err) {
        console.error('[Marmot] message button error:', err)
        toast.error(t('Failed to open message thread'))
      } finally {
        setLoading(false)
      }
    })
  }

  return (
    <Button
      variant="secondary"
      size="icon"
      className="rounded-full"
      onClick={handleClick}
      disabled={loading}
      title={t('Send encrypted message')}
    >
      {loading ? <Loader className="animate-spin" /> : <MessageSquare />}
    </Button>
  )
}
