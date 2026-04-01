import { useSecondaryPage } from '@/PageManager'
import Note from '@/components/Note'
import NoteCard, { NoteCardLoadingSkeleton } from '@/components/NoteCard'
import NoteInteractions from '@/components/NoteInteractions'
import StuffStats from '@/components/StuffStats'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { ExtendedKind } from '@/constants'
import { useFetchEvent } from '@/hooks'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { getParentBech32Id } from '@/lib/event'
import { createShortTextNoteDraftEvent } from '@/lib/draft-event'
import { toExternalContent } from '@/lib/link'
import { tagNameEquals } from '@/lib/tag'
import { StorageKey } from '@/constants'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import client from '@/services/client.service'
import { Send } from 'lucide-react'
import { Event } from 'nostr-tools'
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import NotFound from './NotFound'


const NotePage = forwardRef(({ id, index }: { id?: string; index?: number }, ref) => {
  const { t } = useTranslation()
  const { pop } = useSecondaryPage()
  const { event, isFetching } = useFetchEvent(id)
  const rootITag = useMemo(
    () => (event?.kind === ExtendedKind.COMMENT ? event.tags.find(tagNameEquals('I')) : undefined),
    [event]
  )
  const [parentChain, setParentChain] = useState<Event[]>([])
  const [chainLoading, setChainLoading] = useState(false)
  const [chainLoaded, setChainLoaded] = useState(false)
  const selectedNoteRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!event) return
    const firstParentId = getParentBech32Id(event)
    if (!firstParentId) {
      setParentChain([])
      setChainLoaded(true)
      return
    }
    setChainLoading(true)
    setChainLoaded(false)
    const fetchChain = async () => {
      const chain: Event[] = []
      let currentId: string | undefined = firstParentId
      for (let i = 0; i < 20; i++) {
        if (!currentId) break
        const parent = await client.fetchEvent(currentId)
        if (!parent) break
        chain.unshift(parent)
        currentId = getParentBech32Id(parent)
      }
      setParentChain(chain)
      setChainLoading(false)
      setChainLoaded(true)
    }
    fetchChain()
  }, [event?.id])

  useEffect(() => {
    if (!event || !chainLoaded) return
    setTimeout(() => {
      const el = selectedNoteRef.current
      if (!el) return
      const scrollParent = el.closest('[data-radix-scroll-area-viewport]') as HTMLElement | null
      if (scrollParent) {
        const headerHeight = 48
        const elTop = el.getBoundingClientRect().top
        const containerTop = scrollParent.getBoundingClientRect().top
        scrollParent.scrollBy({ top: elTop - containerTop - headerHeight, behavior: 'smooth' })
      } else {
        window.scrollBy({ top: el.getBoundingClientRect().top - 48, behavior: 'smooth' })
      }
    }, 100)
  }, [event?.id, chainLoaded])
  const { pubkey, publish, checkLogin } = useNostr()
  const { isSmallScreen } = useScreenSize()
  const [replyInput, setReplyInput] = useState('')
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (event && !isSmallScreen) inputRef.current?.focus()
  }, [!!event])

  const handleSend = async () => {
    const text = replyInput.trim()
    if (!text || !event) return
    await checkLogin(async () => {
      setSending(true)
      try {
        const addClientTag = window.localStorage.getItem(StorageKey.ADD_CLIENT_TAG) === 'true'
        const draft = await createShortTextNoteDraftEvent(text, [], { parentEvent: event, addClientTag })
        await publish(draft)
        setReplyInput('')
        pop()
      } finally {
        setSending(false)
      }
    })
  }

  if (!event && isFetching) {
    return (
      <SecondaryPageLayout ref={ref} index={index} title={t('Note')}>
        <div className="px-4 pt-3">
          <div className="flex items-center space-x-2">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className={`w-0 flex-1`}>
              <div className="py-1">
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="py-0.5">
                <Skeleton className="h-4 w-12" />
              </div>
            </div>
          </div>
          <div className="pt-2">
            <div className="my-1">
              <Skeleton className="my-1 mt-2 h-4 w-full" />
            </div>
            <div className="my-1">
              <Skeleton className="my-1 h-4 w-2/3" />
            </div>
          </div>
        </div>
      </SecondaryPageLayout>
    )
  }
  if (!event) {
    return (
      <SecondaryPageLayout ref={ref} index={index} title={t('Note')} displayScrollToTopButton>
        <NotFound bech32Id={id} />
      </SecondaryPageLayout>
    )
  }

  const replyBar = (
    <div className="flex items-center gap-2 border-t bg-background px-3 py-2">
      <input
        ref={inputRef}
        className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
        placeholder={pubkey ? t('Reply...') : t('Login to reply')}
        value={replyInput}
        disabled={!pubkey || sending}
        onChange={(e) => setReplyInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
          }
        }}
        autoComplete="off"
      />
      <button
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        onClick={handleSend}
        disabled={!pubkey || sending || !replyInput.trim()}
      >
        <Send className="size-4" />
      </button>
    </div>
  )

  return (
    <SecondaryPageLayout ref={ref} index={index} title={t('Note')} displayScrollToTopButton footer={replyBar}>
      {rootITag && (
        <div className="px-4 pt-3">
          <ExternalRoot value={rootITag[1]} />
        </div>
      )}
      {chainLoading && <NoteCardLoadingSkeleton />}
      {parentChain.map((parent) => (
        <ParentNote key={parent.id} event={parent} />
      ))}
      <div ref={selectedNoteRef} className="px-4 pt-3">
        <Note
          key={`note-${event.id}`}
          event={event}
          className="select-text"
          hideParentNotePreview
          originalNoteId={id}
          showFull
          showMutedContent
        />
        <StuffStats className="mt-3" stuff={event} fetchIfNotExisting displayTopZapsAndLikes />
      </div>
      <Separator className="mt-4" />
      <NoteInteractions key={`note-interactions-${event.id}`} event={event} />
    </SecondaryPageLayout>
  )
})
NotePage.displayName = 'NotePage'
export default NotePage

function ExternalRoot({ value }: { value: string }) {
  const { push } = useSecondaryPage()

  return (
    <div>
      <Card
        className="clickable flex items-center space-x-1 px-1.5 py-1 text-sm text-muted-foreground hover:text-foreground"
        onClick={() => push(toExternalContent(value))}
      >
        <div className="truncate">{value}</div>
      </Card>
      <div className="ml-5 h-2 w-px bg-border" />
    </div>
  )
}

function ParentNote({ event }: { event: Event }) {
  return (
    <>
      <NoteCard event={event} filterMutedNotes={false} showMutedContent />
      <div className="ml-9 h-3 w-px bg-border" />
    </>
  )
}

