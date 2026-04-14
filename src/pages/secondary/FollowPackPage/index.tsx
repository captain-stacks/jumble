import ImageWithLightbox from '@/components/ImageWithLightbox'
import NormalFeed from '@/components/NormalFeed'
import ProfileList from '@/components/ProfileList'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useFetchEvent } from '@/hooks/useFetchEvent'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { getEventKey } from '@/lib/event'
import { getFollowPackInfoFromEvent } from '@/lib/event-metadata'
import { cn } from '@/lib/utils'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import { TFeedSubRequest } from '@/types'
import { Loader, ShieldBan } from 'lucide-react'
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const FollowPackPage = forwardRef(({ id, index }: { id?: string; index?: number }, ref) => {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'users' | 'feed'>('users')
  const [mutePackDialogOpen, setMutePackDialogOpen] = useState(false)

  const { event, isFetching } = useFetchEvent(id)
  const { pubkey: accountPubkey } = useNostr()
  const { getMutePubkeys } = useMuteList()

  const { title, description, image, pubkeys: eventPubkeys } = useMemo(() => {
    if (!event) return { title: '', description: '', image: '', pubkeys: [] }
    return getFollowPackInfoFromEvent(event)
  }, [event])

  const isOwnMuteList = event?.kind === 10000 && event?.pubkey === accountPubkey
  const pubkeys = useMemo(
    () => (isOwnMuteList ? getMutePubkeys() : eventPubkeys),
    [isOwnMuteList, getMutePubkeys, eventPubkeys]
  )

  if (isFetching) {
    return (
      <SecondaryPageLayout ref={ref} index={index} title={t('Follow Pack')}>
        <div className="space-y-2 px-4 py-3">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-7 w-full py-1" />
        </div>
      </SecondaryPageLayout>
    )
  }

  if (!event) {
    return (
      <SecondaryPageLayout ref={ref} index={index} title={t('Follow Pack')}>
        <div className="p-4 text-center text-muted-foreground">{t('Follow pack not found')}</div>
      </SecondaryPageLayout>
    )
  }

  return (
    <SecondaryPageLayout ref={ref} index={index} title={t('Follow Pack')} displayScrollToTopButton>
      <div>
        {/* Header */}
        <div className="space-y-2 px-4 pt-3">
          {image && (
            <ImageWithLightbox
              image={{ url: image, pubkey: event.pubkey }}
              className="h-48 w-full rounded-lg object-cover"
              classNames={{
                wrapper: 'w-full h-48 border-none'
              }}
            />
          )}

          <div className="flex items-center gap-2">
            <h3 className="mb-1 truncate text-2xl font-semibold">{title}</h3>
            <span className="shrink-0 text-xs text-muted-foreground">
              {t('n users', { count: pubkeys.length })}
            </span>
          </div>

          {description && (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{description}</p>
          )}

          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-lg border bg-muted/50">
              <button
                onClick={() => setTab('users')}
                className={cn(
                  'rounded-l-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  tab === 'users'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t('Users')}
              </button>
              <button
                onClick={() => setTab('feed')}
                className={cn(
                  'rounded-r-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  tab === 'feed'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t('Feed')}
              </button>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setMutePackDialogOpen(true)}
            >
              <ShieldBan className="h-4 w-4" />
              Create Mute Pack
            </Button>
          </div>
        </div>

        {/* Content */}
        {tab === 'users' && <ProfileList pubkeys={pubkeys} showBulkActions showMuteButton />}
        {tab === 'feed' && pubkeys.length > 0 && (
          <Feed trustScoreFilterId={`follow-pack-${getEventKey(event)}`} pubkeys={pubkeys} />
        )}
      </div>

      <CreateMutePackDialog
        open={mutePackDialogOpen}
        onOpenChange={setMutePackDialogOpen}
        pubkeys={pubkeys}
        defaultName={title}
      />
    </SecondaryPageLayout>
  )
})
FollowPackPage.displayName = 'FollowPackPage'
export default FollowPackPage

function CreateMutePackDialog({
  open,
  onOpenChange,
  pubkeys,
  defaultName
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pubkeys: string[]
  defaultName: string
}) {
  const { publish, checkLogin } = useNostr()
  const [name, setName] = useState('')
  const [publishing, setPublishing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setName(defaultName)
      setTimeout(() => inputRef.current?.select(), 50)
    }
  }, [open, defaultName])

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    checkLogin(async () => {
      setPublishing(true)
      try {
        const d = trimmed.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
        await publish({
          kind: 30000,
          content: '',
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['d', d],
            ['name', trimmed],
            ['L', 'mutable'],
            ['l', 'community-pack', 'mutable'],
            ...pubkeys.map((pk) => ['p', pk])
          ]
        })
        toast.success('Mute pack created')
        onOpenChange(false)
      } catch (err) {
        toast.error(`Failed to create mute pack: ${(err as Error).message}`)
      } finally {
        setPublishing(false)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Mute Pack</DialogTitle>
        </DialogHeader>
        <input
          ref={inputRef}
          className="w-full rounded border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          placeholder="Pack name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!name.trim() || publishing} onClick={handleCreate}>
            {publishing ? <Loader className="animate-spin" /> : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Feed({ trustScoreFilterId, pubkeys }: { trustScoreFilterId: string; pubkeys: string[] }) {
  const { pubkey: myPubkey } = useNostr()
  const [subRequests, setSubRequests] = useState<TFeedSubRequest[]>([])

  useEffect(() => {
    client.generateSubRequestsForPubkeys(pubkeys, myPubkey).then(setSubRequests)
  }, [pubkeys, myPubkey])

  return <NormalFeed trustScoreFilterId={trustScoreFilterId} subRequests={subRequests} filterMutedNotes={false} showMutedContent={true} />
}
